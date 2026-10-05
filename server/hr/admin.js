/**
 * HR Settings — reading and changing the policy, the roster and the audit.
 *
 * Reading Settings is open to whoever runs HR (`hr.manage`) so they can see why
 * the desk behaves as it does; changing anything needs `hr.settings.manage`.
 */

import { create, find, now } from '../store.js';
import { ALL_PERMISSIONS, can, isActiveUser, permissionsFor, PERMISSIONS } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { kpiCategories, kpiRules } from '../../shared/recruitment/kpi.js';
import { completionFields, isIsoDate, isWorkingDay, localDay, workingDaysBetween } from '../../shared/recruitment/sla.js';
import { recruitmentPolicy } from '../../shared/recruitment/settings.js';
import { forbidden, HRError } from './errors.js';
import { hrSettingsFor, updateHRSettings } from './settings.js';
import { hrDatasetOverview, hrImportHistory, organizationState, reconciliation, telegramStatus } from '../hrModule.js';
import { odooConfigured } from '../odoo.js';
import { appendActivity, requestsFor, saveRequest } from './recruitment/data.js';
import { deriveRecruitmentTeam, photoUrlFor } from './recruitment/team.js';
import { odooJobsByEmployee, publishedJobsSnapshot, recruitmentSourceIsOdoo } from './recruitment/odooJobs.js';
import { knownPhoto, odooEmployeeIndex, odooOnlyCode } from './odooPeople.js';
import { odooResolver } from './odooHR.js';
import { activeRewardRules, rewardRuleVersions } from './recruitment/rewards.js';
import { legacyRequestId, migrationStatus, recruitmentReconciliation, resolveAssignee, statusFromWorkbook } from './recruitment/migration.js';

function canRead(user) {
  return can(user, PERMISSIONS.HR_SETTINGS_MANAGE) || can(user, PERMISSIONS.HR_MANAGE);
}

const HR_KEYS = ALL_PERMISSIONS.filter((key) => key.startsWith('hr.'));

export async function settingsView(user) {
  if (!canRead(user)) throw forbidden(PERMISSIONS.HR_SETTINGS_MANAGE);
  const organizationId = organizationOf(user);
  const canImport = can(user, PERMISSIONS.HR_MANAGE);
  const [{ settings, revision, updatedAt }, state, requests, rules, versions, migration, users, index, datasets, history] = await Promise.all([
    hrSettingsFor(organizationId),
    organizationState(organizationId),
    requestsFor(organizationId),
    activeRewardRules(organizationId),
    rewardRuleVersions(organizationId),
    migrationStatus(organizationId),
    find('users', (item) => organizationOf(item) === organizationId && isActiveUser(item)),
    odooEmployeeIndex({ timeoutMs: 2500 }),
    canImport ? hrDatasetOverview(organizationId) : null,
    canImport ? hrImportHistory(organizationId, 15) : null,
  ]);
  // The roster as the rules derive it *before* Settings' own exclusions, so an
  // excluded person is still listed (and can be brought back).
  const derived = deriveRecruitmentTeam({ profiles: state.profiles, requests, team: { include: settings.recruitment.team.include, exclude: [] }, odooIndex: index, odooJobOwners: [...odooJobsByEmployee(await publishedJobsSnapshot()).keys()] });
  const excluded = new Set(settings.recruitment.team.exclude.map(String));
  const hrEmployees = [...state.profiles.values()]
    .filter((profile) => profile.status === 'active' && profile.sources.master && /human\s*resources|recruit|talent|^hr$/i.test(String(profile.department ?? '').trim()))
    .map((profile) => ({ employeeCode: profile.employeeCode, name: profile.nameEnglish || profile.nameArabic, nameArabic: profile.nameArabic, title: profile.title }));
  return {
    settings,
    revision,
    updatedAt,
    canEdit: can(user, PERMISSIONS.HR_SETTINGS_MANAGE),
    kpi: { categories: kpiCategories(settings), rules: kpiRules(settings) },
    rewardRules: rules,
    rewardVersions: versions.map(({ id, version, createdAt, note }) => ({ id, version, createdAt, note })),
    team: derived.map((member) => ({ ...member, excluded: excluded.has(member.employeeCode) })),
    teamCandidates: hrEmployees.filter((employee) => !derived.some((member) => member.employeeCode === employee.employeeCode)),
    migration,
    odoo: { configured: odooConfigured(), indexLoaded: Boolean(index), employees: index?.rows?.length ?? 0 },
    permissions: {
      keys: HR_KEYS,
      holders: users
        .map((item) => ({ id: item.id, name: item.name, role: item.role, department: item.department, keys: permissionsFor(item).filter((key) => key.startsWith('hr.')) }))
        .filter((item) => item.keys.length)
        .sort((left, right) => right.keys.length - left.keys.length || left.name.localeCompare(right.name)),
    },
    approvers: users.filter((item) => can(item, PERMISSIONS.HR_RECRUITMENT_APPROVE)).map((item) => ({ id: item.id, name: item.name })),
    // Uploading needs `hr.manage`, so only its holders see the import desk.
    imports: canImport ? { datasets, history, telegram: telegramStatus() } : null,
  };
}

