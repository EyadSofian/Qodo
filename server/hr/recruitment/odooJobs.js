/**
 * The published Egypt - Engoaad positions shown by Odoo's Recruitment board,
 * and who owns each one (`hr.job.user_id`).
 *
 * This file only reads Odoo. The recruitment desk joins these jobs to Qodo's
 * own picture of a recruiter — limits, SLA, KPI, rewards — in `desk.js`, so a
 * card shows both and neither replaces the other.
 */

import { existingFields, searchRead, odooConfigured } from '../../odoo.js';
import { isIsoDate } from '../../../shared/recruitment/sla.js';

const COMPANY_ID = 2;
const COMPANY_NAME = 'Egypt - Engoaad';
const CACHE_MS = 90_000;
// Which custom schedule fields this Odoo has changes when somebody installs a
// module, not between two reads a minute apart: asked once an hour.
const FIELDS_TTL_MS = 60 * 60 * 1000;
let cache = null;
let refreshing = null;
let scheduleFields = null;

/**
 * The schedule HR keeps on the job in Odoo — Engosoft's own fields, not stock
 * Odoo, so they are asked for only where the database has them:
 *   active_date     the day the clock starts
 *   hiring_period   15 / 30 / 45 / 60 days to fill it
 *   seniority, salary_range_from/to, recruitment_status, published_date
 */
const SCHEDULE_FIELDS = ['active_date', 'hiring_period', 'seniority', 'salary_range_from', 'salary_range_to', 'recruitment_status', 'published_date'];

const relation = (value) => Array.isArray(value) ? { id: Number(value[0]), name: String(value[1] || '') } : null;
const isoDate = (value) => (isIsoDate(String(value || '').slice(0, 10)) ? String(value).slice(0, 10) : null);
const positive = (value) => (Number(value) > 0 ? Number(value) : null);
const baseUrl = () => String(process.env.ODOO_URL || '').replace(/\/+$/, '');

export async function publishedJobs({ refresh = false } = {}) {
  if (!odooConfigured()) return { configured: false, connected: false, jobs: [], fetchedAt: null };
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  // Match the shared Odoo kanban: company cids=2, Published and active jobs.
  // The server domain is authoritative; a browser filter cannot widen it.
  if (!scheduleFields || Date.now() - scheduleFields.at > FIELDS_TTL_MS) {
    scheduleFields = { at: Date.now(), names: await existingFields('hr.job', SCHEDULE_FIELDS) };
  }
  const schedule = scheduleFields.names;
  const rows = await searchRead('hr.job', [
    ['company_id', '=', COMPANY_ID],
    ['is_published', '=', true],
    ['active', '=', true],
  ], [
    'name', 'company_id', 'is_published', 'active', 'user_id', 'department_id',
    'no_of_recruitment', 'application_count', 'new_application_count',
    'applicant_hired', 'website_url', ...schedule,
  ], { limit: 200, order: 'id desc', context: { allowed_company_ids: [COMPANY_ID] } });

  const root = baseUrl();
  const jobs = rows.map((row) => ({
    id: row.id,
    name: String(row.name || ''),
    company: relation(row.company_id)?.name || COMPANY_NAME,
    department: relation(row.department_id)?.name || '',
    recruiter: relation(row.user_id),
    toRecruit: Math.max(0, Number(row.no_of_recruitment) || 0),
    applications: Math.max(0, Number(row.application_count) || 0),
    newApplications: Math.max(0, Number(row.new_application_count) || 0),
    hired: Math.max(0, Number(row.applicant_hired) || 0),
    activeDate: isoDate(row.active_date),
    hiringPeriodDays: positive(row.hiring_period),
    seniority: row.seniority ? String(row.seniority) : null,
    salaryFrom: positive(row.salary_range_from),
    salaryTo: positive(row.salary_range_to),
    recruitmentStatus: row.recruitment_status ? String(row.recruitment_status) : null,
    publishedDate: isoDate(row.published_date),
    published: true,
    odooUrl: `${root}/web#id=${row.id}&model=hr.job&view_type=form&cids=${COMPANY_ID}`,
    jobUrl: row.website_url && String(row.website_url).startsWith('/') ? `${root}${row.website_url}` : null,
  }));
  const owners = new Map(jobs.filter((job) => job.recruiter).map((job) => [job.recruiter.id, job.recruiter.name]));
  // Salah manages the team and must have a card even when no published job is
  // assigned to him. The employee code is stable across Odoo and the HR file.
  const employeeRows = await searchRead('hr.employee', [
    '|', ['user_id', 'in', [...owners.keys()]], ['registration_number', '=', '389'],
  ], ['name', 'user_id', 'registration_number', 'job_title', 'active'], { limit: 100 });
  const employees = new Map(employeeRows.filter((row) => row.active && Array.isArray(row.user_id)).map((row) => [Number(row.user_id[0]), row]));
  const salah = employeeRows.find((row) => row.active && String(row.registration_number) === '389' && Array.isArray(row.user_id));
  if (salah) owners.set(Number(salah.user_id[0]), String(salah.user_id[1]));
  const team = [...owners].map(([id, name]) => {
    const employee = employees.get(id);
    const code = employee?.registration_number ? String(employee.registration_number) : null;
    return {
      id,
      name,
      fullName: employee?.name ? String(employee.name) : name,
      title: employee?.job_title ? String(employee.job_title) : '',
      employeeCode: code,
      photoUrl: code ? `/api/hr/people/${encodeURIComponent(code)}/photo` : null,
    };
  });
  const value = { configured: true, connected: true, companyId: COMPANY_ID, company: COMPANY_NAME, publishedOnly: true, fetchedAt: new Date().toISOString(), jobs, team };
  cache = { at: Date.now(), value };
  return value;
}

