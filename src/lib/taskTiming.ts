/**
 * Durations, said in words.
 *
 * `shared/taskTiming.js` decides *which* clock a task is on and how long it has
 * been running; this file decides what that reading says out loud, and what
 * colour it is. The split matters because the API scores punctuality from the
 * same anchors the board draws — a card and a performance report disagreeing
 * about whether somebody delivered on time is the bug this whole change exists
 * to stop.
 *
 * One rule runs through all of it: a number on a card must name the clock it
 * came from. "11 days" alone was the original sin here — it was read as eleven
 * days of an employee being late when it was eleven days of nobody reviewing.
 */

import { taskDurations } from '@shared/taskTiming';
import type { Lang, StringKey } from './i18n';
import type { Task } from './types';
import { type DueTone, daysUntil, dueLabel, formatDate, toneForDays } from './utils';

type T = (key: StringKey, vars?: Record<string, string | number>) => string;

export type TimingIcon = 'due' | 'wait' | 'review' | 'done';

export interface TimingChip {
  key: string;
  text: string;
  tone: DueTone;
  icon: TimingIcon;
}

/**
 * A day count in Arabic needs three forms, not two — يوم / يومين / ٣ أيام —
 * and anything under a day needs to say so rather than round to "0 أيام",
 * which reads as no time at all rather than as this morning.
 */
function dayText(days: number, t: T) {
  const n = Math.abs(days);
  if (n === 0) return t('count.underDay');
  if (n === 1) return t('count.dayOne');
  if (n === 2) return t('count.dayTwo');
  return t('count.dayMany', { n });
}

/** How worried to look about a clock that is still running, in days. */
function ageTone(days: number): DueTone {
  if (days >= 7) return 'warn';
  if (days >= 3) return 'info';
  return 'muted';
}

/**
 * A hand-in waiting on a reviewer. This escalates faster than a task in
 * progress on purpose: work sitting unreviewed is finished work going stale,
 * and the person it blocks cannot do anything about it.
 */
function reviewTone(days: number): DueTone {
  if (days >= 5) return 'bad';
  if (days >= 2) return 'warn';
  return 'info';
}

/**
 * What a card, a row or a list should say about this task's time — at most two
 * chips, ordered by whose problem the first one is.
 */
export function timingChips(task: Task, t: T, lang: Lang): TimingChip[] {
  const d = taskDurations(task);

  // Closed. Every reading is history now, so nothing here may consult "today":
  // the point of the frozen chip is that it says the same thing next month.
  if (d.state === 'approved') {
    if (d.lateBy !== null) {
      return d.lateBy > 0
        ? [
            {
              key: 'late',
              text: t('timing.deliveredLate', { d: dayText(d.lateBy, t) }),
              tone: 'bad',
              icon: 'due',
            },
          ]
        : [{ key: 'ontime', text: t('timing.deliveredOnTime'), tone: 'ok', icon: 'done' }];
    }
    // No deadline was ever set, so there is no promise to have broken. How long
    // it took is still worth knowing — it just is not an accusation.
    return d.age === null
      ? []
      : [{ key: 'took', text: t('timing.took', { d: dayText(d.age, t) }), tone: 'muted', icon: 'done' }];
  }

  // Handed in. The doer is done; this clock belongs to whoever has to look at it.
  if (d.state === 'submitted' || d.state === 'signed_off') {
    const waited = d.inReview ?? 0;
    const chips: TimingChip[] = [
      {
        key: 'review',
        text: t('timing.inReview', { d: dayText(waited, t) }),
        tone: reviewTone(waited),
        icon: 'review',
      },
    ];
    // The delivery's own verdict, frozen at the hand-in. It rides along because
    // "late, and then sat in review for a week" is two different people's news.
    if (d.lateBy !== null && d.lateBy > 0) {
      chips.push({
        key: 'late',
        text: t('timing.deliveredLate', { d: dayText(d.lateBy, t) }),
        tone: 'bad',
        icon: 'due',
      });
    }
    return chips;
  }

  // Still open. Here the deadline really is a countdown, so the old live label
  // is exactly right — it was only ever wrong once the work stopped moving.
  const due = dueLabel(task.dueDate, t, lang);
  if (due) return [{ key: 'due', text: due.text, tone: due.tone, icon: 'due' }];

  // No deadline: report age instead, and name which kind of waiting it is.
  const started = d.state === 'working' && d.started;
  const days = (started ? d.working : d.waiting) ?? 0;
  return [
    {
      key: started ? 'working' : 'waiting',
      text: started
        ? t('timing.inProgressFor', { d: dayText(days, t) })
        : t('timing.notStartedFor', { d: dayText(days, t) }),
      tone: ageTone(days),
      icon: 'wait',
    },
  ];
}

