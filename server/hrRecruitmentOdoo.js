import { odooConfigured, readGroup, searchRead } from './odoo.js';

const CACHE_MS = 20 * 60 * 1_000;
let cached = null;

function clean(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\bteam\s*leader\b/g, ' teamleader ')
    .replace(/\bt\s*l\b/g, ' teamleader ')
    .replace(/\bops\b/g, ' operation ')
    .replace(/\boperations\b/g, ' operation ')
    .replace(/\be\s*commerce\b/g, ' ecommerce ')
    .replace(/\bvedio\b/g, ' video ')
    .replace(/\bspecialit\b/g, ' specialist ')
    .replace(/\bnormal\b|\bnoraml\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return new Set(clean(value).split(' ').filter((token) => token.length > 1));
}

function similarity(left, right) {
  const leftKey = clean(left);
  const rightKey = clean(right);
  if (!leftKey || !rightKey) return 0;
  if (leftKey === rightKey) return 1;
  const a = tokens(leftKey);
  const b = tokens(rightKey);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const containment = intersection / Math.max(1, Math.min(a.size, b.size));
  const jaccard = intersection / Math.max(1, union);
  const contains = leftKey.includes(rightKey) || rightKey.includes(leftKey);
  return Math.min(0.99, jaccard * 0.58 + containment * 0.32 + (contains ? 0.1 : 0));
}

function bestJob(role, jobs) {
  const ranked = jobs
    .map((job) => ({ job, score: similarity(role, job.name) }))
    .sort((left, right) => right.score - left.score || right.job.id - left.job.id);
  const first = ranked[0];
  const second = ranked[1];
  if (!first || first.score < 0.58) return null;
  if (first.score < 0.86 && second && first.score - second.score < 0.08) return null;
  return first;
}

function relationId(value) {
  return Array.isArray(value) ? Number(value[0]) : null;
}

async function readOdooState() {
  if (!odooConfigured()) {
    return { configured: false, jobs: [], applicantByJob: new Map(), stagesByJob: new Map(), applicantsAvailable: false };
  }
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const jobs = await searchRead(
    'hr.job',
    [],
    ['name', 'active', 'expected_employees', 'department_id', 'published_date', 'job_open_date'],
    { limit: 600, order: 'id desc', context: { active_test: false } }
  );

  const [countsResult, stagesResult] = await Promise.allSettled([
    readGroup('hr.applicant', [], ['job_id']),
    readGroup('hr.applicant', [], ['job_id', 'stage_id']),
  ]);
  const applicantByJob = new Map();
  if (countsResult.status === 'fulfilled') {
    countsResult.value.forEach((row) => {
      const jobId = relationId(row.job_id);
      if (jobId) applicantByJob.set(jobId, Number(row.__count || 0));
    });
  }
  const stagesByJob = new Map();
  if (stagesResult.status === 'fulfilled') {
    stagesResult.value.forEach((row) => {
      const jobId = relationId(row.job_id);
      if (!jobId) return;
      const stage = Array.isArray(row.stage_id) ? String(row.stage_id[1]) : 'Unstaged';
      stagesByJob.set(jobId, [...(stagesByJob.get(jobId) ?? []), { stage, count: Number(row.__count || 0) }]);
    });
  }
  const value = {
    configured: true,
    jobs,
    applicantByJob,
    stagesByJob,
    applicantsAvailable: countsResult.status === 'fulfilled',
  };
  cached = { at: Date.now(), value };
  return value;
}

export async function odooRecruitmentMatches(requests) {
  try {
    const state = await readOdooState();
    if (!state.configured) {
      return {
        configured: false,
        connected: false,
        applicantsAvailable: false,
        summary: { matched: 0, total: requests.length, staleActive: 0, candidateTotal: null },
        matches: {},
      };
    }

    const baseUrl = String(process.env.ODOO_URL || '').replace(/\/+$/, '');
    const matches = {};
    let staleActive = 0;
    let candidateTotal = 0;
    for (const request of requests) {
      const match = bestJob(request.role, state.jobs);
      if (!match) continue;
      const { job, score } = match;
      const applicantCount = state.applicantsAvailable ? (state.applicantByJob.get(job.id) ?? 0) : null;
      if (applicantCount !== null) candidateTotal += applicantCount;
      if (request.status !== 'active' && job.active) staleActive += 1;
      matches[request.id] = {
        jobId: job.id,
        name: job.name,
        active: Boolean(job.active),
        expectedEmployees: Number(job.expected_employees || 0),
        department: Array.isArray(job.department_id) ? String(job.department_id[1]) : '',
        openedDate: job.job_open_date || null,
        publishedDate: job.published_date || null,
        applicantCount,
        stages: state.stagesByJob.get(job.id) ?? [],
        confidence: Number(score.toFixed(2)),
        url: `${baseUrl}/web#id=${job.id}&model=hr.job&view_type=form`,
      };
    }

    return {
      configured: true,
      connected: true,
      applicantsAvailable: state.applicantsAvailable,
      summary: {
        matched: Object.keys(matches).length,
        total: requests.length,
        staleActive,
        candidateTotal: state.applicantsAvailable ? candidateTotal : null,
      },
      matches,
    };
  } catch (error) {
    console.warn('[hr] Odoo recruitment unavailable:', error?.message ?? error);
    return {
      configured: true,
      connected: false,
      applicantsAvailable: false,
      summary: { matched: 0, total: requests.length, staleActive: 0, candidateTotal: null },
      matches: {},
    };
  }
}

export const __test = { clean, similarity, bestJob };
