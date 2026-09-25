import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addWorkingDays,
  completionFields,
  currentDueDate,
  isWorkingDay,
  priorityForHiringPeriod,
  slaSnapshot,
  validateTarget,
  workingDaysBetween,
} from '../shared/recruitment/sla.js';

// Calendar facts these tests lean on (checked, not assumed):
// 2026-09-20 Sun · 2026-09-24 Thu · 2026-09-25 Fri · 2026-09-26 Sat
// 2026-12-30 Wed · 2026-12-31 Thu · 2027-01-01 Fri · 2027-01-02 Sat · 2027-01-03 Sun

test('Friday and Saturday are never working days', () => {
  assert.equal(isWorkingDay('2026-09-24'), true);
  assert.equal(isWorkingDay('2026-09-25'), false);
  assert.equal(isWorkingDay('2026-09-26'), false);
  assert.equal(isWorkingDay('2026-09-27'), true);
  assert.equal(addWorkingDays('2026-09-24', 1), '2026-09-27', 'Thursday + 1 skips the weekend');
  assert.equal(workingDaysBetween('2026-09-24', '2026-09-27'), 1);
  assert.equal(workingDaysBetween('2026-09-24', '2026-10-01'), 5, 'one calendar week is five working days');
});

test('the approval day is day zero and the due date is the N-th working day after it', () => {
  assert.equal(addWorkingDays('2026-09-20', 15), '2026-10-11');
  assert.equal(addWorkingDays('2026-09-20', 0), '2026-09-20');
  // Approved on a Friday: the clock's first working day is Sunday.
  assert.equal(addWorkingDays('2026-09-25', 1), '2026-09-27');
});

test('working days cross a month boundary and a year boundary', () => {
  assert.equal(addWorkingDays('2026-09-29', 5), '2026-10-06');
  assert.equal(addWorkingDays('2026-12-30', 3), '2027-01-04');
  assert.equal(workingDaysBetween('2026-12-30', '2027-01-04'), 3);
});

test('counting backwards is the same count, negated', () => {
  assert.equal(workingDaysBetween('2026-10-01', '2026-09-24'), -5);
  assert.equal(workingDaysBetween('2026-09-24', '2026-09-24'), 0);
});

test('a whole year counts the same by weeks as by walking every day', () => {
  let walked = 0;
  for (let time = Date.parse('2026-01-02T12:00:00Z'); time <= Date.parse('2026-12-31T12:00:00Z'); time += 86_400_000) {
    const day = new Date(time).getUTCDay();
    if (day !== 5 && day !== 6) walked += 1;
  }
  assert.equal(workingDaysBetween('2026-01-01', '2026-12-31'), walked);
});

test('holidays are skipped only when they fall on a working day', () => {
  const calendar = { weekend: [5, 6], holidays: ['2026-10-06', '2026-10-09'] };
  // 2026-10-06 is a Tuesday (skipped); 2026-10-09 is a Friday (already weekend).
  assert.equal(addWorkingDays('2026-09-29', 5, calendar), '2026-10-07');
  assert.equal(workingDaysBetween('2026-09-29', '2026-10-07', calendar), 5);
});

test('a calendar with no working days is refused rather than looping forever', () => {
  assert.throws(() => addWorkingDays('2026-09-20', 1, { weekend: [0, 1, 2, 3, 4, 5, 6] }), /calendar_has_no_working_days/);
});

test('priority bands: Critical at most 15, Required 15–30, Planned 45–60', () => {
  assert.equal(validateTarget('critical', 15), null);
  assert.equal(validateTarget('critical', 10), null);
  assert.equal(validateTarget('critical', 16), 'recruitment_target_out_of_band');
  assert.equal(validateTarget('required', 15), null);
  assert.equal(validateTarget('required', 30), null);
  assert.equal(validateTarget('required', 31), 'recruitment_target_out_of_band');
  assert.equal(validateTarget('required', 14), 'recruitment_target_out_of_band');
  assert.equal(validateTarget('planned', 45), null);
  assert.equal(validateTarget('planned', 60), null);
  assert.equal(validateTarget('planned', 44), 'recruitment_target_out_of_band');
  assert.equal(validateTarget('planned', 61), 'recruitment_target_out_of_band');
  assert.equal(validateTarget('urgent', 10), 'recruitment_priority_invalid');
  assert.equal(validateTarget('critical', 7.5), 'recruitment_target_invalid');
});

