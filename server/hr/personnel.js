/**
 * Personnel — the operational half of HR that used to live in e-mail threads.
 *
 * A case is one piece of personnel work about one person: onboarding a new
 * hire, a leave request, a clearance when somebody leaves, a salary increase,
 * missing documents, an insurance operation, or a general employee request.
 * Each type carries its own checklist, and every item names who owns it —
 * Personnel, the employee's manager, or IT — so the case shows at a glance
 * whose move it is.
 *
 * Salary increases and insurance operations are payroll data: creating,
 * reading and editing them needs `hr.payroll`, exactly like the payroll page.
 */

import crypto from 'node:crypto';
import { create, createIfAbsent, find, findOne, getStore, newId, now } from '../store.js';
import { notifyEach } from '../notify.js';
import { can, isActiveUser, PERMISSIONS } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { isIsoDate } from '../../shared/recruitment/sla.js';
import { HRError, forbidden, notFound } from './errors.js';
import { hrSettingsFor } from './settings.js';
import { stableId } from './recruitment/data.js';
import { leaveAnalytics, organizationState } from '../hrModule.js';
import { odooEmployeeIndex } from './odooPeople.js';
import { odooTimeOff } from './odooTimeOff.js';
import { odooResolver, timeOffView } from './odooHR.js';

export const PERSONNEL_TYPES = ['onboarding', 'leave', 'clearance', 'salary_increase', 'documents', 'insurance', 'general'];
export const PAYROLL_TYPES = new Set(['salary_increase', 'insurance']);
export const PERSONNEL_STATUSES = ['open', 'in_progress', 'done', 'cancelled'];
const TRANSITIONS = {
  open: ['in_progress', 'done', 'cancelled'],
  in_progress: ['open', 'done', 'cancelled'],
  done: ['in_progress'],
  cancelled: ['open'],
};

const text = (value, max) => String(value ?? '').trim().slice(0, max);

function personnelAccess(user) {
  return {
    view: can(user, PERMISSIONS.HR_PERSONNEL_VIEW),
    manage: can(user, PERMISSIONS.HR_PERSONNEL_MANAGE),
    payroll: can(user, PERMISSIONS.HR_PAYROLL),
    it: user.department === 'it',
  };
}

/** Who may see one case: Personnel, the manager it names, IT for its IT items, or the employee themselves. */
function canSeeCase(user, access, item, ownCode) {
  if (PAYROLL_TYPES.has(item.type) && !access.payroll) return false;
  if (access.view || access.manage) return true;
  if (item.managerUserId === user.id || item.createdBy === user.id || item.assignedTo === user.id) return true;
  if (access.it && ['onboarding', 'clearance'].includes(item.type)) return true;
  return Boolean(ownCode && item.employeeCode === ownCode);
}

function publicCase(item, { user, access }) {
  const result = structuredClone(item);
  if (result.form) {
    // The token never leaves the server after the moment it was created.
    delete result.form.tokenHash;
  }
  if (result.formSubmission && !(access.manage || access.view)) delete result.formSubmission;
  if (result.formSubmission && !access.payroll) {
    result.formSubmission = { ...result.formSubmission, bankAccount: result.formSubmission.bankAccount ? '••••' : '' };
  }
  result.canManage = access.manage;
  result.canTick = Object.fromEntries((result.checklist ?? []).map((entry) => [entry.id, access.manage || (entry.owner === 'manager' && item.managerUserId === user.id) || (entry.owner === 'it' && access.it)]));
  return result;
}

async function ownEmployeeCode(user) {
  const state = await organizationState(organizationOf(user));
  return [...state.profiles.values()].find((profile) => profile.linkedUserId === user.id)?.employeeCode ?? null;
}

async function casesFor(organizationId) {
  return find('personnelRequests', (item) => organizationOf(item) === organizationId);
}

export async function listPersonnel(user, { type, status } = {}) {
  const access = personnelAccess(user);
  const ownCode = await ownEmployeeCode(user);
  let items = (await casesFor(organizationOf(user))).filter((item) => canSeeCase(user, access, item, ownCode));
  if (type) items = items.filter((item) => item.type === type);
  if (status) items = items.filter((item) => String(status).split(',').includes(item.status));
  items.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  return { cases: items.map((item) => publicCase(item, { user, access })), access };
}

