/**
 * Workflow templates: published versions, previews, and the traceability the
 * template screen shows.
 *
 * A template version is `buildTemplate(scenario, options)` frozen in the
 * database. Each organization starts with version 1 of each scenario on the
 * default options; an administrator may publish a new version with other
 * options. Runs keep the version they started with — publishing never
 * rewrites work in progress (the version row is frozen by a trigger, and runs
 * copy their stages and tasks at creation anyway).
 */

import crypto from 'node:crypto';
import {
  SCENARIOS,
  SCENARIO_LABELS,
  TEMPLATE_CODE_VERSION,
  TEMPLATE_OPTIONS,
  buildTemplate,
  normalizeOptions,
  validateTemplate,
} from '../../../shared/learningProduction/workflowTemplates.js';
import { ANOMALIES, OPEN_DECISIONS, traceRows } from '../../../shared/learningProduction/traceability.js';
import { LP_PERMISSIONS as P } from '../../../shared/learningProduction/permissions.js';
import { WORKBOOK_CHECKSUM } from '../../../shared/learningProduction/workbookSource.js';
import { SCHEMA as S, direct, transaction } from '../db.js';
import { record } from '../activity.js';
import { forbidden, notFound, validation } from '../errors.js';
import { mapTemplateVersion } from '../runMappers.js';
import { peopleFor } from '../people.js';
import { oneOf, plainObject, text } from '../validate.js';

