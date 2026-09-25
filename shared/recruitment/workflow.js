/**
 * The job-request state machine.
 *
 *   draft → pending_review → pending_approval → hiring → completed
 *
 * with hold/resume inside hiring, return-for-changes back to draft from either
 * review step, rejection at either review step, and cancellation from anything
 * still open. Every transition the API performs is looked up here first; a
 * request can never reach a status by any path this table does not list, which
 * is what "invalid transitions are rejected server-side" means in practice.
 *
 * Permissions are deliberately not part of this table. Who may perform an
 * action depends on the person *and* the request (a department manager reviews
 * their own department's requests only), so that lives with the server, which
 * sees both.
 */

export const REQUEST_STATUSES = [
  'draft',
  'pending_review',
  'pending_approval',
  'hiring',
  'on_hold',
  'completed',
  'cancelled',
  'rejected',
];

/** Still in play — anything here can still be cancelled. */
export const OPEN_STATUSES = ['draft', 'pending_review', 'pending_approval', 'hiring', 'on_hold'];

/** Approved and owned by a recruiter: what capacity counts. */
export const COMMITTED_STATUSES = ['hiring', 'on_hold'];

/** Waiting on a person rather than on the recruiter. */
export const PENDING_STATUSES = ['pending_review', 'pending_approval'];

export const TERMINAL_STATUSES = ['completed', 'cancelled', 'rejected'];

/**
 * `stage` is the timeline step the transition belongs to, so the approval
 * timeline can show "Department review · approved by …" without re-deriving
 * which step a status change was.
 */
export const TRANSITIONS = {
  submit: { from: ['draft'], to: 'pending_review', stage: 'request', decision: 'submitted' },
  review_approve: { from: ['pending_review'], to: 'pending_approval', stage: 'department_review', decision: 'approved' },
  review_return: { from: ['pending_review'], to: 'draft', stage: 'department_review', decision: 'returned' },
  review_reject: { from: ['pending_review'], to: 'rejected', stage: 'department_review', decision: 'rejected' },
  approve: { from: ['pending_approval'], to: 'hiring', stage: 'final_approval', decision: 'approved' },
  approve_return: { from: ['pending_approval'], to: 'draft', stage: 'final_approval', decision: 'returned' },
  approve_reject: { from: ['pending_approval'], to: 'rejected', stage: 'final_approval', decision: 'rejected' },
  hold: { from: ['hiring'], to: 'on_hold', stage: 'hiring', decision: 'held' },
  resume: { from: ['on_hold'], to: 'hiring', stage: 'hiring', decision: 'resumed' },
  complete: { from: ['hiring'], to: 'completed', stage: 'hiring', decision: 'completed' },
  cancel: { from: OPEN_STATUSES, to: 'cancelled', stage: 'closure', decision: 'cancelled' },
};

export const TIMELINE_STAGES = ['request', 'department_review', 'final_approval', 'hiring'];

/** Actions whose comment is mandatory — a "no" or a stop always says why. */
export const COMMENT_REQUIRED = new Set([
  'review_return',
  'review_reject',
  'approve_return',
  'approve_reject',
  'hold',
  'cancel',
]);

export function transitionFor(status, action) {
  const rule = TRANSITIONS[action];
  if (!rule) return { ok: false, error: 'recruitment_action_unknown' };
  if (!rule.from.includes(status)) return { ok: false, error: 'recruitment_transition_invalid', from: status, action };
  return { ok: true, to: rule.to, stage: rule.stage, decision: rule.decision };
}

export function isOpen(status) {
  return OPEN_STATUSES.includes(status);
}

export function isCommitted(status) {
  return COMMITTED_STATUSES.includes(status);
}

/**
 * The four-step timeline for the detail page, from the stored transition rows.
 * A step shows the *latest* decision taken at it, so a request returned for
 * changes and resubmitted shows the second review, not the first.
 */
export function approvalTimeline(request, approvals = []) {
  const rows = [...approvals].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  const latest = (stage) => [...rows].reverse().find((row) => row.stage === stage) ?? null;
  const submitted = latest('request');
  const review = latest('department_review');
  const approval = latest('final_approval');
  const status = request?.status;
  const stepState = (row, activeWhen) => {
    if (row && ['approved', 'submitted'].includes(row.decision) && !(activeWhen && status === 'draft')) return 'done';
    if (row && row.decision === 'rejected') return 'rejected';
    if (activeWhen) return 'current';
    return 'upcoming';
  };
  const hiringState = ['hiring', 'on_hold'].includes(status)
    ? 'current'
    : status === 'completed'
      ? 'done'
      : 'upcoming';
  return [
    { stage: 'request', state: status === 'draft' ? 'current' : stepState(submitted, false), event: submitted },
    { stage: 'department_review', state: stepState(review, status === 'pending_review'), event: review },
    { stage: 'final_approval', state: stepState(approval, status === 'pending_approval'), event: approval },
    { stage: 'hiring', state: hiringState, event: rows.filter((row) => row.stage === 'hiring').at(-1) ?? null },
  ];
}