export async function personnelCase(user, id) {
  const access = personnelAccess(user);
  const item = await findOne('personnelRequests', (row) => row.id === String(id) && organizationOf(row) === organizationOf(user));
  if (!item) throw notFound('personnel_case_not_found');
  if (!canSeeCase(user, access, item, await ownEmployeeCode(user))) throw forbidden(PERMISSIONS.HR_PERSONNEL_VIEW);
  return { case: publicCase(item, { user, access }), access };
}

/**
 * Leave balances as the leave workbook states them, for the Leave page.
 * Personnel and HR viewers see everyone; anybody else sees only their own row.
 */
export async function leaveOverview(user) {
  const access = personnelAccess(user);
  const state = await organizationState(organizationOf(user));
  const dataset = state.bySource.leave ?? null;
  const all = dataset?.payload?.balances ?? [];
  const everyone = access.view || access.manage || can(user, PERMISSIONS.HR_VIEW);
  const ownCode = everyone ? null : await ownEmployeeCode(user);
  const balances = everyone ? all : all.filter((balance) => ownCode && String(balance.employeeCode) === ownCode);
  // Live time off from Odoo beside the workbook: every request for HR and
  // Personnel, only the reader's own for anyone else.
  const [index, timeOff] = await Promise.all([odooEmployeeIndex({ timeoutMs: 4000 }), odooTimeOff({ timeoutMs: 4000 })]);
  let odoo = { connected: false };
  if (index && timeOff) {
    const resolver = odooResolver([...state.profiles.values()], index);
    const code = everyone ? null : ownCode ?? (await ownEmployeeCode(user));
    const own = code ? resolver.odooFor(code) : null;
    odoo = timeOffView(timeOff, resolver, { everyone, ownOdooId: own?.id ?? null });
  }
  return {
    balances: balances.map(({ records: _records, ...balance }) => balance),
    analytics: everyone ? leaveAnalytics(dataset) : null,
    source: dataset ? { fileName: dataset.fileName ?? null, importedAt: dataset.importedAt ?? null } : null,
    selfOnly: !everyone,
    odoo,
  };
}

function checklistFrom(list) {
  return (list ?? []).map((entry) => ({ id: entry.id, ar: entry.ar, en: entry.en, owner: entry.owner, done: false, doneBy: null, doneAt: null }));
}

function cleanDetails(type, input) {
  const details = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const date = (value) => (value ? (isIsoDate(String(value)) ? String(value) : (() => { throw new HRError('personnel_date_invalid'); })()) : null);
  const money = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new HRError('personnel_amount_invalid');
    return number;
  };
  switch (type) {
    case 'leave':
      return { leaveType: text(details.leaveType, 40), from: date(details.from), to: date(details.to), days: money(details.days) };
    case 'salary_increase':
      return { currentSalary: money(details.currentSalary), proposedSalary: money(details.proposedSalary), effectiveDate: date(details.effectiveDate), reason: text(details.reason, 500) };
    case 'insurance':
      return { operation: text(details.operation, 60), effectiveDate: date(details.effectiveDate) };
    case 'documents':
      return { documents: Array.isArray(details.documents) ? details.documents.map((doc) => text(doc, 60)).filter(Boolean).slice(0, 20) : [] };
    case 'clearance':
      return { lastWorkingDay: date(details.lastWorkingDay), reason: text(details.reason, 200) };
    case 'onboarding':
      return { startDate: date(details.startDate), office: text(details.office, 80), accounts: text(details.accounts, 500) };
    default:
      return { subject: text(details.subject, 120) };
  }
}

