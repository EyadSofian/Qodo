/**
 * The timing backfill, run against rows written before it existed.
 *
 * Everything here is a shape production actually contains: work handed in once,
 * work sent back so its `submittedAt` is gone, work submitted without ever
 * being started, and old work with no audit trail left at all. The migration
 * has to reach the first three and refuse to invent anything for the fourth.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DAY = 86_400_000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

/** A task as the old code would have stored it — no timing columns at all. */
const legacy = (fields) => ({
  id: crypto.randomUUID(),
  organizationId: 'engosoft',
  reference: 'TSK-0001',
  title: 'legacy row',
  department: 'marketing',
  stage: 'review',
  priority: 'normal',
  assigneeIds: ['owner'],
  assignments: [],
  assignedAt: iso(20),
  assignedBy: 'manager',
  createdBy: 'manager',
  taskDate: iso(20).slice(0, 10),
  dueDate: null,
  description: '',
  objective: '',
  definitionOfDone: '',
  notes: '',
  effortPoints: null,
  estimatedMinutes: null,
  progress: 100,
  labels: [],
  appId: null,
  subteam: null,
  attachmentCount: 0,
  reworkCount: 0,
  reworkAcknowledgedBy: {},
  archivedAt: null,
  archivedBy: null,
  archiveReason: '',
  startedAt: null,
  submittedAt: null,
  submittedBy: null,
  submissionNote: '',
  reviewedAt: null,
  reviewedBy: null,
  reviewNote: '',
  reviewDecision: null,
  publishedAt: null,
  publishedBy: null,
  score: null,
  scoreBeforeReworkPenalty: null,
  scorePenaltyPercent: 0,
  scoreBy: null,
  scoredAt: null,
  completedAt: null,
  order: 0,
  createdAt: iso(20),
  updatedAt: iso(1),
  ...fields,
});

const submitLog = (taskId, daysAgo) => ({
  id: crypto.randomUUID(),
  actorId: 'owner',
  organizationId: 'engosoft',
  action: 'task.submit',
  subject: 'task',
  subjectId: taskId,
  meta: null,
  createdAt: iso(daysAgo),
});

test('the timing backfill reaches old rows without inventing history', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'engosoft-seed-timing-'));
  process.env.DATA_DIR = dir;

  // Handed in once and still in review: the row itself can answer.
  const plain = legacy({ startedAt: iso(9), submittedAt: iso(7), submittedBy: 'owner' });

  // Sent back, so the review cleared `submittedAt`. Only the log remembers the
  // delivery the deadline was about — this is the row the whole column exists
  // for, and it is invisible without the audit trail.
  const returned = legacy({ stage: 'rework', startedAt: iso(14), reworkCount: 1 });
  const returnedFirstHandIn = iso(12);

  // Submitted without ever pressing start: the old hand-in wrote both stamps
  // together, which used to read as a task finished in zero days.
  const guessedStart = iso(6);
  const neverStarted = legacy({
    startedAt: guessedStart,
    submittedAt: guessedStart,
    submittedBy: 'owner',
  });

  // The same invention, on a task that has since been sent back. `submittedAt`
  // is gone, so only the logged hand-in can still expose the fingerprint.
  const guessedThenReturnedStart = iso(11);
  const guessedThenReturned = legacy({
    stage: 'rework',
    startedAt: guessedThenReturnedStart,
    reworkCount: 1,
  });

  // A real start, two days before the hand-in. Nothing here may be touched.
  // Its log entry carries the identical stamp the row does — the migration
  // prefers the log, and a fixture where the two differ tests nothing.
  const genuineHandIn = iso(8);
  const genuine = legacy({ startedAt: iso(10), submittedAt: genuineHandIn, submittedBy: 'owner' });

  // Closed before any of this existed: no hand-in, no log. The migration must
  // leave the column null rather than dress the completion up as a delivery.
  const ancient = legacy({ stage: 'done', completedAt: iso(30), score: 90, progress: 100 });

  const tasks = [plain, returned, neverStarted, guessedThenReturned, genuine, ancient];
  await fs.writeFile(
    path.join(dir, 'workspace.json'),
    JSON.stringify({
      organizations: [{ id: 'engosoft', name: 'Engosoft', createdAt: iso(60) }],
      // A user exists so the seed does not print a first-administrator banner.
      users: [
        {
          id: 'manager',
          organizationId: 'engosoft',
          name: 'Manager',
          email: 'manager@test.local',
          passwordHash: 'x',
          role: 'admin',
          status: 'active',
          department: 'general',
          createdAt: iso(60),
        },
      ],
      tasks,
      activity: [
        { ...submitLog(returned.id, 12), createdAt: returnedFirstHandIn },
        submitLog(returned.id, 4), // the resubmission — later, so not the first
        { ...submitLog(guessedThenReturned.id, 11), createdAt: guessedThenReturnedStart },
        { ...submitLog(genuine.id, 8), createdAt: genuineHandIn },
      ],
    })
  );

  const { seed } = await import('./seed.js');
  await seed();
  const { find } = await import('./store.js');
  const after = new Map((await find('tasks')).map((row) => [row.id, row]));

  const one = after.get(plain.id);
  assert.equal(one.firstSubmittedAt, plain.submittedAt, 'the row could answer for itself');
  assert.equal(one.startedAtInferred, false);

  const back = after.get(returned.id);
  assert.equal(back.submittedAt, null, 'the send-back cleared it, and that stands');
  assert.equal(back.firstSubmittedAt, returnedFirstHandIn, 'the earliest logged hand-in, not the latest');
  assert.equal(back.startedAtInferred, false, 'its start predates the delivery, so it is real');

  const invented = after.get(neverStarted.id);
  assert.equal(invented.startedAtInferred, true, 'start and hand-in are one event');
  assert.equal(invented.firstSubmittedAt, guessedStart);

  const inventedAndReturned = after.get(guessedThenReturned.id);
  assert.equal(
    inventedAndReturned.startedAtInferred,
    true,
    'the log exposes a fingerprint the cleared hand-in would have hidden'
  );

  const real = after.get(genuine.id);
  assert.equal(real.startedAtInferred, false);
  assert.equal(real.firstSubmittedAt, genuineHandIn);

  const old = after.get(ancient.id);
  assert.equal(old.firstSubmittedAt, null, 'no evidence, so no claim');
  assert.equal(old.startedAtInferred, false);

  // Idempotent: a second boot must not reopen a decision the first one made,
  // and must not rewrite a null that means "we looked, and nothing was there".
  const { seed: seedAgain } = await import('./seed.js');
  await seedAgain();
  const twice = new Map((await find('tasks')).map((row) => [row.id, row]));
  for (const id of after.keys()) {
    assert.equal(twice.get(id).firstSubmittedAt, after.get(id).firstSubmittedAt);
    assert.equal(twice.get(id).startedAtInferred, after.get(id).startedAtInferred);
  }

  await fs.rm(dir, { recursive: true, force: true });
});