function checksumOf(definition) {
  return crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

/** Make sure each scenario has a current version in this organization. Idempotent. */
export async function ensureTemplates(db, organizationId) {
  const existing = await db.rows(
    `SELECT scenario FROM ${S}.learning_workflow_template_versions WHERE organization_id = $1 AND is_current`,
    [organizationId]
  );
  const have = new Set(existing.map((row) => row.scenario));
  for (const scenario of SCENARIOS) {
    if (have.has(scenario)) continue;
    const definition = buildTemplate(scenario);
    await db.query(
      `INSERT INTO ${S}.learning_workflow_template_versions
         (organization_id, scenario, version_number, code_version, options_json, definition_json, checksum, notes, is_current)
       SELECT $1, $2, coalesce(max(version_number), 0) + 1, $3, $4, $5, $6, 'Initial version from the workbook.', true
         FROM ${S}.learning_workflow_template_versions WHERE organization_id = $1 AND scenario = $2
       ON CONFLICT DO NOTHING`,
      [organizationId, scenario, TEMPLATE_CODE_VERSION, JSON.stringify(definition.options), JSON.stringify(definition), checksumOf(definition)]
    );
  }
}

export async function currentTemplateRow(db, organizationId, scenario) {
  await ensureTemplates(db, organizationId);
  return db.row(
    `SELECT * FROM ${S}.learning_workflow_template_versions WHERE organization_id = $1 AND scenario = $2 AND is_current`,
    [organizationId, scenario]
  );
}

/** A short description of a template for lists and the creation preview. */
export function summarizeDefinition(definition) {
  const stages = definition.stages.map((stage) => ({
    key: stage.key,
    label: stage.label,
    description: stage.description,
    origin: stage.origin,
    source: stage.source,
    after: stage.after,
    ownerRole: stage.ownerRole,
    skippable: stage.skippable,
    issueLog: stage.issueLog,
    lessonAssets: stage.lessonAssets,
    note: stage.note,
    tasks: stage.tasks.map((task) => ({
      key: task.key,
      label: task.label,
      kind: task.kind,
      classification: task.classification,
      condition: task.condition,
      role: task.role,
      reviewerRole: task.reviewerRole,
      requiresApproval: task.requiresApproval,
      approvalOrigin: task.approvalOrigin,
      requiresEvidence: task.requiresEvidence,
      evidenceLabel: task.evidenceLabel,
      sensitive: task.sensitive,
      externalTool: task.externalTool,
      origin: task.origin,
      source: task.source,
      note: task.note,
      checklistCount: task.checklist.length,
      after: task.after,
    })),
  }));
  const tasks = stages.flatMap((stage) => stage.tasks);
  const roles = [...new Set(tasks.flatMap((task) => [task.role, task.reviewerRole]).filter(Boolean))];
  return {
    scenario: definition.scenario,
    label: definition.label,
    options: definition.options,
    lessonAssetTypes: definition.lessonAssetTypes,
    stages,
    roles,
    counts: {
      stages: stages.length,
      tasks: tasks.length,
      required: tasks.filter((task) => task.classification === 'REQUIRED').length,
      conditional: tasks.filter((task) => task.classification === 'CONDITIONAL').length,
      optional: tasks.filter((task) => task.classification === 'OPTIONAL').length,
      approvals: tasks.filter((task) => task.requiresApproval).length,
      automatic: tasks.filter((task) => task.kind === 'AUTO').length,
      proposed: tasks.filter((task) => task.origin === 'PROPOSED').length,
      hidden: tasks.filter((task) => task.origin === 'WORKBOOK_HIDDEN').length,
    },
  };
}

export async function listTemplates(actor) {
  await ensureTemplates(direct, actor.organizationId);
  const rows = await direct.rows(
    `SELECT * FROM ${S}.learning_workflow_template_versions WHERE organization_id = $1 ORDER BY scenario, version_number DESC`,
    [actor.organizationId]
  );
  const usage = await direct.rows(
    `SELECT template_version_id, count(*)::int AS runs,
            count(*) FILTER (WHERE status IN ('ACTIVE', 'ON_HOLD'))::int AS open_runs
       FROM ${S}.learning_production_runs WHERE organization_id = $1 AND template_version_id IS NOT NULL
      GROUP BY template_version_id`,
    [actor.organizationId]
  );
  const usedBy = new Map(usage.map((row) => [row.template_version_id, row]));

  const templates = SCENARIOS.map((scenario) => {
    const versions = rows.filter((row) => row.scenario === scenario);
    const current = versions.find((row) => row.is_current) ?? versions[0];
    return {
      scenario,
      label: SCENARIO_LABELS[scenario],
      current: current ? { ...mapTemplateVersion(current), summary: summarizeDefinition(current.definition_json) } : null,
      versions: versions.map((row) => ({
        ...mapTemplateVersion(row),
        runs: usedBy.get(row.id)?.runs ?? 0,
        openRuns: usedBy.get(row.id)?.open_runs ?? 0,
      })),
    };
  });

  return {
    templates,
    options: Object.entries(TEMPLATE_OPTIONS).map(([key, option]) => ({ key, scenarios: option.scenarios, default: option.default, label: option.label })),
    canAdmin: actor.grants.has(P.TEMPLATE_ADMIN),
    workbookChecksum: WORKBOOK_CHECKSUM,
    people: await peopleFor(rows.map((row) => row.created_by)),
  };
}

export async function getTemplateVersion(actor, versionId) {
  const row = await direct.row(
    `SELECT * FROM ${S}.learning_workflow_template_versions WHERE id = $1 AND organization_id = $2`,
    [versionId, actor.organizationId]
  );
  if (!row) throw notFound();
  return { version: mapTemplateVersion(row, { withDefinition: true }), summary: summarizeDefinition(row.definition_json) };
}

/** What a run of this scenario would contain, with these options — nothing is written. */
export async function previewTemplate(actor, input) {
  const body = plainObject(input, 'body');
  const scenario = oneOf(body.scenario, SCENARIOS, 'scenario', { required: true });
  const row = await currentTemplateRow(direct, actor.organizationId, scenario);
  return { templateVersion: mapTemplateVersion(row), summary: summarizeDefinition(row.definition_json) };
}

/**
 * Publish a new version of one scenario with the given options. The previous
 * version stops being current; runs already on it keep it.
 */
export async function publishTemplateVersion(actor, input) {
  if (!actor.grants.has(P.TEMPLATE_ADMIN)) throw forbidden('FORBIDDEN', { permission: P.TEMPLATE_ADMIN });
  const body = plainObject(input, 'body');
  const scenario = oneOf(body.scenario, SCENARIOS, 'scenario', { required: true });
  const options = normalizeOptions(scenario, plainObject(body.options, 'options'));
  const notes = text(body.notes, 'notes', { max: 2000 }) ?? '';
  const definition = buildTemplate(scenario, options);
  const problems = validateTemplate(definition);
  if (problems.length) throw validation('options', 'invalid_template', { problems });

  return transaction(async (tx) => {
    await ensureTemplates(tx, actor.organizationId);
    await tx.query(
      `SELECT id FROM ${S}.learning_workflow_template_versions WHERE organization_id = $1 AND scenario = $2 FOR UPDATE`,
      [actor.organizationId, scenario]
    );
    await tx.query(
      `UPDATE ${S}.learning_workflow_template_versions SET is_current = false, retired_at = now()
        WHERE organization_id = $1 AND scenario = $2 AND is_current`,
      [actor.organizationId, scenario]
    );
    const row = await tx.row(
      `INSERT INTO ${S}.learning_workflow_template_versions
         (organization_id, scenario, version_number, code_version, options_json, definition_json, checksum, notes, is_current, created_by)
       SELECT $1, $2, coalesce(max(version_number), 0) + 1, $3, $4, $5, $6, $7, true, $8
         FROM ${S}.learning_workflow_template_versions WHERE organization_id = $1 AND scenario = $2
       RETURNING *`,
      [actor.organizationId, scenario, TEMPLATE_CODE_VERSION, JSON.stringify(options), JSON.stringify(definition), checksumOf(definition), notes, actor.userId]
    );
    await record(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      eventType: 'TEMPLATE_PUBLISHED',
      metadata: { scenario, versionNumber: row.version_number, options },
    });
    return { version: mapTemplateVersion(row), summary: summarizeDefinition(definition) };
  });
}

/** The workbook trace, the anomalies found in it, and the decisions still open. */
export async function traceability() {
  const { detail, master } = traceRows();
  return { detail, master, anomalies: ANOMALIES, openDecisions: OPEN_DECISIONS, workbookChecksum: WORKBOOK_CHECKSUM };
}