export async function createPersonnelCase(user, input = {}) {
  const access = personnelAccess(user);
  if (!access.manage) throw forbidden(PERMISSIONS.HR_PERSONNEL_MANAGE);
  const type = String(input.type ?? '');
  if (!PERSONNEL_TYPES.includes(type)) throw new HRError('personnel_type_invalid');
  if (PAYROLL_TYPES.has(type) && !access.payroll) throw forbidden(PERMISSIONS.HR_PAYROLL);
  const organizationId = organizationOf(user);
  const state = await organizationState(organizationId);
  const employeeCode = input.employeeCode ? String(input.employeeCode) : null;
  if (employeeCode && !state.profiles.has(employeeCode)) throw new HRError('hr_employee_not_found', 404);
  if (!employeeCode && type !== 'onboarding' && type !== 'general') throw new HRError('personnel_employee_required');
  const { settings } = await hrSettingsFor(organizationId);
  const checklist = type === 'onboarding'
    ? checklistFrom(settings.personnel.onboardingChecklist)
    : type === 'clearance'
      ? checklistFrom(settings.personnel.clearanceChecklist)
      : [];
  const profile = employeeCode ? state.profiles.get(employeeCode) : null;
  const item = await create('personnelRequests', {
    id: `prq-${newId()}`,
    organizationId,
    type,
    status: 'open',
    title: text(input.title, 140) || (profile ? profile.nameArabic || profile.nameEnglish : ''),
    employeeCode,
    candidate: type === 'onboarding' ? { name: text(input.candidate?.name, 120) } : null,
    jobTitle: text(input.jobTitle, 140) || profile?.title || '',
    department: text(input.department, 80) || profile?.department || '',
    location: text(input.location, 60),
    managerUserId: input.managerUserId ? String(input.managerUserId) : null,
    assignedTo: input.assignedTo ? String(input.assignedTo) : null,
    details: cleanDetails(type, input.details),
    checklist,
    notes: text(input.notes, 2000),
    createdBy: user.id,
    timeline: [{ type: 'created', actorId: user.id, at: now(), note: '' }],
  });
  return personnelCase(user, item.id);
}

export async function updatePersonnelCase(user, id, input = {}) {
  const access = personnelAccess(user);
  const item = await findOne('personnelRequests', (row) => row.id === String(id) && organizationOf(row) === organizationOf(user));
  if (!item) throw notFound('personnel_case_not_found');
  if (!access.manage) throw forbidden(PERMISSIONS.HR_PERSONNEL_MANAGE);
  if (PAYROLL_TYPES.has(item.type) && !access.payroll) throw forbidden(PERMISSIONS.HR_PAYROLL);
  const patch = {};
  const timeline = [...(item.timeline ?? [])];
  if (input.status !== undefined && input.status !== item.status) {
    if (!(TRANSITIONS[item.status] ?? []).includes(input.status)) throw new HRError('personnel_transition_invalid', 409, { from: item.status, to: input.status });
    patch.status = input.status;
    timeline.push({ type: `status.${input.status}`, actorId: user.id, at: now(), note: text(input.comment, 500) });
  }
  for (const key of ['title', 'jobTitle', 'department', 'location', 'notes']) {
    if (input[key] !== undefined) patch[key] = text(input[key], key === 'notes' ? 2000 : 140);
  }
  if (input.assignedTo !== undefined) patch.assignedTo = input.assignedTo ? String(input.assignedTo) : null;
  if (input.managerUserId !== undefined) patch.managerUserId = input.managerUserId ? String(input.managerUserId) : null;
  if (input.candidate !== undefined && item.type === 'onboarding') patch.candidate = { name: text(input.candidate?.name, 120) };
  if (input.details !== undefined) patch.details = { ...item.details, ...cleanDetails(item.type, { ...item.details, ...input.details }) };
  if (!Object.keys(patch).length) throw new HRError('personnel_patch_empty');
  patch.timeline = timeline;
  await (await getStore()).update('personnelRequests', item.id, patch);
  return personnelCase(user, item.id);
}

export async function tickChecklist(user, id, itemId, { done }) {
  const access = personnelAccess(user);
  const item = await findOne('personnelRequests', (row) => row.id === String(id) && organizationOf(row) === organizationOf(user));
  if (!item) throw notFound('personnel_case_not_found');
  const entry = (item.checklist ?? []).find((row) => row.id === itemId);
  if (!entry) throw notFound('personnel_checklist_item_not_found');
  const allowed = access.manage || (entry.owner === 'manager' && item.managerUserId === user.id) || (entry.owner === 'it' && access.it);
  if (!allowed) throw forbidden(PERMISSIONS.HR_PERSONNEL_MANAGE);
  if (['done', 'cancelled'].includes(item.status)) throw new HRError('personnel_case_closed', 409);
  const checklist = item.checklist.map((row) => (row.id === itemId ? { ...row, done: Boolean(done), doneBy: done ? user.id : null, doneAt: done ? now() : null } : row));
  const patch = { checklist, timeline: [...(item.timeline ?? []), { type: done ? 'checked' : 'unchecked', actorId: user.id, at: now(), note: entry.en }] };
  if (item.status === 'open') patch.status = 'in_progress';
  await (await getStore()).update('personnelRequests', item.id, patch);
  return personnelCase(user, item.id);
}

