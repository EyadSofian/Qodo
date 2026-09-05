/**
 * The shape of a task document, in the two places that create one.
 *
 * Extracted from `server/routes/tasks.js` when Qodo Projects arrived and needed
 * to create tasks of its own. Copying these three functions would have meant two
 * definitions of what a fresh task looks like, drifting apart the first time
 * somebody added a lifecycle field to one of them — §83's duplicated business
 * logic, in the one place it would be hardest to notice.
 *
 * All three are pure. They describe a document; they do not write one.
 */

/**
 * A task that has not started.
 *
 * Every lifecycle field, explicitly null rather than absent, because the board,
 * the performance table and the score masking all read them and `undefined`
 * behaves differently from `null` in half of those comparisons.
 */
export function blankLifecycle() {
  return {
    archivedAt: null,
    archivedBy: null,
    archiveReason: '',
    startedAt: null,
    startedAtInferred: false,
    submittedAt: null,
    firstSubmittedAt: null,
    submittedBy: null,
    submissionNote: '',
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: '',
    reviewDecision: null,
    publishedAt: null,
    publishedBy: null,
    reworkCount: 0,
    reworkAcknowledgedBy: {},
    attachmentCount: 0,
    score: null,
    scoreBeforeReworkPenalty: null,
    scorePenaltyPercent: 0,
    scoreBy: null,
    scoredAt: null,
  };
}

/**
 * Who owes the work, and what each of them has said about it.
 *
 * A partner who was already on the task keeps the answer they gave. Adding a
 * second person to a task the first already accepted must not silently put the
 * first back to pending.
 */
export function assignmentLifecycle(assigneeIds, actorId, previous = []) {
  const owners = [...new Set(assigneeIds ?? [])];
  const stamp = new Date().toISOString();
  const keep = new Map(previous.map((row) => [row.userId, row]));

  return {
    assigneeIds: owners,
    assignments: owners.map(
      (userId) =>
        keep.get(userId) ?? {
          userId,
          // Assigning yourself is the request and the answer in the same
          // breath — there is no second party to wait for.
          status: userId === actorId ? 'accepted' : 'pending',
          note: '',
          acceptedAt: userId === actorId ? stamp : null,
          declinedAt: null,
          proposedDueDate: null,
        }
    ),
    assignedAt: owners.length ? stamp : null,
    assignedBy: owners.length ? actorId : null,
  };
}

/**
 * The human-readable reference — `TSK-M4K2P-8QZ1`.
 *
 * Time first so references sort roughly by age, plus random tail so two tasks
 * created in the same millisecond do not collide.
 */
export function taskReference(prefix = 'TSK') {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${time}-${random}`;
}
