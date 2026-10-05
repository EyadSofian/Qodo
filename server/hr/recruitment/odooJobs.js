/** The published Egypt - Engoaad positions shown by Odoo's Recruitment board. */

import { searchRead, odooConfigured } from '../../odoo.js';
import { forbidden } from '../errors.js';
import { hasRecruitmentAccess, recruitmentContext } from './context.js';

const COMPANY_ID = 2;
const COMPANY_NAME = 'Egypt - Engoaad';
const CACHE_MS = 90_000;
let cache = null;

const relation = (value) => Array.isArray(value) ? { id: Number(value[0]), name: String(value[1] || '') } : null;
const baseUrl = () => String(process.env.ODOO_URL || '').replace(/\/+$/, '');

async function publishedJobs({ refresh = false } = {}) {
  if (!odooConfigured()) return { configured: false, connected: false, jobs: [], fetchedAt: null };
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  // Match the shared Odoo kanban: company cids=2, Published and active jobs.
  // The server domain is authoritative; a browser filter cannot widen it.
  const rows = await searchRead('hr.job', [
    ['company_id', '=', COMPANY_ID],
    ['is_published', '=', true],
    ['active', '=', true],
  ], [
    'name', 'company_id', 'is_published', 'active', 'user_id', 'department_id',
    'no_of_recruitment', 'application_count', 'new_application_count',
    'applicant_hired', 'website_url',
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
    published: true,
    odooUrl: `${root}/web#id=${row.id}&model=hr.job&view_type=form&cids=${COMPANY_ID}`,
    jobUrl: row.website_url && String(row.website_url).startsWith('/') ? `${root}${row.website_url}` : null,
  }));
  const value = { configured: true, connected: true, companyId: COMPANY_ID, company: COMPANY_NAME, publishedOnly: true, fetchedAt: new Date().toISOString(), jobs };
  cache = { at: Date.now(), value };
  return value;
}

export async function odooPublishedJobs(user, options = {}) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  if (!hasRecruitmentAccess(ctx)) throw forbidden();
  return publishedJobs(options);
}

export async function odooPublishedJobsForHome() {
  return publishedJobs();
}
