/**
 * Qodo Projects — one vocabulary for "how is this going".
 *
 * Before this file, every screen answered that question for itself. The tasks
 * table decided late meant `endDate < today`; the Gantt decided it meant
 * `endDate < today && progress < 100`; the overview counted whatever the
 * `overdue` endpoint counted. Three definitions of late is not a styling
 * problem — it is three different numbers on three screens describing the same
 * work, and the person reading them has no way to know which one is true.
 *
 * So the judgement lives here, once, and the screens render what it returns.
 *
 * ── On colour ────────────────────────────────────────────────────────
 *
 * The palette is deliberately small and it is *not* decorative. Four tones,
 * each with one meaning:
 *
 *   ok    — finished, or ahead of where it should be
 *   info  — running normally, nothing to do
 *   warn  — needs attention soon: due within the week, or past a threshold
 *   bad   — late, over budget, or blocked
 *
 * Nothing is tinted for emphasis. A row that is fine stays neutral, because a
 * screen where everything is coloured is a screen where colour carries no
 * information — and the person who most needs to spot the one late project is
 * the person scanning forty rows at once.
 *
 * Every tone is also carried by a word or an icon, never by colour alone (WCAG
 * 1.4.1). About one in twelve men cannot distinguish the warn and bad tints,
 * and "the red ones are late" is not an interface.
 */

import type { Phase, ProjectTask, WorkStatus } from './types';

export type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'neutral';

/* ------------------------------------------------------------------ */
/* Days                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Whole days from today to a `YYYY-MM-DD` date. Negative is the past.
 *
 * Both sides are pinned to UTC midnight before subtracting. Comparing a parsed
 * date against `new Date()` instead measures the time *since midnight* as well,
 * so a task due today reads as −0.4 days and rounds to "yesterday" for anybody
 * looking at it after lunch.
 */
export function daysUntil(date: string | null | undefined, today = new Date()): number | null {
  if (!date) return null;
  const target = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const midnight = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - midnight) / 86_400_000);
}

/** A status whose category means the work has stopped — done or cancelled. */
export function isClosed(status: WorkStatus | null | undefined): boolean {
  return status?.category === 'done' || status?.category === 'cancelled';
}

/* ------------------------------------------------------------------ */
/* Lateness                                                            */
/* ------------------------------------------------------------------ */

export type Schedule =
  | { state: 'none' }
  | { state: 'closed'; days: number | null }
  | { state: 'late'; days: number }
  | { state: 'due-today' }
  | { state: 'due-soon'; days: number }
  | { state: 'scheduled'; days: number };

/**
 * Where a dated thing stands against today.
 *
 * The two rules worth stating, because both were wrong somewhere before:
 *
 * **Finished work is never late.** A task delivered a week after its due date
 * is a fact about the past, not something anybody can act on now. It reports
 * `closed`, and the days are handed back so a screen that wants to say
 * "delivered 3 days late" still can.
 *
 * **Undated work is never late either.** No due date is an absent measurement.
 * Treating it as "due at the epoch" would paint every unscheduled task red,
 * which is how a backlog becomes unreadable.
 */
export function scheduleOf(
  endDate: string | null | undefined,
  status: WorkStatus | null | undefined,
  today = new Date()
): Schedule {
  const days = daysUntil(endDate, today);
  if (isClosed(status)) return { state: 'closed', days };
  if (days === null) return { state: 'none' };
  if (days < 0) return { state: 'late', days: Math.abs(days) };
  if (days === 0) return { state: 'due-today' };
  // A week is the horizon a person can actually do something about. Beyond it
  // "soon" stops meaning anything and the amber stops being a signal.
  if (days <= 7) return { state: 'due-soon', days };
  return { state: 'scheduled', days };
}

export function scheduleTone(schedule: Schedule): Tone {
  switch (schedule.state) {
    case 'late':
      return 'bad';
    case 'due-today':
    case 'due-soon':
      return 'warn';
    case 'closed':
      return 'ok';
    default:
      return 'neutral';
  }
}

