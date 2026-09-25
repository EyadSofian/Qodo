/**
 * Legacy recruitment workbook → Qodo job requests.
 *
 * Runs at boot and after every recruitment workbook upload, and is safe to run
 * any number of times:
 *
 *  • Each workbook row gets a content key (normalised role, active date,
 *    location — or the report number when there is no date) and a
 *    deterministic id derived from it, written with `createIfAbsent`. A restart
 *    or a re-upload of the same jobs therefore never creates a second copy.
 *  • A job, once imported, belongs to Qodo. A later workbook never overwrites
 *    it; differences are reported by `recruitmentReconciliation` instead.
 *
 * Nothing is invented. There is no approval history in the workbook, so none
 * is written — the sheet's own "Validation" value is kept as `legacyValidation`
 * and shown as such. There is no completion date on any "done" row in
 * production, so a migrated completed job has an unknown SLA outcome and never
 * counts toward a reward or the hiring-target KPI. A priority is only derived
 * when the declared hiring period sits inside one of the approved bands.
 */

import { createIfAbsent, find, findOne } from '../../store.js';
import { classificationFromTitle, locationCode } from '../../../shared/recruitment/classification.js';
import { isIsoDate, localDay, priorityForHiringPeriod, slaBand, workingDaysBetween } from '../../../shared/recruitment/sla.js';
import { recruitmentPolicy } from '../../../shared/recruitment/settings.js';
import { appendActivity, odooLinksFor, requestsFor, setOdooLink, stableId } from './data.js';
import { hrSettingsFor } from '../settings.js';

export const MIGRATION_VERSION = 1;

const STATUS_MAP = { active: 'hiring', hold: 'on_hold', done: 'completed' };