export async function saveSettings(user, { patch, revision }) {
  if (!can(user, PERMISSIONS.HR_SETTINGS_MANAGE)) throw forbidden(PERMISSIONS.HR_SETTINGS_MANAGE);
  return updateHRSettings({ organizationId: organizationOf(user), patch, revision, actorId: user.id });
}

/**
 * Everything that does not line up: the recruitment workbook against Qodo's
 * requests (top level, as the migration reports it), and the employee files
 * against each other and against Qodo accounts (`people`). Payroll gaps are
 * listed only for a payroll holder.
 */
export async function reconciliationView(user) {
  if (!canRead(user)) throw forbidden(PERMISSIONS.HR_SETTINGS_MANAGE);
  const organizationId = organizationOf(user);
  const [recruitment, state, index] = await Promise.all([recruitmentReconciliation(organizationId), organizationState(organizationId), odooEmployeeIndex({ timeoutMs: 4000 })]);
  const gaps = reconciliation(state.profiles, state.positions);
  const payroll = can(user, PERMISSIONS.HR_PAYROLL);
  const person = (code) => {
    const profile = state.profiles.get(code);
    return { employeeCode: code, nameArabic: profile?.nameArabic ?? '', nameEnglish: profile?.nameEnglish ?? '', title: profile?.title ?? '', department: profile?.department ?? '' };
  };
  const positions = new Map(state.positions.map((position) => [position.id, position]));
  return {
    ...recruitment,
    canApplyWorkbook: can(user, PERMISSIONS.HR_SETTINGS_MANAGE) && !recruitmentSourceIsOdoo(),
    // 'odoo': the workbook no longer feeds recruitment, so its differences are not a to-do list.
    jobSource: recruitmentSourceIsOdoo() ? 'odoo' : 'manual',
    people: {
      unlinkedAccounts: gaps.unlinkedAccounts.map(person),
      activeWithoutPayroll: payroll ? gaps.activeWithoutPayroll.map(person) : null,
      payrollWithoutMaster: payroll ? gaps.payrollWithoutMaster.map(person) : null,
      insuranceWithoutMaster: payroll ? gaps.insuranceWithoutMaster.map(person) : null,
      unmatchedPositions: gaps.unmatchedOrganizationPositions.map((id) => ({ id, title: positions.get(id)?.title ?? id, employeeName: positions.get(id)?.employeeName ?? '', department: positions.get(id)?.departmentCode ?? '' })),
      // Working in Odoo, missing from the HR file: HR's list of records to add.
      odooOnly: index
        ? odooResolver([...state.profiles.values()], index).odooOnly.map((row) => ({
            odooId: row.id,
            code: odooOnlyCode(row),
            photoUrl: knownPhoto(row.id) !== false ? photoUrlFor(odooOnlyCode(row)) : null,
            name: String(row.name ?? ''),
            jobTitle: String(row.job_title || ''),
            department: Array.isArray(row.department_id) ? String(row.department_id[1] ?? '') : '',
            workEmail: String(row.work_email || ''),
          }))
        : null,
    },
  };
}