/* ── New hire handoff ────────────────────────────────────────────── */

/**
 * A completed recruitment request becomes onboarding cases — one per accepted
 * hire, with deterministic ids so completing, reopening and completing again
 * cannot open the same newcomer twice — and Personnel, the hiring manager and
 * IT are told.
 */
export async function createOnboardingHandoff({ organizationId, request, actor }) {
  const { settings } = await hrSettingsFor(organizationId);
  const hires = Math.max(1, Math.min(50, Number(request.accepted) || Number(request.headcount) || 1));
  const created = [];
  for (let index = 0; index < hires; index += 1) {
    const result = await createIfAbsent('personnelRequests', {
      id: stableId('prq-onb', organizationId, request.id, index),
      organizationId,
      type: 'onboarding',
      status: 'open',
      title: request.title,
      employeeCode: null,
      candidate: { name: '' },
      hireIndex: index + 1,
      hireCount: hires,
      jobTitle: request.title,
      department: request.department,
      location: request.location,
      managerUserId: request.requestedBy ?? null,
      assignedTo: null,
      recruitmentRequestId: request.id,
      recruitmentReference: request.reference,
      details: { startDate: null, office: '', accounts: '' },
      checklist: checklistFrom(settings.personnel.onboardingChecklist),
      notes: '',
      createdBy: actor?.id ?? null,
      createdAt: now(),
      updatedAt: now(),
      timeline: [{ type: 'handoff_from_recruitment', actorId: actor?.id ?? null, at: now(), note: request.reference }],
    });
    if (result.created) created.push(result.doc);
  }
  if (!created.length) return created;
  const users = await find('users', (user) => organizationOf(user) === organizationId && isActiveUser(user));
  const personnel = users.filter((user) => can(user, PERMISSIONS.HR_PERSONNEL_MANAGE)).map((user) => user.id);
  const it = users.filter((user) => user.department === 'it').map((user) => user.id);
  const manager = request.requestedBy ? [request.requestedBy] : [];
  const payload = {
    type: 'personnel.onboarding',
    title: { ar: 'موظف جديد في الطريق — ابدأ التهيئة', en: 'A new hire is on the way — start onboarding' },
    body: { ar: `${request.title} · ${request.department || ''} · ${request.location || ''}`.trim(), en: `${request.title} · ${request.department || ''} · ${request.location || ''}`.trim() },
    link: `/hr/personnel/onboarding?case=${encodeURIComponent(created[0].id)}`,
  };
  await notifyEach([...personnel, ...manager, ...it], actor?.id ?? null, payload);
  return created;
}

/* ── Secure New Employee Form ────────────────────────────────────── */

const FORM_TTL_DAYS = 14;
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * A one-time link a new hire can open without an account. The token is shown
 * once, stored only as a hash, expires in two weeks and accepts one submission.
 */
export async function createFormLink(user, caseId) {
  const access = personnelAccess(user);
  if (!access.manage) throw forbidden(PERMISSIONS.HR_PERSONNEL_MANAGE);
  const item = await findOne('personnelRequests', (row) => row.id === String(caseId) && organizationOf(row) === organizationOf(user));
  if (!item) throw notFound('personnel_case_not_found');
  if (item.type !== 'onboarding') throw new HRError('personnel_form_onboarding_only');
  // One live link per case: a new link retires the one before it, so a link
  // sent to the wrong address can be replaced without leaving it usable.
  if (item.form?.id && !item.form.submittedAt) {
    await (await getStore()).update('personnelForms', item.form.id, { revokedAt: now(), revokedBy: user.id });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + FORM_TTL_DAYS * 86_400_000).toISOString();
  const form = await create('personnelForms', {
    id: `pfm-${newId()}`,
    organizationId: item.organizationId,
    caseId: item.id,
    tokenHash: hashToken(token),
    expiresAt,
    submittedAt: null,
    createdBy: user.id,
  });
  await (await getStore()).update('personnelRequests', item.id, {
    form: { id: form.id, expiresAt, submittedAt: null, createdAt: form.createdAt },
    timeline: [...(item.timeline ?? []), { type: 'form_link_created', actorId: user.id, at: now(), note: '' }],
  });
  return { url: `/hr-form/${token}`, expiresAt };
}

