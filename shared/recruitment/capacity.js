/**
 * Recruiter capacity.
 *
 * A recruiter may carry at most two Critical and five Required jobs at once;
 * Planned work has no ceiling for now. The limits are settings, not constants
 * — they are the values management approved, and the day they change nobody
 * should need a deploy.
 *
 * Only committed work counts: jobs that passed final approval and are hiring
 * or on hold (a held job can resume tomorrow, so it still occupies its seat).
 * A request that is still waiting for approval is shown as pipeline, never as
 * load — otherwise a request that is never approved would block a recruiter
 * forever.
 */

import { COMMITTED_STATUSES } from './workflow.js';

export const DEFAULT_CAPACITY = {
  critical: 2,
  required: 5,
  planned: null,
  countOnHold: true,
};

const EMPTY = () => ({ critical: 0, required: 0, planned: 0, unclassified: 0, total: 0 });

export function countsAsLoad(request, { countOnHold = true } = {}) {
  if (!COMMITTED_STATUSES.includes(request?.status)) return false;
  return countOnHold || request.status !== 'on_hold';
}

/** Committed load for one recruiter, keyed by priority. `excludeRequestId` is the job being moved. */
export function recruiterLoad(recruiterCode, requests, { countOnHold = true, excludeRequestId = null } = {}) {
  const load = EMPTY();
  if (!recruiterCode) return load;
  for (const request of requests ?? []) {
    if (request.id === excludeRequestId) continue;
    if (request.recruiterCode !== recruiterCode) continue;
    if (!countsAsLoad(request, { countOnHold })) continue;
    const key = ['critical', 'required', 'planned'].includes(request.priority) ? request.priority : 'unclassified';
    load[key] += 1;
    load.total += 1;
  }
  return load;
}

/** Everybody's load in one pass, for the capacity board and the cards. */
export function loadByRecruiter(requests, { countOnHold = true } = {}) {
  const loads = new Map();
  for (const request of requests ?? []) {
    if (!request.recruiterCode || !countsAsLoad(request, { countOnHold })) continue;
    const load = loads.get(request.recruiterCode) ?? EMPTY();
    const key = ['critical', 'required', 'planned'].includes(request.priority) ? request.priority : 'unclassified';
    load[key] += 1;
    load.total += 1;
    loads.set(request.recruiterCode, load);
  }
  return loads;
}

export function limitFor(priority, limits = DEFAULT_CAPACITY) {
  const value = limits?.[priority];
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Would adding one `priority` job to this recruiter exceed a limit?
 *
 * The answer carries the whole picture — current load, the projected load and
 * which limit breaks — because the person deciding whether to override needs
 * to see "2 Critical, 4 Required" rather than a bare "no".
 */
export function capacityCheck({ recruiterCode, priority, requests, limits = DEFAULT_CAPACITY, excludeRequestId = null }) {
  const current = recruiterLoad(recruiterCode, requests, {
    countOnHold: limits?.countOnHold !== false,
    excludeRequestId,
  });
  const projected = { ...current };
  const key = ['critical', 'required', 'planned'].includes(priority) ? priority : 'unclassified';
  projected[key] += 1;
  projected.total += 1;
  // Only the incoming job's own level can be broken by adding it; a recruiter
  // already over a different limit shows that in `current`.
  const limit = limitFor(key, limits);
  const exceeded = limit !== null && projected[key] > limit ? [key] : [];
  return {
    ok: exceeded.length === 0,
    recruiterCode,
    priority: key,
    current,
    projected,
    limits: {
      critical: limitFor('critical', limits),
      required: limitFor('required', limits),
      planned: limitFor('planned', limits),
    },
    exceeded,
  };
}

/** Where a recruiter stands against each limit: `ok`, `full` (at the limit) or `over`. */
export function capacityLevel(load, limits = DEFAULT_CAPACITY) {
  const level = {};
  for (const priority of ['critical', 'required', 'planned']) {
    const limit = limitFor(priority, limits);
    const count = load?.[priority] ?? 0;
    level[priority] = limit === null ? 'ok' : count > limit ? 'over' : count === limit ? 'full' : 'ok';
  }
  return level;
}