function normalise(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function legacyKey(row) {
  const role = normalise(row.role);
  const location = normalise(row.location);
  return isIsoDate(row.activeDate) ? `${role}|${row.activeDate}|${location}` : `${role}|-|${location}|#${row.sequence}`;
}

export const legacyRequestId = (organizationId, row) => stableId('rrq-legacy', organizationId, legacyKey(row));

/** Which Qodo department reviews a request, from the workbook's free-text department. */
export function departmentIdFor(label) {
  const text = String(label ?? '').toLowerCase();
  if (/sales|telesales|b2b|b2c/.test(text)) return 'sales';
  if (/market/.test(text)) return 'marketing';
  if (/human|\bhr\b|recruit/.test(text)) return 'hr';
  if (/instructor|training|lms|academ|e-?learning/.test(text)) return 'training';
  if (/financ|account/.test(text)) return 'finance';
  if (/\bit\b|develop|tech|odoo|software/.test(text)) return 'it';
  if (/\bops\b|operation/.test(text)) return 'operations';
  return 'general';
}

const HR_DEPARTMENT = /human\s*resources|recruit|talent|^hr$/i;

/**
 * A workbook assignee ("Shahinda", "Salah") → one employee code, or null.
 *
 * Only inside the HR department, only when every token the sheet wrote is a
 * leading token of exactly one person's name, preferring the one active match.
 * "Fatima" does not become "Fatma": an unresolved name is kept as text and
 * reported, never guessed.
 */
export function resolveAssignee(raw, employees) {
  const tokens = normalise(raw).split(' ').filter(Boolean);
  if (!tokens.length) return null;
  const hr = employees.filter((employee) => HR_DEPARTMENT.test(String(employee.department ?? '').trim()));
  const matches = hr.filter((employee) =>
    [employee.nameEnglish, employee.nameArabic].some((name) => {
      const parts = normalise(name).split(' ');
      return tokens.every((token, index) => parts[index] === token);
    })
  );
  const unique = [...new Map(matches.map((employee) => [employee.employeeCode, employee])).values()];
  const active = unique.filter((employee) => employee.status === 'active');
  if (active.length === 1) return active[0].employeeCode;
  return unique.length === 1 ? unique[0].employeeCode : null;
}

function reasonFor(value) {
  const key = normalise(value);
  if (key === 'new') return 'new';
  if (key.startsWith('replace')) return 'replacement';
  return '';
}

/** One workbook row as a Qodo request document. Pure — the tests call it directly. */
export function legacyRequestFromRow(row, { organizationId, employees, policy, dataset, today }) {
  const status = STATUS_MAP[row.status] ?? 'on_hold';
  const priority = priorityForHiringPeriod(row.hiringPeriodDays);
  const assignees = (row.assignedTo ?? []).map((name) => ({ name, employeeCode: resolveAssignee(name, employees) }));
  const resolved = assignees.filter((item) => item.employeeCode);
  const classification = classificationFromTitle(row.role);

  let sla = null;
  if (isIsoDate(row.activeDate)) {
    const declared = isIsoDate(row.dueDate) && row.dueDate >= row.activeDate
      ? workingDaysBetween(row.activeDate, row.dueDate, policy.calendar)
      : null;
    const target = declared ?? (priority ? slaBand(priority, policy.bands)?.default ?? null : null);
    if (target !== null) {
      sla = {
        startDate: row.activeDate,
        targetWorkingDays: target,
        targetSource: declared !== null ? 'legacy_due_date' : 'band_default',
        originalDueDate: isIsoDate(row.dueDate) ? row.dueDate : null,
        currentDueDate: isIsoDate(row.dueDate) ? row.dueDate : null,
        extendedWorkingDays: 0,
        pausedWorkingDays: 0,
        // The workbook does not say when a hold began; the clock is paused from
        // the day the job reached Qodo, which charges nothing retroactively.
        pausedSince: status === 'on_hold' ? today : null,
        completedAt: status === 'completed' && isIsoDate(row.actualHiringDate) ? row.actualHiringDate : null,
        actualWorkingDays: null,
        slaMet: null,
      };
      if (sla.completedAt) {
        const actual = workingDaysBetween(row.activeDate, sla.completedAt, policy.calendar);
        sla.actualWorkingDays = actual;
        sla.slaMet = actual <= target;
      }
    }
  }

  return {
    id: legacyRequestId(organizationId, row),
    organizationId,
    reference: `LEG-${row.sequence}`,
    source: 'legacy_workbook',
    status,
    statusChangedAt: null,
    title: row.role,
    department: row.department || '',
    departmentId: departmentIdFor(row.department),
    location: row.location || '',
    locationCode: locationCode(row.location),
    headcount: Math.max(0, Number(row.numberNeeded) || 0),
    accepted: Math.max(0, Number(row.accepted) || 0),
    classification,
    classificationSource: classification ? 'derived_from_title' : null,
    priority,
    prioritySource: priority ? 'legacy_hiring_period' : null,
    reason: reasonFor(row.vacancyReason),
    reasonNote: '',
    responsibilities: '',
    tasks: '',
    successIndicators: '',
    requirements: '',
    requirementChecks: { demo: false, technicalTest: false, offer: false },
    presentationRequirement: '',
    salaryRange: { min: null, max: null, currency: null, text: row.salaryRange || '' },
    actualSalary: row.actualSalary || '',
    targetWorkingDays: sla?.targetWorkingDays ?? null,
    recruiterCode: resolved[0]?.employeeCode ?? null,
    supportRecruiterCodes: resolved.slice(1).map((item) => item.employeeCode),
    unresolvedAssignees: assignees.filter((item) => !item.employeeCode).map((item) => item.name),
    assignedAt: null,
    interviewManager: { name: row.interviewer || '', userId: null },
    requestedBy: null,
    requestedByName: '',
    notes: row.feedback || '',
    legacyValidation: row.validation || '',
    sla,
    revision: 1,
    legacy: {
      key: legacyKey(row),
      rowId: row.id,
      sequence: row.sequence,
      period: dataset?.payload?.period ?? null,
      fileName: dataset?.fileName ?? null,
      importedAt: dataset?.importedAt ?? null,
      priority: row.priority,
      seniority: row.seniority,
      hiringPeriodDays: row.hiringPeriodDays,
      activeDate: row.activeDate,
      dueDate: row.dueDate,
      actualHiringDate: row.actualHiringDate,
      status: row.status,
      stages: {
        receivedRequirements: row.receivedRequirements,
        published: row.published,
        receivedCandidates: row.receivedCandidates,
      },
      assignedTo: row.assignedTo ?? [],
    },
    migration: { version: MIGRATION_VERSION, at: today },
  };
}

async function datasetsFor(organizationId) {
  const [recruitment, master, oldLinks] = await Promise.all([
    findOne('hrDatasets', (dataset) => dataset.id === `hr-dataset:${organizationId}:recruitment`),
    findOne('hrDatasets', (dataset) => dataset.id === `hr-dataset:${organizationId}:master`),
    findOne('hrRecruitmentLinks', (document) => document.id === `hr-recruitment-links:${organizationId}`),
  ]);
  return { recruitment, employees: master?.payload?.employees ?? [], oldLinks: oldLinks?.links ?? {}, oldLinksBy: oldLinks?.updatedBy ?? null };
}

/** Import every workbook row not yet in Qodo. Returns what it did. */
export async function migrateLegacyRecruitment(organizationId, { today = localDay() } = {}) {
  const { recruitment, employees, oldLinks, oldLinksBy } = await datasetsFor(organizationId);
  const rows = recruitment?.payload?.requests ?? [];
  if (!rows.length) return { total: 0, created: 0, existing: 0 };
  const { settings } = await hrSettingsFor(organizationId);
  const policy = recruitmentPolicy(settings);
  const links = await odooLinksFor(organizationId);

  let created = 0;
  let existing = 0;
  for (const row of rows) {
    const document = legacyRequestFromRow(row, { organizationId, employees, policy, dataset: recruitment, today });
    const result = await createIfAbsent('recruitmentRequests', document);
    if (!result.created) {
      existing += 1;
      continue;
    }
    created += 1;
    await appendActivity({
      organizationId,
      requestId: document.id,
      type: 'imported_from_workbook',
      meta: { fileName: recruitment.fileName, period: document.legacy.period, sequence: row.sequence, assignedTo: row.assignedTo ?? [], unresolved: document.unresolvedAssignees },
    });
    // A manual Odoo link HR already reviewed on the old workbook row carries
    // over. Automatic matches do not — they are re-suggested, not assumed.
    const oldJobId = Number(oldLinks[row.id]);
    if (Number.isInteger(oldJobId) && oldJobId > 0 && !links.has(document.id)) {
      await setOdooLink({ organizationId, requestId: document.id, odooJobId: oldJobId, odooJobName: '', matchType: 'manual', actorId: oldLinksBy });
    }
  }
  return { total: rows.length, created, existing };
}

/**
 * Where the current workbook and Qodo disagree. Qodo is the source of truth;
 * this is a list for a person to look at, never an instruction to overwrite.
 */
export async function recruitmentReconciliation(organizationId) {
  const { recruitment, employees } = await datasetsFor(organizationId);
  const rows = recruitment?.payload?.requests ?? [];
  const requests = await requestsFor(organizationId);
  const byId = new Map(requests.map((request) => [request.id, request]));
  const seen = new Set();
  const differences = [];
  const missing = [];
  for (const row of rows) {
    const id = legacyRequestId(organizationId, row);
    seen.add(id);
    const request = byId.get(id);
    if (!request) {
      missing.push({ legacyKey: legacyKey(row), title: row.role, sequence: row.sequence, status: row.status });
      continue;
    }
    const fields = [];
    const workbookStatus = STATUS_MAP[row.status] ?? row.status;
    if (workbookStatus !== request.status) fields.push({ field: 'status', workbook: workbookStatus, qodo: request.status });
    if ((Number(row.accepted) || 0) !== (Number(request.accepted) || 0)) fields.push({ field: 'accepted', workbook: Number(row.accepted) || 0, qodo: Number(request.accepted) || 0 });
    if ((Number(row.numberNeeded) || 0) !== (Number(request.headcount) || 0)) fields.push({ field: 'headcount', workbook: Number(row.numberNeeded) || 0, qodo: Number(request.headcount) || 0 });
    if ((row.dueDate ?? null) !== (request.sla?.originalDueDate ?? null) && request.source === 'legacy_workbook') fields.push({ field: 'dueDate', workbook: row.dueDate ?? null, qodo: request.sla?.originalDueDate ?? null });
    const workbookRecruiter = resolveAssignee(row.assignedTo?.[0] ?? '', employees);
    if ((workbookRecruiter ?? null) !== (request.recruiterCode ?? null)) fields.push({ field: 'recruiter', workbook: workbookRecruiter ?? row.assignedTo?.[0] ?? null, qodo: request.recruiterCode ?? null });
    if (fields.length) differences.push({ requestId: id, reference: request.reference, title: request.title, fields });
  }
  const orphans = requests
    .filter((request) => request.source === 'legacy_workbook' && !seen.has(request.id))
    .map((request) => ({ requestId: request.id, reference: request.reference, title: request.title, status: request.status }));
  const unresolved = requests
    .filter((request) => (request.unresolvedAssignees ?? []).length)
    .map((request) => ({ requestId: request.id, reference: request.reference, title: request.title, names: request.unresolvedAssignees }));
  return {
    workbook: recruitment ? { fileName: recruitment.fileName, importedAt: recruitment.importedAt, period: recruitment.payload?.period ?? null, rows: rows.length } : null,
    imported: requests.filter((request) => request.source === 'legacy_workbook').length,
    differences,
    missing,
    orphans,
    unresolved,
  };
}

/** Last migration activity, for the Settings screen. */
export async function migrationStatus(organizationId) {
  const imports = await find('recruitmentActivity', (row) => row.organizationId === organizationId && row.type === 'imported_from_workbook');
  const last = imports.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] ?? null;
  return { imported: imports.length, lastImportedAt: last?.createdAt ?? null, version: MIGRATION_VERSION };
}
