/**
 * KPI scorecards — one stored document per person, per template, per month.
 *
 * The catalogue in `shared/kpiCatalogue.js` is versioned in code so every
 * tenant is judged against the same audited definitions, but a scorecard
 * stores the target each KPI was actually measured against. Revising a
 * catalogue default therefore never rewrites a month that has already closed.
 *
 * Scoring itself is not stored. It is derived on read from the entry and the
 * template, which is what keeps a fixed rounding rule or a corrected band from
 * leaving stale grades behind in the database.
 */

import crypto from 'node:crypto';
import { create, find, findOne, getStore, now } from './store.js';
import { can, isActiveUser, PERMISSIONS } from '../shared/permissions.js';
import { organizationOf } from '../shared/organization.js';
import {
  KPI_CHECK_STATES,
  KPI_STATUSES,
  KPI_TEMPLATES,
  kpiTemplateById,
  kpiTemplateSummary,
  scoreScorecard,
} from '../shared/kpi.js';

const CHECK_STATES = new Set(KPI_CHECK_STATES.map((state) => state.id));
const MAX_NOTE = 500;
const MAX_SCORECARD_NOTES = 2000;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class KPIError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.name = 'KPIError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const linkDocumentId = (organizationId) => `hr-links:${organizationId}`;

/**
 * A deterministic id, so filing the same month for the same person twice is a
 * conflict the store can refuse rather than a duplicate nobody notices.
 */
export function scorecardId(organizationId, templateId, subjectType, subjectId, period) {
  const digest = crypto
    .createHash('sha256')
    .update([organizationId, templateId, subjectType, subjectId, period].join(':'))
    .digest('hex')
    .slice(0, 28);
  return `kpi-${digest}`;
}

function requireTemplate(templateId) {
  const template = kpiTemplateById(templateId);
  if (!template) throw new KPIError('kpi_template_unknown', 400);
  return template;
}

function requirePeriod(period) {
  const value = String(period || '').trim();
  if (!PERIOD.test(value)) throw new KPIError('kpi_period_invalid', 400);
  return value;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Narrow a submitted patch to rows this template actually declares.
 *
 * Everything unknown is rejected rather than dropped: a typo'd KPI id means
 * the caller believes it recorded a number that would silently never be
 * scored.
 */
export function cleanEntry(template, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new KPIError('kpi_patch_invalid', 400);
  }
  const kpis = new Map(template.groups.flatMap((group) => group.kpis.map((kpi) => [kpi.id, kpi])));
  const checks = new Set(template.groups.flatMap((group) => group.checklist.map((item) => item.id)));
  const incentiveGroups = new Set(
    template.groups.filter((group) => Array.isArray(group.incentiveBands)).map((group) => group.id)
  );
  const entry = {};

  if (patch.values !== undefined) {
    if (!patch.values || typeof patch.values !== 'object' || Array.isArray(patch.values)) {
      throw new KPIError('kpi_values_invalid', 400);
    }
    entry.values = {};
    for (const [kpiId, raw] of Object.entries(patch.values)) {
      if (!kpis.has(kpiId)) throw new KPIError('kpi_unknown_indicator', 400, { kpiId });
      const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { actual: raw };
      const actual = finiteOrNull(value.actual);
      const target = finiteOrNull(value.target);
      const note = String(value.note ?? '').trim().slice(0, MAX_NOTE);
      // An emptied field is an erased measurement, not a zero.
      if (actual === null && target === null && !note) continue;
      entry.values[kpiId] = { actual, target, note };
    }
  }

  if (patch.checks !== undefined) {
    if (!patch.checks || typeof patch.checks !== 'object' || Array.isArray(patch.checks)) {
      throw new KPIError('kpi_checks_invalid', 400);
    }
    entry.checks = {};
    for (const [checkId, state] of Object.entries(patch.checks)) {
      if (!checks.has(checkId)) throw new KPIError('kpi_unknown_check', 400, { checkId });
      if (state === null || state === '') continue;
      if (!CHECK_STATES.has(state)) throw new KPIError('kpi_check_state_invalid', 400, { checkId });
      entry.checks[checkId] = state;
    }
  }

  if (patch.incentives !== undefined) {
    if (!patch.incentives || typeof patch.incentives !== 'object' || Array.isArray(patch.incentives)) {
      throw new KPIError('kpi_incentives_invalid', 400);
    }
    entry.incentives = {};
    for (const [groupId, amount] of Object.entries(patch.incentives)) {
      if (!incentiveGroups.has(groupId)) throw new KPIError('kpi_unknown_incentive', 400, { groupId });
      const value = finiteOrNull(amount);
      if (value === null) continue;
      if (value < 0) throw new KPIError('kpi_incentive_negative', 400, { groupId });
      entry.incentives[groupId] = value;
    }
  }

  if (patch.notes !== undefined) entry.notes = String(patch.notes ?? '').trim().slice(0, MAX_SCORECARD_NOTES);

  if (!Object.keys(entry).length) throw new KPIError('kpi_patch_empty', 400);
  return entry;
}

