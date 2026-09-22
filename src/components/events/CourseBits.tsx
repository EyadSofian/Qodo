/**
 * Small pieces a course card and the details panel both use.
 */

import { CalendarDays, Clock } from 'lucide-react';
import { ksaDay } from '@shared/eventsSchedule';
import {
  hhmmLabel,
  ksaDate,
  ksaDayLabel,
  ksaTime,
  WEEKDAY_AR,
  type TrainingScheduleRow,
  type TrainingSession,
} from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';

/**
 * "24 / 50 متدرب" over a thin bar. Unknown capacity says "24 متدرب" and draws
 * nothing: a bar against an invented denominator is a lie with a shape.
 */
export function CapacityProgress({ count, capacity, className }: { count: number; capacity: number | null; className?: string }) {
  const ratio = capacity ? Math.min(1, count / capacity) : null;
  return (
    <div className={cx('min-w-0', className)}>
      <p className="whitespace-nowrap text-[13px] text-ink-muted">
        <span className="font-bold tabular-nums text-ink">{count.toLocaleString('en-US')}</span>
        {capacity ? <span className="tabular-nums"> / {capacity.toLocaleString('en-US')}</span> : null}
        <span> متدرب</span>
      </p>
      {ratio !== null && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
            <span
              className={cx('block h-full rounded-full', ratio >= 0.8 ? 'bg-accent-500' : 'bg-brand-500')}
              style={{ width: `${Math.max(3, ratio * 100)}%` }}
            />
          </span>
          <span className="text-[11px] font-semibold tabular-nums text-ink-faint">{Math.round(ratio * 100)}%</span>
        </div>
      )}
    </div>
  );
}

/** Planned lectures win when Odoo has generated fewer: "8 of 12", not "8 of 8". */
export const plannedTotal = (row: Pick<TrainingScheduleRow, 'sessionsTotal' | 'lectureCount'>) =>
  Math.max(row.sessionsTotal, row.lectureCount ?? 0);

const endOf = (session: TrainingSession) =>
  session.endsAt ? Date.parse(session.endsAt) : Date.parse(session.startsAt ?? '') + (session.durationHours || 1) * 3_600_000;

/**
 * The lecture that matters now: one in progress, else the next one. A lecture
 * that started twenty minutes ago is not "past" to somebody about to join it.
 */
export function currentOrNext(sessions: TrainingSession[], now: Date): { session: TrainingSession; live: boolean } | null {
  const t = now.getTime();
  for (const session of sessions) {
    if (!session.startsAt) continue;
    const start = Date.parse(session.startsAt);
    if (start <= t && t < endOf(session)) return { session, live: true };
    if (start > t) return { session, live: false };
  }
  return null;
}

export function whenLabel(startsAt: string, now: Date) {
  return ksaDay(startsAt) === ksaDay(now.toISOString()) ? 'النهاردة' : ksaDayLabel(startsAt);
}

/** The tinted "المحاضرة الجاية" box. */
export function NextSessionBox({ row, now }: { row: TrainingScheduleRow; now: Date }) {
  const pick = currentOrNext(row.sessions, now);
  const total = plannedTotal(row);

  if (!pick) {
    const text =
      row.sessionsTotal === 0
        ? row.lectureCount
          ? `${row.lectureCount} محاضرة مخطّطة ولسه مش متولّدة في أودو`
          : 'لسه مفيش محاضرات في أودو'
        : 'مفيش محاضرات جاية';
    return (
      <div className="rounded-xl bg-surface-bg px-3.5 py-3">
        <p className="text-[11.5px] font-semibold text-ink-faint">المحاضرة الجاية</p>
        <p className="mt-1 text-[13px] text-ink-muted">{text}</p>
      </div>
    );
  }

  const { session, live } = pick;
  const today = ksaDay(session.startsAt) === ksaDay(now.toISOString());
  return (
    <div className={cx('rounded-xl px-3.5 py-3', today ? 'bg-brand-50' : 'bg-surface-bg')}>
      <p className="text-[11.5px] font-semibold text-ink-faint">{live ? 'شغّالة دلوقتي' : 'المحاضرة الجاية'}</p>
      <p className={cx('mt-1 flex items-center gap-2 text-[14px] font-bold', today ? 'text-brand-700' : 'text-ink')}>
        <span aria-hidden className={cx('h-2 w-2 shrink-0 rounded-full', today ? 'bg-brand-500' : 'bg-ink-faint')} />
        {whenLabel(session.startsAt!, now)}، <span className="tabular-nums">{ksaTime(session.startsAt)}</span>
      </p>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">
        محاضرة <span className="tabular-nums">{session.number}</span> من <span className="tabular-nums">{total}</span>
      </p>
    </div>
  );
}

/** "15 أغسطس 2026 ← 12 سبتمبر 2026", each date isolated so RTL never scrambles it. */
export function DateSpan({ row, withIcon = true }: { row: Pick<TrainingScheduleRow, 'startsAt' | 'endsAt'>; withIcon?: boolean }) {
  return (
    <p className="flex min-w-0 items-center gap-2 text-[13px] text-ink">
      {withIcon && <CalendarDays size={15} className="shrink-0 text-ink-faint" />}
      {row.startsAt || row.endsAt ? (
        <span className="min-w-0 truncate">
          <bdi>{row.startsAt ? ksaDate(row.startsAt) : '—'}</bdi>
          <span className="mx-1.5 text-ink-faint">←</span>
          <bdi>{row.endsAt ? ksaDate(row.endsAt) : '—'}</bdi>
        </span>
      ) : (
        <span className="text-ink-faint">مفيش تواريخ في أودو</span>
      )}
    </p>
  );
}

/** "سبت • اتنين • أربع   7:00 م – 10:00 م السعودية". */
export function DaysAndTime({ row, withIcon = true }: { row: Pick<TrainingScheduleRow, 'workDays' | 'startTimeKsa' | 'endTimeKsa'>; withIcon?: boolean }) {
  const days = row.workDays.map((day) => WEEKDAY_AR[day] ?? day).join(' • ');
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink">
      {withIcon && <Clock size={15} className="shrink-0 text-ink-faint" />}
      <span className="min-w-0">{days || <span className="text-ink-faint">أيام الدراسة مش معروفة</span>}</span>
      {row.startTimeKsa && (
        <span className="whitespace-nowrap text-ink-muted">
          <span className="tabular-nums">{hhmmLabel(row.startTimeKsa)}</span>
          {row.endTimeKsa ? (
            <>
              {' – '}
              <span className="tabular-nums">{hhmmLabel(row.endTimeKsa)}</span>
            </>
          ) : null}
          <span className="ms-1 text-[11.5px] text-ink-faint">بتوقيت السعودية</span>
        </span>
      )}
    </p>
  );
}
