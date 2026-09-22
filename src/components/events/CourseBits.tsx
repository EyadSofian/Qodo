/**
 * Small pieces a course card and the details panel both use.
 */

import { AlertTriangle, CalendarDays, Clock } from 'lucide-react';
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
import { TONE, capacityTone } from './tones';

/**
 * "24 / 50 متدرب" over a thin bar coloured by how full the course is.
 * Unknown capacity says "24 متدرب" and draws nothing: a bar against an
 * invented denominator is a lie with a shape.
 */
export function CapacityProgress({ count, capacity, className }: { count: number; capacity: number | null; className?: string }) {
  const ratio = capacity ? Math.min(1, count / capacity) : null;
  const tone = TONE[capacityTone(count, capacity)];
  return (
    <div className={cx('min-w-0', className)}>
      <p className="whitespace-nowrap text-[13px] text-slate-600">
        <span className="text-[15px] font-extrabold tabular-nums text-slate-900">{count.toLocaleString('en-US')}</span>
        {capacity ? <span className="font-semibold tabular-nums text-slate-500"> / {capacity.toLocaleString('en-US')}</span> : null}
        <span> متدرب</span>
      </p>
      {ratio !== null && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <span className={cx('block h-full rounded-full', tone.dot)} style={{ width: `${Math.max(4, ratio * 100)}%` }} />
          </span>
          <span className={cx('text-[11.5px] font-bold tabular-nums', tone.text)}>{Math.round(ratio * 100)}%</span>
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

/**
 * The tinted "المحاضرة الجاية" box — its colour says which situation it is:
 * green today, violet coming up, amber when Odoo has no lectures to show.
 */
export function NextSessionBox({ row, now }: { row: TrainingScheduleRow; now: Date }) {
  const pick = currentOrNext(row.sessions, now);
  const total = plannedTotal(row);

  if (!pick) {
    const missing = row.sessionsTotal === 0;
    const text = missing
      ? row.lectureCount
        ? `${row.lectureCount} محاضرة مخطّطة ولسه مش متولّدة في أودو`
        : 'لسه مفيش محاضرات في أودو'
      : 'كل المحاضرات خلصت';
    return (
      <div className={cx('rounded-xl border px-3.5 py-3', missing ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50')}>
        <p className={cx('text-[11.5px] font-bold', missing ? 'text-amber-800' : 'text-slate-500')}>المحاضرة الجاية</p>
        <p className={cx('mt-1 flex items-center gap-1.5 text-[13px] font-semibold', missing ? 'text-amber-900' : 'text-slate-600')}>
          {missing && <AlertTriangle size={14} className="shrink-0" />}
          {text}
        </p>
      </div>
    );
  }

  const { session, live } = pick;
  const today = ksaDay(session.startsAt) === ksaDay(now.toISOString());
  return (
    <div
      className={cx(
        'rounded-xl border px-3.5 py-3',
        today ? 'border-emerald-200 bg-gradient-to-l from-emerald-50 to-blue-50' : 'border-violet-200 bg-gradient-to-l from-violet-50 to-white'
      )}
    >
      <p className={cx('text-[11.5px] font-bold', today ? 'text-emerald-700' : 'text-violet-700')}>{live ? 'شغّالة دلوقتي' : 'المحاضرة الجاية'}</p>
      <p className="mt-1 flex items-center gap-2 text-[14.5px] font-extrabold text-slate-900">
        <span aria-hidden className="relative grid h-2.5 w-2.5 place-items-center">
          {live && <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400 opacity-70" />}
          <span className={cx('relative h-2.5 w-2.5 rounded-full', today ? 'bg-emerald-500' : 'bg-violet-500')} />
        </span>
        {whenLabel(session.startsAt!, now)}، <span className="tabular-nums">{ksaTime(session.startsAt)}</span>
      </p>
      <p className="mt-0.5 text-[12.5px] font-medium text-slate-600">
        محاضرة <span className="font-bold tabular-nums text-slate-800">{session.number}</span> من <span className="tabular-nums">{total}</span>
      </p>
    </div>
  );
}

/** "15 أغسطس 2026 ← 12 سبتمبر 2026", each date isolated so RTL never scrambles it. */
export function DateSpan({ row, withIcon = true }: { row: Pick<TrainingScheduleRow, 'startsAt' | 'endsAt'>; withIcon?: boolean }) {
  return (
    <p className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-slate-800">
      {withIcon && <CalendarDays size={15} className="shrink-0 text-blue-500" />}
      {row.startsAt || row.endsAt ? (
        <span className="min-w-0 truncate">
          <bdi>{row.startsAt ? ksaDate(row.startsAt) : '—'}</bdi>
          <span className="mx-1.5 text-slate-400">←</span>
          <bdi>{row.endsAt ? ksaDate(row.endsAt) : '—'}</bdi>
        </span>
      ) : (
        <span className="text-slate-500">مفيش تواريخ في أودو</span>
      )}
    </p>
  );
}

/** "سبت • اتنين • أربع   7:00 م – 10:00 م بتوقيت السعودية". */
export function DaysAndTime({ row, withIcon = true }: { row: Pick<TrainingScheduleRow, 'workDays' | 'startTimeKsa' | 'endTimeKsa'>; withIcon?: boolean }) {
  const days = row.workDays.map((day) => WEEKDAY_AR[day] ?? day).join(' • ');
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium text-slate-800">
      {withIcon && <Clock size={15} className="shrink-0 text-violet-500" />}
      <span className="min-w-0">{days || <span className="text-slate-500">أيام الدراسة مش معروفة</span>}</span>
      {row.startTimeKsa && (
        <span className="whitespace-nowrap text-slate-600">
          <span className="tabular-nums">{hhmmLabel(row.startTimeKsa)}</span>
          {row.endTimeKsa ? (
            <>
              {' – '}
              <span className="tabular-nums">{hhmmLabel(row.endTimeKsa)}</span>
            </>
          ) : null}
          <span className="ms-1 text-[11.5px] font-semibold text-slate-500">بتوقيت السعودية</span>
        </span>
      )}
    </p>
  );
}