/** Employee codes this account owns, so a person can read their own card. */
async function ownEmployeeCodes(user) {
  const document = await findOne(
    'hrEmployeeLinks',
    (item) => item.id === linkDocumentId(organizationOf(user))
  );
  return new Set(
    Object.entries(document?.links ?? {})
      .filter(([, userId]) => userId === user.id)
      .map(([employeeCode]) => employeeCode)
  );
}

function isSubject(scorecard, user, codes) {
  if (scorecard.subjectType === 'user') return scorecard.subjectId === user.id;
  return codes.has(scorecard.subjectId);
}

function publicScorecard(scorecard, template, { includeEntry = true } = {}) {
  const result = scoreScorecard(template, scorecard);
  return {
    id: scorecard.id,
    templateId: scorecard.templateId,
    audience: template.audience,
    templateAr: template.ar,
    templateEn: template.en,
    period: scorecard.period,
    subjectType: scorecard.subjectType,
    subjectId: scorecard.subjectId,
    subjectName: scorecard.subjectName,
    status: scorecard.status,
    notes: scorecard.notes ?? '',
    values: includeEntry ? scorecard.values ?? {} : undefined,
    checks: includeEntry ? scorecard.checks ?? {} : undefined,
    incentives: includeEntry ? scorecard.incentives ?? {} : undefined,
    createdBy: scorecard.createdBy ?? null,
    updatedBy: scorecard.updatedBy ?? null,
    updatedAt: scorecard.updatedAt ?? null,
    finalizedAt: scorecard.finalizedAt ?? null,
    finalizedBy: scorecard.finalizedBy ?? null,
    result,
  };
}