/**
 * The colour a printed due *date* should carry — the same verdict the chips
 * give, for surfaces that show the date itself rather than a duration. A closed
 * task is judged on its delivery; only an open one is still counting down.
 */
export function dueDateTone(task: Task): DueTone {
  if (!task.dueDate) return 'muted';
  const d = taskDurations(task);
  if (d.lateBy !== null) return d.lateBy > 0 ? 'bad' : 'ok';
  const days = daysUntil(task.dueDate);
  return days === null ? 'muted' : toneForDays(days);
}

export interface TimingRow {
  key: string;
  label: string;
  value: string;
  /** True while this clock is still running — the value will change tomorrow. */
  live?: boolean;
  tone?: DueTone;
}

/**
 * The full breakdown, for the task dialog: where every day went, and against
 * what. A card has room for one number; the person asking "why did this take
 * three weeks" needs all of them.
 */
export function timingRows(task: Task, t: T, lang: Lang): TimingRow[] {
  const d = taskDurations(task);
  const rows: TimingRow[] = [];
  const open = d.state === 'assigned' || d.state === 'working';

  if (d.waiting !== null) {
    rows.push({
      key: 'waiting',
      label: t('timing.waitRow'),
      value: dayText(d.waiting, t),
      live: d.state === 'assigned',
    });
  }

  rows.push(
    d.started === null
      ? // Not zero days of work: no record that work ever started. Saying so is
        // the difference between a missing measurement and a false one.
        { key: 'working', label: t('timing.workRow'), value: t('timing.noStart'), tone: 'muted' }
      : {
          key: 'working',
          label: t('timing.workRow'),
          value: dayText(d.working ?? 0, t),
          live: d.state === 'working',
        }
  );

  if (d.turnaround !== null) {
    rows.push({
      key: 'turnaround',
      label: t('timing.turnaroundRow'),
      value: dayText(d.turnaround, t),
    });
  }

  if (d.inReview !== null) {
    rows.push({
      key: 'review',
      label: t('timing.reviewRow'),
      value: dayText(d.inReview, t),
      live: d.state === 'submitted' || d.state === 'signed_off',
      tone: d.state === 'submitted' || d.state === 'signed_off' ? reviewTone(d.inReview) : undefined,
    });
  }

  // The deadline row, phrased as a result rather than a countdown — except on a
  // task still open, where a countdown is the only true thing to say.
  if (!task.dueDate) {
    rows.push({ key: 'due', label: t('timing.deadlineRow'), value: t('timing.noDueDate'), tone: 'muted' });
  } else if (d.lateBy === null) {
    const due = dueLabel(task.dueDate, t, lang);
    rows.push({
      key: 'due',
      label: t('timing.deadlineRow'),
      value: due?.text ?? formatDate(task.dueDate, lang),
      live: open,
      tone: due?.tone,
    });
  } else if (d.lateBy > 0) {
    rows.push({
      key: 'due',
      label: t('timing.deadlineRow'),
      value: t('timing.lateBy', { d: dayText(d.lateBy, t) }),
      tone: 'bad',
    });
  } else if (d.lateBy === 0) {
    rows.push({ key: 'due', label: t('timing.deadlineRow'), value: t('timing.onTheDay'), tone: 'ok' });
  } else {
    rows.push({
      key: 'due',
      label: t('timing.deadlineRow'),
      value: t('timing.earlyBy', { d: dayText(d.lateBy, t) }),
      tone: 'ok',
    });
  }

  /*
   * When a task came back, its current hand-in is not the one the deadline was
   * about. Both dates are shown so a manager can see the difference between
   * somebody who was late and somebody who was on time and then had to redo it.
   */
  if (d.firstDelivery && d.delivery && d.firstDelivery !== d.delivery) {
    rows.push({
      key: 'first',
      label: t('timing.firstDeliveryRow'),
      value:
        d.lateOnFirstDelivery === null || d.lateOnFirstDelivery <= 0
          ? formatDate(d.firstDelivery, lang)
          : `${formatDate(d.firstDelivery, lang)} — ${t('timing.lateBy', {
              d: dayText(d.lateOnFirstDelivery, t),
            })}`,
      tone: (d.lateOnFirstDelivery ?? 0) > 0 ? 'warn' : undefined,
    });
  }

  return rows;
}