/**
 * The last good read for pages that must not wait on Odoo. Only the first call
 * after a restart waits (at most `timeoutMs`); after that a stale copy is
 * served at once and refreshed behind it. Never throws; null means Odoo has
 * not answered yet or is not configured.
 */
export async function publishedJobsSnapshot({ timeoutMs = 2500 } = {}) {
  if (!odooConfigured()) return null;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  refreshing ??= publishedJobs({ refresh: true })
    .catch((error) => {
      console.warn('[hr] Odoo published jobs unavailable:', error?.message ?? error);
      return cache?.value ?? null;
    })
    .finally(() => {
      refreshing = null;
    });
  if (cache) return cache.value;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([refreshing, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether Odoo's published board is the only source of recruitment jobs (the
 * owner's decision for production). A deployment with no Odoo keeps the
 * request workflow, and `HR_RECRUITMENT_SOURCE=manual` turns it back on.
 */
export function recruitmentSourceIsOdoo() {
  return odooConfigured() && process.env.HR_RECRUITMENT_SOURCE !== 'manual';
}

const NO_JOBS = { jobs: 0, toRecruit: 0, newApplications: 0, applications: 0 };

export function odooJobTotals(jobs) {
  return jobs.reduce((sum, job) => ({
    jobs: sum.jobs + 1,
    toRecruit: sum.toRecruit + job.toRecruit,
    newApplications: sum.newApplications + job.newApplications,
    applications: sum.applications + job.applications,
  }), NO_JOBS);
}

/**
 * Published jobs per HR employee code. Odoo names the owner by user; the
 * employee record behind that user carries the code. Every owner Odoo could
 * tie to a code gets an entry, even with no job (the team manager).
 */
export function odooJobsByEmployee(snapshot) {
  const byCode = new Map();
  if (!snapshot?.connected) return byCode;
  for (const member of snapshot.team ?? []) {
    if (!member.employeeCode) continue;
    byCode.set(member.employeeCode, snapshot.jobs.filter((job) => job.recruiter?.id === member.id));
  }
  return byCode;
}

export const __test = { reset: () => { cache = null; refreshing = null; scheduleFields = null; }, seed: (value) => { cache = { at: Date.now(), value }; } };