export async function kpiOverviewFor(user) {
  const organizationId = organizationOf(user);
  const canRead = can(user, PERMISSIONS.HR_VIEW);
  const canManage = can(user, PERMISSIONS.HR_MANAGE);
  const [stored, codes] = await Promise.all([
    find('kpiScorecards', (item) => organizationOf(item) === organizationId),
    ownEmployeeCodes(user),
  ]);

  const visible = canRead ? stored : stored.filter((item) => isSubject(item, user, codes));
  const scorecards = visible
    .map((item) => {
      const template = kpiTemplateById(item.templateId);
      return template ? publicScorecard(item, template, { includeEntry: false }) : null;
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.period.localeCompare(left.period)
        || left.subjectName.localeCompare(right.subjectName, 'ar')
    );

  return {
    permissions: { canRead, canManage, selfOnly: !canRead },
    templates: KPI_TEMPLATES.map(kpiTemplateSummary),
    periods: [...new Set(scorecards.map((item) => item.period))].sort().reverse(),
    scorecards,
  };
}

export async function kpiScorecardFor(user, id) {
  const scorecard = await findOne(
    'kpiScorecards',
    (item) => item.id === String(id) && organizationOf(item) === organizationOf(user)
  );
  if (!scorecard) throw new KPIError('kpi_scorecard_not_found', 404);
  if (!can(user, PERMISSIONS.HR_VIEW) && !isSubject(scorecard, user, await ownEmployeeCodes(user))) {
    throw new KPIError('forbidden', 403);
  }
  return publicScorecard(scorecard, requireTemplate(scorecard.templateId));
}

/**
 * Resolve who a scorecard is about, and refuse a subject the workspace cannot
 * name — an unnamed card is one nobody can audit later.
 */
async function resolveSubject(organizationId, subjectType, subjectId, subjectName) {
  const id = String(subjectId || '').trim();
  if (!id) throw new KPIError('kpi_subject_required', 400);

  if (subjectType === 'user') {
    const account = await findOne(
      'users',
      (item) => item.id === id && organizationOf(item) === organizationId
    );
    if (!account || !isActiveUser(account)) throw new KPIError('kpi_subject_not_found', 404);
    return { subjectType: 'user', subjectId: id, subjectName: account.name };
  }

  if (subjectType === 'employee') {
    const dataset = await findOne(
      'hrDatasets',
      (item) => item.id === `hr-dataset:${organizationId}:master`
    );
    const employee = (dataset?.payload?.employees ?? []).find((row) => row.employeeCode === id);
    if (!employee) throw new KPIError('kpi_subject_not_found', 404);
    return {
      subjectType: 'employee',
      subjectId: id,
      subjectName: employee.nameArabic || employee.nameEnglish || id,
    };
  }

  // A name the workbooks carry for somebody who has no workspace account yet.
  // The alternative was to refuse the approved sheets until every person on
  // them had been onboarded, which would have meant not loading them at all.
  if (subjectType === 'record') {
    const name = String(subjectName || id).trim().slice(0, 120);
    if (!name) throw new KPIError('kpi_subject_required', 400);
    return { subjectType: 'record', subjectId: name, subjectName: name };
  }

  throw new KPIError('kpi_subject_type_invalid', 400);
}

export async function createScorecard({
  organizationId, templateId, period, subjectType, subjectId, subjectName, actorId,
}) {
  const template = requireTemplate(templateId);
  const month = requirePeriod(period);
  const subject = await resolveSubject(organizationId, subjectType, subjectId, subjectName);
  const id = scorecardId(organizationId, template.id, subject.subjectType, subject.subjectId, month);

  if (await findOne('kpiScorecards', (item) => item.id === id)) {
    throw new KPIError('kpi_scorecard_exists', 409, { id });
  }

  const scorecard = await create('kpiScorecards', {
    id,
    organizationId,
    templateId: template.id,
    period: month,
    ...subject,
    values: {},
    checks: {},
    incentives: {},
    notes: '',
    status: 'draft',
    createdBy: actorId,
    updatedBy: actorId,
  });
  return publicScorecard(scorecard, template);
}

export async function updateScorecard({ organizationId, id, patch, actorId }) {
  const current = await findOne(
    'kpiScorecards',
    (item) => item.id === String(id) && organizationOf(item) === organizationId
  );
  if (!current) throw new KPIError('kpi_scorecard_not_found', 404);
  // A finalised month is the record management signed. Reopen it deliberately
  // rather than letting a stray edit rewrite a grade already acted on.
  if (current.status === 'final') throw new KPIError('kpi_scorecard_final', 409);

  const template = requireTemplate(current.templateId);
  const entry = cleanEntry(template, patch);
  const next = {
    values: entry.values ?? current.values ?? {},
    checks: entry.checks ?? current.checks ?? {},
    incentives: entry.incentives ?? current.incentives ?? {},
    notes: entry.notes ?? current.notes ?? '',
    updatedBy: actorId,
  };
  const updated = await (await getStore()).update('kpiScorecards', current.id, next);
  return publicScorecard(updated, template);
}

export async function setScorecardStatus({ organizationId, id, status, actorId }) {
  if (!KPI_STATUSES.includes(status)) throw new KPIError('kpi_status_invalid', 400);
  const current = await findOne(
    'kpiScorecards',
    (item) => item.id === String(id) && organizationOf(item) === organizationId
  );
  if (!current) throw new KPIError('kpi_scorecard_not_found', 404);

  const template = requireTemplate(current.templateId);
  const result = scoreScorecard(template, current);
  // Finalising a half-measured month would publish a grade drawn from whichever
  // rows happened to be filled in, so the completeness rule is enforced here
  // rather than left to the UI.
  if (status === 'final' && !result.completeness.complete) {
    throw new KPIError('kpi_scorecard_incomplete', 409, {
      measured: result.completeness.measured,
      kpis: result.completeness.kpis,
      answered: result.completeness.answered,
      checks: result.completeness.checks,
    });
  }

  const updated = await (await getStore()).update('kpiScorecards', current.id, {
    status,
    finalizedAt: status === 'final' ? now() : null,
    finalizedBy: status === 'final' ? actorId : null,
    updatedBy: actorId,
  });
  return publicScorecard(updated, template);
}

export async function deleteScorecard({ organizationId, id }) {
  const current = await findOne(
    'kpiScorecards',
    (item) => item.id === String(id) && organizationOf(item) === organizationId
  );
  if (!current) throw new KPIError('kpi_scorecard_not_found', 404);
  if (current.status === 'final') throw new KPIError('kpi_scorecard_final', 409);
  await (await getStore()).remove('kpiScorecards', current.id);
  return { id: current.id };
}