test('Day 11 / 15 with 4 working days left, exactly as the desk reads it', () => {
  const snapshot = slaSnapshot({ startDate: '2026-09-20', targetWorkingDays: 15 }, { today: '2026-10-05' });
  assert.equal(snapshot.elapsedWorkingDays, 11);
  assert.equal(snapshot.targetWorkingDays, 15);
  assert.equal(snapshot.remainingWorkingDays, 4);
  assert.equal(snapshot.state, 'on_track');
  assert.equal(snapshot.dueDate, '2026-10-11');
});

test('remaining days drive due-soon and due-today states', () => {
  const sla = { startDate: '2026-09-20', targetWorkingDays: 15 };
  assert.equal(slaSnapshot(sla, { today: '2026-10-06', dueSoonWorkingDays: 3 }).state, 'due_soon');
  assert.equal(slaSnapshot(sla, { today: '2026-10-11' }).state, 'due_today');
  assert.equal(slaSnapshot(sla, { today: '2026-10-11' }).remainingWorkingDays, 0);
});

test('overdue counts working days past the due date, not calendar days', () => {
  const snapshot = slaSnapshot({ startDate: '2026-09-20', targetWorkingDays: 15 }, { today: '2026-10-13' });
  assert.equal(snapshot.state, 'overdue');
  assert.equal(snapshot.overdueWorkingDays, 2);
  assert.equal(snapshot.remainingWorkingDays, 0);
});

test('an extension moves the current due date and never the original one', () => {
  const sla = { startDate: '2026-09-20', targetWorkingDays: 15, extendedWorkingDays: 5 };
  const snapshot = slaSnapshot(sla, { today: '2026-10-13' });
  assert.equal(snapshot.originalDueDate, '2026-10-11');
  assert.equal(snapshot.dueDate, '2026-10-18');
  assert.equal(snapshot.targetWorkingDays, 20);
  assert.equal(snapshot.elapsedWorkingDays, 17);
  assert.equal(snapshot.remainingWorkingDays, 3);
  assert.equal(snapshot.state, 'due_soon', 'overdue without the extension, three days left with it');
  assert.equal(currentDueDate(sla), '2026-10-18');
});

test('a hold pauses the clock without counting as an extension', () => {
  const running = slaSnapshot(
    { startDate: '2026-09-20', targetWorkingDays: 15, pausedSince: '2026-10-01' },
    { today: '2026-10-08' }
  );
  assert.equal(running.state, 'paused');
  // Paused from the day after the hold began (Oct 4–8): the hold day itself was worked.
  assert.equal(running.pausedWorkingDays, 5);
  assert.equal(running.elapsedWorkingDays, 9, 'the five paused days are not charged');
  assert.equal(running.extendedWorkingDays, 0);
  const resumed = slaSnapshot({ startDate: '2026-09-20', targetWorkingDays: 15, pausedWorkingDays: 4 }, { today: '2026-10-11' });
  assert.equal(resumed.originalDueDate, '2026-10-11');
  assert.equal(resumed.dueDate, '2026-10-15');
});

test('completion records actual working days and whether the SLA was met', () => {
  const onTime = completionFields({ startDate: '2026-09-20', targetWorkingDays: 15 }, '2026-10-08');
  assert.deepEqual(
    { actual: onTime.actualWorkingDays, met: onTime.slaMet },
    { actual: 14, met: true }
  );
  const late = completionFields({ startDate: '2026-09-20', targetWorkingDays: 15 }, '2026-10-13');
  assert.equal(late.actualWorkingDays, 17);
  assert.equal(late.slaMet, false);
  const extended = completionFields({ startDate: '2026-09-20', targetWorkingDays: 15, extendedWorkingDays: 5 }, '2026-10-13');
  assert.equal(extended.slaMet, true, 'an approved extension counts toward the allowance');
  const snapshot = slaSnapshot({ startDate: '2026-09-20', targetWorkingDays: 15, completedAt: '2026-10-13' }, { today: '2026-11-01' });
  assert.equal(snapshot.state, 'missed');
});

test('a job not yet approved has no clock at all', () => {
  assert.equal(slaSnapshot(null, { today: '2026-10-01' }).state, 'not_started');
  assert.equal(slaSnapshot({ startDate: null, targetWorkingDays: 15 }, { today: '2026-10-01' }).started, false);
});

test('legacy hiring periods map onto the band that contains them', () => {
  assert.equal(priorityForHiringPeriod(15), 'critical');
  assert.equal(priorityForHiringPeriod(30), 'required');
  assert.equal(priorityForHiringPeriod(45), 'planned');
  assert.equal(priorityForHiringPeriod(0), null);
  assert.equal(priorityForHiringPeriod(null), null);
  assert.equal(priorityForHiringPeriod(90), null);
});