/* ------------------------------------------------------------------ */
/* Progress against the calendar                                       */
/* ------------------------------------------------------------------ */

/**
 * How far through its own schedule a project should be by now, 0–100.
 *
 * The same "elapsed calendar time" basis the server uses for planned value in
 * `budgetService.earnedValue`, and named the same way, so the number on the
 * card and the number in the report cannot disagree.
 */
export function expectedProgress(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  today = new Date()
): number | null {
  if (!startDate || !endDate) return null;
  const start = Date.parse(`${String(startDate).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(endDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
}

export type ProgressVerdict =
  | { state: 'unknown' }
  | { state: 'complete' }
  | { state: 'ahead'; by: number }
  | { state: 'on-track' }
  | { state: 'behind'; by: number };

/**
 * Actual progress against expected progress.
 *
 * The ten-point band is the whole of the judgement and it is deliberately
 * generous. Progress is a human estimate typed into a field, and a rule that
 * called 48% "behind" when the calendar said 52% would flag every project in
 * the company on a Tuesday and teach everybody to ignore the flag.
 */
export function progressVerdict(
  progress: number,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  today = new Date()
): ProgressVerdict {
  if (progress >= 100) return { state: 'complete' };
  const expected = expectedProgress(startDate, endDate, today);
  if (expected === null) return { state: 'unknown' };

  const gap = progress - expected;
  if (gap >= 10) return { state: 'ahead', by: Math.round(gap) };
  if (gap <= -10) return { state: 'behind', by: Math.round(-gap) };
  return { state: 'on-track' };
}

export function progressTone(verdict: ProgressVerdict): Tone {
  switch (verdict.state) {
    case 'complete':
    case 'ahead':
      return 'ok';
    case 'behind':
      return 'bad';
    case 'on-track':
      return 'info';
    default:
      return 'neutral';
  }
}

/* ------------------------------------------------------------------ */
/* Priority and severity                                               */
/* ------------------------------------------------------------------ */

/**
 * Priority tones.
 *
 * `low` and `normal` are deliberately neutral. Four coloured priorities on a
 * table of two hundred tasks is a rainbow, and the two that matter — urgent and
 * high — stop standing out the moment the other two are painted too.
 */
export const PRIORITY_TONE: Record<ProjectTask['priority'], Tone> = {
  urgent: 'bad',
  high: 'warn',
  normal: 'neutral',
  low: 'neutral',
};

export const SEVERITY_TONE: Record<string, Tone> = {
  blocker: 'bad',
  critical: 'bad',
  major: 'warn',
  minor: 'neutral',
  cosmetic: 'neutral',
};

/** The status categories, as tones. Used when a status has no colour of its own. */
export const CATEGORY_TONE: Record<WorkStatus['category'], Tone> = {
  open: 'neutral',
  active: 'info',
  review: 'info',
  done: 'ok',
  cancelled: 'neutral',
};

/* ------------------------------------------------------------------ */
/* Budget                                                              */
/* ------------------------------------------------------------------ */

export type BudgetState = 'healthy' | 'at_risk' | 'overrun' | 'surplus' | 'unknown';

/**
 * The same four-way judgement `budgetService.budgetState` makes on the server,
 * mapped to tones. Duplicated as a *mapping* rather than as the rule itself —
 * the server decides the state, this only decides what colour it is.
 */
export const BUDGET_TONE: Record<BudgetState, Tone> = {
  healthy: 'ok',
  surplus: 'ok',
  at_risk: 'warn',
  overrun: 'bad',
  unknown: 'neutral',
};

/* ------------------------------------------------------------------ */
/* Rolling a whole project up                                          */
/* ------------------------------------------------------------------ */

export interface ProjectHealth {
  tone: Tone;
  /** An i18n key, so the caller renders it in the reader's language. */
  labelKey:
    | 'health.complete'
    | 'health.paused'
    | 'health.late'
    | 'health.behind'
    | 'health.atRisk'
    | 'health.onTrack'
    | 'health.notStarted'
    | 'health.unknown';
  schedule: Schedule;
  progress: ProgressVerdict;
  /**
   * True when the verdict says nothing the status does not already say.
   *
   * A card showing a "Completed" status chip beside a "Complete" health chip
   * has spent two pieces of furniture on one fact. The caller uses this to drop
   * the second one.
   */
  redundantWithStatus: boolean;
}

/**
 * One verdict for a whole project, in the order a person would reach it.
 *
 * The order is the design. Somebody scanning a portfolio wants the worst true
 * thing about each row, not a weighted score — "late" beats "behind" beats "at
 * risk", and a finished project is finished whatever its dates say. A composite
 * index would be more precise and less useful: nobody can act on 0.72.
 */
export function projectHealth(
  input: {
    progress: number | null;
    startDate: string | null;
    endDate: string | null;
    status: WorkStatus | null;
    openIssues?: number;
    overdueTasks?: number;
  },
  today = new Date()
): ProjectHealth {
  const schedule = scheduleOf(input.endDate, input.status, today);
  const progress = progressVerdict(input.progress ?? 0, input.startDate, input.endDate, today);
  const verdict = (
    tone: Tone,
    labelKey: ProjectHealth['labelKey'],
    redundantWithStatus = false
  ): ProjectHealth => ({ tone, labelKey, schedule, progress, redundantWithStatus });

  if (input.status?.category === 'done' || progress.state === 'complete') {
    return verdict('ok', 'health.complete', input.status?.category === 'done');
  }

  /**
   * A paused project is not a late one, and calling it late is the single most
   * misleading thing this function could do.
   *
   * Work stopped for a reason outside the team — a client waiting on a budget,
   * a decision not yet taken. Its dates keep advancing and its progress keeps
   * standing still, so every rule below this line would eventually paint it
   * red and put it at the top of a list of things to worry about, next to
   * projects that are genuinely failing. The team cannot act on it, so it must
   * not compete for their attention.
   *
   * Matched on the status *key* rather than the category, because the schema
   * has no "paused" category — `on_hold` sits under `open`. An organization
   * that renamed the status keeps its key, and one that deleted it falls
   * through to the rules below, which is the correct degradation.
   */
  if (input.status?.key === 'on_hold') {
    return verdict('neutral', 'health.paused', true);
  }
  if (input.status?.category === 'cancelled') {
    return verdict('neutral', 'health.unknown', true);
  }

  if (schedule.state === 'late') return verdict('bad', 'health.late');
  if (progress.state === 'behind') return verdict('bad', 'health.behind');
  if ((input.overdueTasks ?? 0) > 0 || schedule.state === 'due-soon' || schedule.state === 'due-today') {
    return verdict('warn', 'health.atRisk');
  }
  if ((input.progress ?? 0) === 0 && schedule.state !== 'none') {
    return verdict('neutral', 'health.notStarted');
  }
  if (progress.state === 'unknown') return verdict('neutral', 'health.unknown');
  return verdict('info', 'health.onTrack');
}

/** Roll a phase list up the way the overview and the project header both need. */
export function rollUpPhases(phases: Phase[]): { progress: number | null; done: number; total: number } {
  const total = phases.reduce((sum, phase) => sum + phase.taskCount, 0);
  const done = phases.reduce((sum, phase) => sum + phase.doneCount, 0);
  // Weighted by task count, not a mean of the phase percentages: a phase with
  // one task must not count as much as a phase with forty.
  if (total === 0) return { progress: null, done, total };
  const weighted = phases.reduce((sum, phase) => sum + phase.progress * phase.taskCount, 0);
  return { progress: Math.round(weighted / total), done, total };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * Money, in the project's own currency.
 *
 * `Intl` rather than a hand-rolled thousands separator, and the currency is
 * always shown — a bare "450,000" on a screen that also carries hours is
 * genuinely ambiguous.
 */
export function formatMoney(amount: number | null | undefined, currency = 'EGP', lang = 'ar'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat(lang === 'en' ? 'en-EG' : 'ar-EG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // An unknown currency code must not take the screen down with it.
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
}

/** Hours, to one decimal, without the trailing `.0` on a whole number. */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return '—';
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