/** Apply the reviewed workbook snapshot. Manual status changes and deadline
 * edits take precedence; untouched legacy dates and Hired rows can be fixed.
 * The exact shape is checked so a stale screen cannot widen the change.
 */
export async function applyRecruitmentWorkbookSnapshot(user, expected = {}) {
  if (!can(user, PERMISSIONS.HR_SETTINGS_MANAGE)) throw forbidden(PERMISSIONS.HR_SETTINGS_MANAGE);
  if (recruitmentSourceIsOdoo()) throw new HRError('recruitment_source_is_odoo', 409);
  if (Number(expected.expectedRows) !== 67 || Number(expected.expectedOutside) !== 58) {
    throw new HRError('recruitment_workbook_snapshot_mismatch', 409);
  }

  const organizationId = organizationOf(user);
  const [state, allRequests, reconciliation, settingsResult] = await Promise.all([
    organizationState(organizationId),
    requestsFor(organizationId, { includeArchived: true }),
    recruitmentReconciliation(organizationId),
    hrSettingsFor(organizationId),
  ]);
  const policy = recruitmentPolicy(settingsResult.settings);
  const workbook = state.bySource.recruitment;
  const rows = workbook?.payload?.requests ?? [];
  const employees = state.bySource.master?.payload?.employees ?? [];
  const rowIds = rows.map((row) => legacyRequestId(organizationId, row));
  const workbookIds = new Set(rowIds);
  const byId = new Map(allRequests.map((request) => [request.id, request]));
  const missing = rowIds.filter((id) => !byId.has(id) || byId.get(id).archivedAt);
  const matchedNonLegacy = rowIds.filter((id) => byId.has(id) && byId.get(id).source !== 'legacy_workbook');
  const outsideWorkbook = allRequests.filter((request) => !workbookIds.has(request.id));
  const outsideLegacy = outsideWorkbook.filter((request) => request.source === 'legacy_workbook');
  const outsideOther = outsideWorkbook.filter((request) => request.source !== 'legacy_workbook');
  const activeOutsideLegacy = outsideLegacy.filter((request) => !request.archivedAt);
  const shapeIsValid = rows.length === 67
    && workbookIds.size === 67
    && reconciliation.missing.length === 0
    && missing.length === 0
    && matchedNonLegacy.length === 0
    && outsideLegacy.length === 58
    && outsideOther.length === 0;
  if (!shapeIsValid) {
    throw new HRError('recruitment_workbook_snapshot_mismatch', 409, {
      workbookRows: rows.length,
      matchedRows: rows.length - missing.length,
      missingRows: missing.length,
      matchedNonLegacy: matchedNonLegacy.length,
      outsideLegacy: outsideLegacy.length,
      outsideOther: outsideOther.length,
      activeRequests: allRequests.filter((request) => !request.archivedAt).length,
    });
  }

  const stamp = now();
  let assignmentsChanged = 0;
  let assignmentsCleared = 0;
  let unresolvedAssignments = 0;
  let statusesChanged = 0;
  let deadlinesChanged = 0;
  for (const row of rows) {
    const request = byId.get(legacyRequestId(organizationId, row));
    const rawNames = (row.assignedTo ?? []).map((value) => String(value ?? '').trim()).filter(Boolean);
    const resolvedCodes = [...new Set(rawNames.map((name) => resolveAssignee(name, employees)).filter(Boolean))];
    const recruiterCode = resolvedCodes[0] ?? null;
    const supportRecruiterCodes = resolvedCodes.slice(1);
    const unresolvedAssignees = rawNames.filter((name) => !resolveAssignee(name, employees));
    const previousCodes = [request.recruiterCode, ...(request.supportRecruiterCodes ?? [])].filter(Boolean);
    const previousUnresolved = request.unresolvedAssignees ?? [];
    const sameAssignment = request.recruiterCode === recruiterCode
      && JSON.stringify(request.supportRecruiterCodes ?? []) === JSON.stringify(supportRecruiterCodes)
      && JSON.stringify(request.unresolvedAssignees ?? []) === JSON.stringify(unresolvedAssignees);
    unresolvedAssignments += unresolvedAssignees.length;
    const patch = {};
    if (!sameAssignment) Object.assign(patch, {
      recruiterCode,
      supportRecruiterCodes,
      unresolvedAssignees,
      assignedAt: recruiterCode ? stamp : null,
      assignedBy: user.id,
    });

    // Hired/Done used to fall through the importer as on-hold. Only repair
    // untouched imported states; a human cancellation or completion wins.
    const workbookStatus = statusFromWorkbook(row.status);
    const statusSynced = workbookStatus === 'completed'
      && ['hiring', 'on_hold'].includes(request.status)
      && !request.statusChangedAt;
    if (statusSynced) {
      const completedAt = isIsoDate(row.actualHiringDate)
        && (!request.sla?.startDate || row.actualHiringDate >= request.sla.startDate)
        && row.actualHiringDate <= localDay()
        ? row.actualHiringDate : null;
      patch.status = 'completed';
      patch.statusChangedAt = stamp;
      if (request.sla) patch.sla = completedAt
        ? { ...request.sla, ...completionFields(request.sla, completedAt, policy.calendar) }
        : { ...request.sla, pausedSince: null, completedAt: null, actualWorkingDays: null, slaMet: null };
    }

    // A new workbook due date can replace an old imported one while the SLA
    // is still untouched. Existing extensions, holds and manual edits remain.
    const deadlineSynced = !statusSynced
      && ['hiring', 'on_hold'].includes(request.status)
      && request.sla?.targetSource === 'legacy_due_date'
      && request.sla.startDate === row.activeDate
      && isIsoDate(row.dueDate)
      && isWorkingDay(row.dueDate, policy.calendar)
      && row.dueDate > row.activeDate
      && request.sla.originalDueDate !== row.dueDate
      && !request.sla.extendedWorkingDays
      && !request.sla.pausedWorkingDays
      && !request.sla.pausedSince;
    if (deadlineSynced) {
      const targetWorkingDays = workingDaysBetween(row.activeDate, row.dueDate, policy.calendar);
      patch.targetWorkingDays = targetWorkingDays;
      patch.sla = { ...request.sla, targetWorkingDays, originalDueDate: row.dueDate, currentDueDate: row.dueDate };
    }

    if (!Object.keys(patch).length) continue;
    await saveRequest(request.id, { ...patch, revision: (request.revision ?? 1) + 1 });
    if (!sameAssignment && request.recruiterCode !== recruiterCode) {
      await create('recruitmentAssignments', {
        organizationId,
        requestId: request.id,
        recruiterCode,
        previousRecruiterCode: request.recruiterCode ?? null,
        actorId: user.id,
        actorName: user.name,
        reason: 'Recruitment workbook snapshot',
        override: false,
        overrideReason: '',
        capacity: null,
      });
    }
    if (!sameAssignment) {
      await appendActivity({
        organizationId,
        requestId: request.id,
        type: 'workbook_assignment_synced',
        actorId: user.id,
        meta: { sequence: row.sequence, previousCodes, recruiterCode, supportRecruiterCodes, unresolvedAssignees },
      });
      assignmentsChanged += 1;
      if ((previousCodes.length || previousUnresolved.length) && !recruiterCode && !supportRecruiterCodes.length && !unresolvedAssignees.length) assignmentsCleared += 1;
    }
    if (statusSynced) {
      await appendActivity({ organizationId, requestId: request.id, type: 'workbook_status_synced', actorId: user.id, meta: { sequence: row.sequence, from: request.status, to: 'completed', actualHiringDate: row.actualHiringDate ?? null } });
      statusesChanged += 1;
    }
    if (deadlineSynced) {
      await appendActivity({ organizationId, requestId: request.id, type: 'workbook_deadline_synced', actorId: user.id, meta: { sequence: row.sequence, previousDueDate: request.sla.originalDueDate, newDueDate: row.dueDate } });
      deadlinesChanged += 1;
    }
  }

  for (const request of activeOutsideLegacy) {
    await saveRequest(request.id, {
      archivedAt: stamp,
      archivedBy: user.id,
      archiveReason: 'not_in_current_workbook',
      revision: (request.revision ?? 1) + 1,
    });
    await appendActivity({
      organizationId,
      requestId: request.id,
      type: 'archived',
      actorId: user.id,
      meta: { reason: 'not_in_current_workbook', workbookFileName: workbook.fileName ?? null },
    });
  }

  return { workbookRows: rows.length, assignmentsChanged, assignmentsCleared, unresolvedAssignments, statusesChanged, deadlinesChanged, archived: activeOutsideLegacy.length };
}