async function formByToken(token) {
  if (!/^[\w-]{30,80}$/.test(String(token ?? ''))) return null;
  const hash = hashToken(token);
  const form = await findOne('personnelForms', (row) => row.tokenHash === hash);
  if (!form || form.submittedAt || form.revokedAt || Date.parse(form.expiresAt) < Date.now()) return null;
  return form;
}

export async function publicForm(token) {
  const form = await formByToken(token);
  if (!form) throw notFound('personnel_form_not_found');
  const item = await findOne('personnelRequests', (row) => row.id === form.caseId);
  if (!item) throw notFound('personnel_form_not_found');
  // A stranger holding the link learns the job they were hired for — nothing else.
  return { jobTitle: item.jobTitle, department: item.department, location: item.location, expiresAt: form.expiresAt };
}

const FORM_FIELDS = {
  fullNameArabic: 120,
  fullNameEnglish: 120,
  nationalId: 20,
  birthDate: 10,
  mobile: 20,
  personalEmail: 120,
  address: 300,
  education: 120,
  graduationYear: 4,
  maritalStatus: 40,
  militaryStatus: 40,
  emergencyContactName: 120,
  emergencyContactPhone: 20,
  bankAccount: 40,
};

export async function submitPublicForm(token, input = {}) {
  const form = await formByToken(token);
  if (!form) throw notFound('personnel_form_not_found');
  const submission = {};
  for (const [key, max] of Object.entries(FORM_FIELDS)) submission[key] = text(input[key], max);
  const required = ['fullNameArabic', 'fullNameEnglish', 'nationalId', 'birthDate', 'mobile', 'emergencyContactName', 'emergencyContactPhone'];
  const missing = required.filter((key) => !submission[key]);
  if (missing.length) throw new HRError('personnel_form_incomplete', 400, { missing });
  if (!/^\d{14}$/.test(submission.nationalId) && !/^[A-Z0-9]{6,20}$/i.test(submission.nationalId)) throw new HRError('personnel_form_national_id_invalid');
  if (!isIsoDate(submission.birthDate)) throw new HRError('personnel_form_birth_date_invalid');
  if (submission.personalEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(submission.personalEmail)) throw new HRError('personnel_form_email_invalid');
  const stamp = now();
  // The receipt is the lock: its id is fixed per form, so of two submissions
  // racing each other exactly one inserts it and the other is turned away.
  const receipt = await createIfAbsent('personnelForms', { id: stableId('pfs', form.id), organizationId: form.organizationId, receiptFor: form.id, caseId: form.caseId, submittedAt: stamp });
  if (!receipt.created) throw notFound('personnel_form_not_found');
  await (await getStore()).update('personnelForms', form.id, { submittedAt: stamp });
  const item = await findOne('personnelRequests', (row) => row.id === form.caseId);
  if (item) {
    await (await getStore()).update('personnelRequests', item.id, {
      formSubmission: submission,
      candidate: { name: submission.fullNameArabic || submission.fullNameEnglish },
      form: { ...(item.form ?? {}), submittedAt: stamp },
      timeline: [...(item.timeline ?? []), { type: 'form_submitted', actorId: null, at: stamp, note: '' }],
    });
    const users = await find('users', (user) => organizationOf(user) === item.organizationId && isActiveUser(user) && can(user, PERMISSIONS.HR_PERSONNEL_MANAGE));
    await notifyEach(users.map((user) => user.id), null, {
      type: 'personnel.form_submitted',
      title: { ar: 'موظف جديد أكمل نموذج البيانات', en: 'A new hire completed their form' },
      body: { ar: submission.fullNameArabic || submission.fullNameEnglish, en: submission.fullNameEnglish || submission.fullNameArabic },
      link: `/hr/personnel/onboarding?case=${encodeURIComponent(item.id)}`,
    });
  }
  return { ok: true };
}
