/**
 * Small pieces the attendance area and the employee profile share: a status
 * pill, the range picker, a strip of days, the month calendar and a rate bar.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { CalendarRange } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { date as formatDate, num, pct, useHRText } from '../format';
import {
  PRESET_LABEL,
  STATUS,
  WEEKDAY,
  clockText,
  minutesText,
  presetRange,
  statusColor,
  type AttendanceDay,
  type DateRange,
  type DayStatus,
  type RangePreset,
} from './model';

export function StatusPill({ status, className, children }: { status: DayStatus | null | undefined; className?: string; children?: ReactNode }) {
  const { pick } = useHRText();
  const meta = STATUS[status ?? 'none'] ?? STATUS.none;
  const light = ['off', 'holiday', 'none', 'future', 'nodata', 'exempt'].includes(status ?? 'none');
  return (
    <span
      className={cx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-bold', className)}
      style={light ? { background: 'rgb(241 245 249)', color: 'rgb(71 85 105)' } : { background: `rgb(${meta.color} / 0.1)`, color: `rgb(${meta.color})`, boxShadow: `inset 0 0 0 1px rgb(${meta.color} / 0.22)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: light ? 'rgb(148 163 184)' : `rgb(${meta.color})` }} aria-hidden="true" />
      {children ?? pick(meta.label)}
    </span>
  );
}

/** Preset chips plus a custom from/to. Ranges are Cairo days, at most a year. */
export function RangePicker({ value, onChange, presets = ['today', 'week', 'month', 'last30', 'lastMonth'] }: { value: DateRange; onChange: (range: DateRange) => void; presets?: Array<Exclude<RangePreset, 'custom'>> }) {
  const { t, pick } = useHRText();
  const [custom, setCustom] = useState(value.preset === 'custom');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="hr-glass inline-flex flex-wrap gap-1 rounded-2xl p-1" role="group" aria-label={t('الفترة', 'Period')}>
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={value.preset === preset}
            onClick={() => {
              setCustom(false);
              onChange(presetRange(preset));
            }}
            className={cx('h-9 rounded-xl px-3 text-[12.5px] font-semibold transition-colors', value.preset === preset ? 'bg-[rgb(var(--hr-a1))] text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-navy')}
          >
            {pick(PRESET_LABEL[preset])}
          </button>
        ))}
        <button type="button" aria-pressed={custom} onClick={() => setCustom((open) => !open)} className={cx('inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold transition-colors', value.preset === 'custom' ? 'bg-[rgb(var(--hr-a1))] text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-navy')}>
          <CalendarRange size={14} aria-hidden="true" />
          {t('فترة مخصصة', 'Custom')}
        </button>
      </div>
      {custom && (
        <div className="hr-glass flex flex-wrap items-center gap-2 rounded-2xl px-3 py-1.5">
          <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
            {t('من', 'From')}
            <input type="date" className="field !h-8 !w-auto !py-0 text-[12.5px]" value={value.from} max={value.to} onChange={(event) => event.target.value && onChange({ preset: 'custom', from: event.target.value, to: value.to })} />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
            {t('إلى', 'To')}
            <input type="date" className="field !h-8 !w-auto !py-0 text-[12.5px]" value={value.to} min={value.from} onChange={(event) => event.target.value && onChange({ preset: 'custom', from: value.from, to: event.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}

/** One coloured cell per day, newest at the end. */
export function DayStrip({ days, max = 30, size = 9 }: { days: Array<[string, DayStatus]>; max?: number; size?: number }) {
  const { pick, lang } = useHRText();
  const shown = days.slice(-max);
  return (
    <span className="flex items-center gap-[3px]" role="img" aria-label={shown.map(([day, status]) => `${formatDate(day, lang, 'short')}: ${pick(STATUS[status]?.label)}`).join('، ')}>
      {shown.map(([day, status]) => (
        <span key={day} title={`${formatDate(day, lang, 'short')} · ${pick(STATUS[status]?.label)}`} className="shrink-0 rounded-[3px]" style={{ width: size, height: size + 6, background: statusColor(status) }} />
      ))}
    </span>
  );
}

/** A thin rate bar with its figure. */
export function RateBar({ value, tone }: { value: number | null | undefined; tone?: 'good' | 'warn' | 'bad' | 'auto' }) {
  const { lang } = useHRText();
  const percent = value === null || value === undefined ? null : Math.round(value * 100);
  const color = tone === 'good' ? '21 128 61' : tone === 'warn' ? '180 83 9' : tone === 'bad' ? '190 18 60' : percent === null ? '148 163 184' : percent >= 90 ? '21 128 61' : percent >= 75 ? '180 83 9' : '190 18 60';
  return (
    <span className="flex min-w-[5.5rem] items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <span className="block h-full rounded-full" style={{ width: `${percent ?? 0}%`, background: `rgb(${color})` }} />
      </span>
      <b className="w-10 text-end text-[12.5px] font-bold tabular-nums text-navy">{percent === null ? '—' : pct(percent, lang)}</b>
    </span>
  );
}

/** Which colours a list of statuses uses, as a legend. */
export function Legend({ statuses }: { statuses: DayStatus[] }) {
  const { pick } = useHRText();
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
      {statuses.map((status) => (
        <li key={status} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: statusColor(status) }} aria-hidden="true" />
          {pick(STATUS[status].label)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The days of a range as calendar weeks (Saturday first). Each cell shows the
 * status colour and the first punch; choosing one opens its detail.
 */
export function AttendanceCalendar({ days, selected, onSelect }: { days: AttendanceDay[]; selected: string | null; onSelect: (day: string) => void }) {
  const { lang, pick, t } = useHRText();
  const weeks = useMemo(() => {
    if (!days.length) return [] as Array<Array<AttendanceDay | null>>;
    const rows: Array<Array<AttendanceDay | null>> = [];
    // Python weekday (Mon=0) → column with Saturday first.
    const column = (weekday: number) => (weekday + 2) % 7;
    let week: Array<AttendanceDay | null> = Array.from({ length: column(days[0].weekday) }, () => null);
    for (const day of days) {
      if (week.length === 7) {
        rows.push(week);
        week = [];
      }
      week.push(day);
    }
    while (week.length < 7) week.push(null);
    rows.push(week);
    return rows;
  }, [days]);
  const headers = [5, 6, 0, 1, 2, 3, 4];
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[30rem] table-fixed border-separate border-spacing-1.5" aria-label={t('تقويم الحضور', 'Attendance calendar')}>
        <thead>
          <tr>{headers.map((weekday) => <th key={weekday} scope="col" className="pb-1 text-[11px] font-bold text-slate-500">{pick(WEEKDAY[weekday])}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week, index) => (
            <tr key={index}>
              {week.map((day, cell) => {
                if (!day) return <td key={cell} />;
                const status = day.effective;
                const light = ['off', 'holiday', 'none', 'future', 'nodata', 'exempt'].includes(status);
                const meta = STATUS[status] ?? STATUS.none;
                const active = selected === day.date;
                return (
                  <td key={day.date}>
                    <button
                      type="button"
                      onClick={() => onSelect(day.date)}
                      aria-pressed={active}
                      aria-label={`${formatDate(day.date, lang)} · ${pick(meta.label)}${day.first ? ` · ${clockText(day.first, lang)}` : ''}`}
                      className={cx('flex h-16 w-full flex-col justify-between rounded-xl p-1.5 text-start transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5', active && 'ring-2 ring-[rgb(var(--hr-a1))] ring-offset-2')}
                      style={light ? { background: 'rgb(241 245 249)', color: 'rgb(100 116 139)' } : { background: `rgb(${meta.color} / 0.12)`, color: `rgb(${meta.color})`, boxShadow: `inset 0 0 0 1px rgb(${meta.color} / 0.28)` }}
                    >
                      <span className="flex items-center justify-between text-[11px] font-bold tabular-nums">
                        {Number(day.date.slice(8))}
                        {day.timeOff && <span className="h-1.5 w-1.5 rounded-full" style={{ background: day.timeOff.approved ? `rgb(${STATUS.leave.color})` : 'rgb(148 163 184)' }} aria-hidden="true" />}
                      </span>
                      <span className="truncate text-[10.5px] font-semibold leading-tight">
                        {day.first ? clockText(day.first, lang) : light ? '' : pick(meta.label)}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What happened on one day: punches, hours, lateness and the leave covering it. */
export function DayDetail({ day }: { day: AttendanceDay }) {
  const { t, lang, pick } = useHRText();
  return (
    <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-bold text-navy">{formatDate(day.date, lang)} · {pick(WEEKDAY[day.weekday])}</p>
        <StatusPill status={day.effective} />
      </div>
      {day.effective !== day.status && <p className="mt-1 text-[12px] text-slate-600">{t('حالة البصمة الأصلية:', 'Fingerprint status:')} {pick(STATUS[day.status]?.label)}</p>}
      {day.timeOff && (
        <p className="mt-2 rounded-xl bg-white px-3 py-2 text-[12.5px] text-slate-700 ring-1 ring-slate-200">
          <b className="text-navy">{day.timeOff.type}</b> · {day.timeOff.approved ? t('معتمدة في Odoo', 'approved in Odoo') : t('طلب قيد الاعتماد', 'request pending approval')}
          {day.timeOff.from !== day.timeOff.to && <> · {formatDate(day.timeOff.from, lang, 'short')} – {formatDate(day.timeOff.to, lang, 'short')}</>}
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label={t('أول بصمة', 'First in')} value={clockText(day.first, lang)} />
        <Fact label={t('آخر بصمة', 'Last out')} value={clockText(day.last, lang)} />
        <Fact label={t('ساعات العمل', 'Worked')} value={day.worked === null ? '—' : minutesText(day.worked, lang)} />
        <Fact label={t('تأخير', 'Late by')} value={day.late ? minutesText(day.late, lang) : '—'} tone={day.late ? 'warn' : undefined} />
        {day.early > 0 && <Fact label={t('خروج مبكر', 'Left early by')} value={minutesText(day.early, lang)} tone="warn" />}
        {day.overtime > 0 && <Fact label={t('إضافي', 'Overtime')} value={minutesText(day.overtime, lang)} />}
        {day.break ? <Fact label={t('استراحة', 'Break')} value={minutesText(day.break, lang)} /> : null}
      </dl>
      {day.punches.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11.5px] font-bold text-slate-500">{t(`البصمات (${day.punches.length})`, `Punches (${day.punches.length})`)}</p>
          <ul className="flex flex-wrap gap-1.5">
            {day.punches.map((punch, index) => (
              <li key={`${punch.at}-${index}`} className="rounded-lg bg-white px-2 py-1 text-[12px] font-semibold tabular-nums text-navy ring-1 ring-slate-200" title={punch.device}>
                {clockText(punch.at, lang)}
                <span className="ms-1.5 text-[10.5px] font-medium text-slate-500">{punch.device}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Fact({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: 'warn' | 'bad' | 'good' }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-semibold text-slate-500">{label}</dt>
      <dd className={cx('mt-0.5 text-[14px] font-bold tabular-nums', tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-rose-700' : tone === 'good' ? 'text-green-700' : 'text-navy')}>{value}</dd>
    </div>
  );
}

/** A figure tile with an optional comparison to the previous period. */
export function FigureTile({ label, value, hint, delta, better = 'up' }: { label: ReactNode; value: ReactNode; hint?: ReactNode; delta?: number | null; better?: 'up' | 'down' }) {
  const { lang } = useHRText();
  const good = delta === null || delta === undefined || delta === 0 ? null : better === 'up' ? delta > 0 : delta < 0;
  return (
    <div className="hr-glass min-w-0 rounded-2xl px-4 py-3.5">
      <p className="line-clamp-2 text-[12px] font-semibold leading-4 text-slate-600">{label}</p>
      <p className="mt-1.5 text-[22px] font-extrabold leading-7 tabular-nums text-navy">{value}</p>
      {(hint || good !== null) && (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-500">
          {good !== null && delta !== null && delta !== undefined && (
            <span className={cx('font-bold tabular-nums', good ? 'text-green-700' : 'text-rose-700')}>
              {delta > 0 ? '▲' : '▼'} {num(Math.abs(delta), lang, 1)}
            </span>
          )}
          {hint}
        </p>
      )}
    </div>
  );
}