/**
 * The recruitment audit trail — approvals, assignments (with overrides),
 * extensions, KPI deductions and request activity — newest first.
 */
export async function auditLog(user, { limit = 200 } = {}) {
  if (!canRead(user)) throw forbidden(PERMISSIONS.HR_SETTINGS_MANAGE);
  const organizationId = organizationOf(user);
  const inOrg = (row) => organizationOf(row) === organizationId;
  const [approvals, assignments, extensions, activity, events, users, requests, global] = await Promise.all([
    find('recruitmentApprovals', inOrg),
    find('recruitmentAssignments', inOrg),
    find('recruitmentExtensions', inOrg),
    find('recruitmentActivity', inOrg),
    find('recruitmentKpiEvents', inOrg),
    find('users', inOrg),
    requestsFor(organizationId, { includeArchived: true }),
    find('activity', (row) => inOrg(row) && String(row.action ?? '').startsWith('hr.')),
  ]);
  const names = new Map(users.map((item) => [item.id, item.name]));
  const titles = new Map(requests.map((request) => [request.id, `${request.reference} · ${request.title}`]));
  const rows = [
    ...approvals.map((row) => ({ kind: 'approval', at: row.createdAt, actor: row.actorName || names.get(row.actorId) || '', subject: titles.get(row.requestId) ?? row.requestId, requestId: row.requestId, detail: { stage: row.stage, decision: row.decision, from: row.fromStatus, to: row.toStatus, comment: row.comment } })),
    ...assignments.map((row) => ({ kind: row.override ? 'capacity_override' : 'assignment', at: row.createdAt, actor: row.actorName || names.get(row.actorId) || '', subject: titles.get(row.requestId) ?? row.requestId, requestId: row.requestId, detail: { recruiter: row.recruiterCode, previous: row.previousRecruiterCode, reason: row.reason, overrideReason: row.overrideReason } })),
    ...extensions.map((row) => ({ kind: 'extension', at: row.createdAt, actor: row.actorName || names.get(row.actorId) || '', subject: titles.get(row.requestId) ?? row.requestId, requestId: row.requestId, detail: { previousDueDate: row.previousDueDate, newDueDate: row.newDueDate, added: row.addedWorkingDays, reason: row.reason, note: row.note } })),
    ...events.map((row) => ({ kind: row.voidedAt ? 'kpi_void' : 'kpi_deduction', at: row.voidedAt ?? row.createdAt, actor: names.get(row.voidedBy ?? row.reviewerId) || (row.source === 'automatic' ? 'Qodo' : ''), subject: `#${row.employeeCode}`, requestId: row.requestId, detail: { rule: row.rule, deduction: row.deduction, reason: row.voidReason || row.reason, source: row.source } })),
    ...activity.filter((row) => ['created', 'edited', 'priority_changed', 'accepted_recorded', 'odoo_linked', 'odoo_unlinked', 'imported_from_workbook', 'workbook_assignment_synced', 'archived', 'restored'].includes(row.type)).map((row) => ({ kind: row.type, at: row.createdAt, actor: names.get(row.actorId) || (row.actorId ? '' : 'Qodo'), subject: titles.get(row.requestId) ?? row.requestId, requestId: row.requestId, detail: row.meta })),
    ...global.map((row) => ({ kind: row.action, at: row.createdAt, actor: names.get(row.actorId) || '', subject: row.subjectId, requestId: null, detail: row.meta })),
  ];
  return {
    rows: rows.sort((left, right) => String(right.at).localeCompare(String(left.at))).slice(0, Math.max(1, Math.min(1000, Number(limit) || 200))),
  };
}
