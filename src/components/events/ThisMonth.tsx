/**
 * هذا الشهر — one question: which courses run this month, and when?
 *
 * The one place in the module where a table is the right shape: a month is a
 * short, scannable list, and the columns are few and fixed. It is still not
 * the workbook — no S1…S40, no comments column, no grid lines — just a clean
 * table with a sticky header, and on a phone the same rows as compact cards.
 *
 * Rows are live Odoo courses whose dates overlap the month (shared/eventsMonth.js);
 * the layout only adds the Package column. It never decides whether a course
 * exists: one nobody has placed is listed as "not in a package", and one
 * hidden from the Schedule (by itself or with its package) is listed as usual.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { decorateRows } from '@shared/eventsLayout';
import { DEPARTMENT_PRESETS, EMPTY_FILTERS, applyFilters, ksaDay } from '@shared/eventsSchedule';
import { monthBounds, monthOf, monthRows, monthSummary, shiftMonth, startedBefore } from '@shared/eventsMonth';
import { errorMessage } from '../../lib/api';
import type { EventLayout, PlacedRow } from '../../lib/eventsLayout';
import { WEEKDAY_AR, fetchSchedule, hhmmLabel, ksaDayLabel, ksaShortDate, ksaTime, type ScheduleResponse } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { currentOrNext } from './CourseBits';
import { StatusChip } from './EventStatusBadge';
import { PillSelect, SearchField, StatusSelect, TypeSelect, type ScheduleFilters } from './EventsFilters';
import { GLASS, TONE, capacityTone } from './tones';
import { accentTone } from './LayoutDialogs';

const monthName = (month: string) => {
  const [year, index] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(year, index - 1, 1));
};

const DAY_MS = 86_400_000;

/** "النهاردة · 7:00 م", "بكرة · 8:00 م", "الخميس 24 سبتمبر · 7:00 م". */
function nextLabel(row: PlacedRow, now: Date): { day: string; time: string; tone: string } {
  if (row.monthBucket === 'finished' || row.statusCanonical === 'finished') return { day: 'خلصت', time: '', tone: 'text-slate-500' };
  if (row.statusCanonical === 'canceled' || row.statusCanonical === 'refused') return { day: 'ملغية', time: '', tone: 'text-rose-700' };
  const pick = currentOrNext(row.sessions, now);
  if (!pick?.session.startsAt) return { day: 'مفيش محاضرة متجدولة', time: '', tone: 'text-slate-500' };
  if (pick.live) return { day: 'شغّالة دلوقتي', time: ksaTime(pick.session.startsAt), tone: 'text-emerald-700' };
  const day = ksaDay(pick.session.startsAt);
  if (day === ksaDay(now.toISOString())) return { day: 'النهاردة', time: ksaTime(pick.session.startsAt), tone: 'text-blue-700' };
  if (day === ksaDay(new Date(now.getTime() + DAY_MS).toISOString())) return { day: 'بكرة', time: ksaTime(pick.session.startsAt), tone: 'text-violet-700' };
  return { day: ksaDayLabel(pick.session.startsAt), time: ksaTime(pick.session.startsAt), tone: 'text-slate-900' };
}

function Trainees({ row }: { row: PlacedRow }) {
  const ratio = row.capacity ? Math.min(1, row.traineeCount / row.capacity) : null;
  return (
    <div className="min-w-[4.5rem]">
      <p className="whitespace-nowrap text-[13px] font-extrabold tabular-nums text-slate-900">
        {row.traineeCount}
        {row.capacity ? <span className="font-semibold text-slate-500"> / {row.capacity}</span> : null}
      </p>
      {ratio !== null && (
        <span className="mt-1 block h-1 w-16 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <span className={cx('block h-full rounded-full', TONE[capacityTone(row.traineeCount, row.capacity)].dot)} style={{ width: `${Math.max(6, ratio * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

function ScheduleCell({ row, month }: { row: PlacedRow; month: string }) {
  if (startedBefore(row, month)) {
    return (
      <div className="whitespace-nowrap text-[12.5px] leading-5">
        <p className="text-slate-500">
          بدأت <bdi className="font-semibold text-slate-700">{ksaShortDate(row.startsAt)}</bdi>
        </p>
        <p className="text-slate-900">
          بتخلص <bdi className="font-bold">{row.endsAt ? ksaShortDate(row.endsAt) : '—'}</bdi>
        </p>
      </div>
    );
  }
  return (
    <p className="whitespace-nowrap text-[12.5px] font-semibold text-slate-900">
      <bdi>{row.startsAt ? ksaShortDate(row.startsAt) : '—'}</bdi>
      <span className="mx-1 text-slate-400">←</span>
      <bdi>{row.endsAt ? ksaShortDate(row.endsAt) : '—'}</bdi>
    </p>
  );
}

function PackageCell({ row }: { row: PlacedRow }) {
  if (!row.placement) return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-bold text-slate-500">مش في باقة</span>;
  const tone = accentTone(row.placement.packageAccent);
  return (
    <div className="min-w-0 max-w-[13rem]">
      <p className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className={cx('h-2 w-2 shrink-0 rounded-full', tone.dot)} />
        <bdi dir="auto" className="truncate text-[12.5px] font-bold text-slate-900">
          {row.placement.packageLabel}
        </bdi>
      </p>
      {row.placement.packageHiddenInSchedule && <p className="ps-3.5 text-[11px] font-semibold text-slate-400">مخفية من الجدول</p>}
      {row.placement.groupLabel && (
        <p className="truncate ps-3.5 text-[11.5px] text-slate-500" dir="auto">
          {row.placement.groupLabel}
        </p>
      )}
    </div>
  );
}

const days = (row: PlacedRow) => row.workDays.map((day) => WEEKDAY_AR[day] ?? day).join(' • ');
const ksaHours = (row: PlacedRow) =>
  row.startTimeKsa ? `${hhmmLabel(row.startTimeKsa)}${row.endTimeKsa ? ` – ${hhmmLabel(row.endTimeKsa)}` : ''}` : null;

export function ThisMonth({
  version,
  layout,
  selectedId,
  onOpen,
}: {
  version: number;
  /** The saved layout (never a draft being edited), for the Package column. */
  layout: EventLayout | null;
  selectedId: number | null;
  onOpen: (id: number) => void;
}) {
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState<ScheduleFilters>({ ...EMPTY_FILTERS, showClosed: true });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchSchedule(monthBounds(month))
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoadedMonth(month);
      })
      .catch((err) => !cancelled && setError(errorMessage(err, 'ar')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [month, version, attempt]);

  const now = useMemo(() => new Date(), [data]);
  const rows = useMemo(() => {
    if (!data || !loadedMonth) return null;
    const decorated = (layout ? decorateRows(data.rows, layout) : data.rows) as PlacedRow[];
    return monthRows(applyFilters(decorated, filters, now), loadedMonth, now) as PlacedRow[];
  }, [data, loadedMonth, layout, filters, now]);
  const summary = rows && loadedMonth ? monthSummary(rows, loadedMonth, now) : null;
  const current = monthOf(new Date());

  return (
    <div className="grid min-w-0 gap-4">
      {/* Month, and the five numbers — a strip, not KPI cards. */}
      <section className={`flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl px-4 py-3 ${GLASS}`} aria-label="الشهر">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="الشهر اللي فات" className="grid h-9 w-9 place-items-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:text-slate-900">
            <ChevronRight size={18} />
          </button>
          <label className="relative">
            <span className="sr-only">اختار الشهر</span>
            <span className="pointer-events-none flex h-9 min-w-[10.5rem] items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-blue-600 to-violet-600 px-3.5 text-[14px] font-black text-white shadow-lg shadow-blue-600/25">
              <CalendarDays size={16} /> {monthName(month)}
            </span>
            <input
              type="month"
              value={month}
              onChange={(event) => event.target.value && setMonth(event.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="الشهر الجاي" className="grid h-9 w-9 place-items-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:text-slate-900">
            <ChevronLeft size={18} />
          </button>
          {month !== current && (
            <button type="button" onClick={() => setMonth(current)} className="ms-1 h-9 rounded-xl bg-white px-3 text-[12.5px] font-bold text-blue-700 shadow-sm ring-1 ring-blue-200 hover:bg-blue-50">
              الشهر ده
            </button>
          )}
        </div>
        <dl className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          {(
            [
              [summary?.courses, 'كورس', 'text-slate-900', 'bg-slate-400'],
              [summary?.running, 'شغّالة', 'text-emerald-700', 'bg-emerald-500'],
              [summary?.starting, 'بتبدأ', 'text-blue-700', 'bg-blue-500'],
              [summary?.finishing, 'بتخلص', 'text-violet-700', 'bg-violet-500'],
              [summary?.trainees, 'متدرب', 'text-amber-700', 'bg-amber-500'],
            ] as const
          ).map(([value, label, color, dot]) => (
            <div key={label} className="flex items-center gap-1.5">
              <span aria-hidden className={cx('h-2 w-2 rounded-full', dot)} />
              <dd className={cx('text-[16px] font-black tabular-nums', color)}>{value === undefined ? '—' : value.toLocaleString('en-US')}</dd>
              <dt className="font-semibold text-slate-600">{label}</dt>
            </div>
          ))}
        </dl>
        {loading && rows && <RefreshCw size={15} className="ms-auto animate-spin text-slate-400" aria-label="بنحمّل" />}
      </section>

      <section aria-label="البحث والفلاتر" className="flex min-w-0 flex-wrap items-center gap-2">
        <SearchField value={filters.search} onChange={(search) => setFilters({ ...filters, search })} />
        <PillSelect
          label="القسم"
          value={filters.department === 'all' ? '' : filters.department}
          options={DEPARTMENT_PRESETS.filter((preset) => preset.department).map((preset) => ({ value: preset.key, label: preset.label }))}
          onChange={(department) => setFilters({ ...filters, department: department || 'all' })}
        />
        <StatusSelect filters={filters} onChange={setFilters} />
        <TypeSelect filters={filters} onChange={setFilters} meta={data?.meta ?? null} />
      </section>

      {error && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-[13px] font-semibold text-rose-700">
          <AlertCircle size={16} />
          {error}
          <button type="button" className="btn-ghost btn-sm ms-auto" onClick={() => setAttempt((value) => value + 1)}>
            جرّب تاني
          </button>
        </div>
      )}
      {data?.stale && (
        <p className="rounded-xl bg-amber-50 px-3.5 py-2 text-[12.5px] font-semibold text-amber-800">أودو مش متاح دلوقتي — دي آخر مزامنة ناجحة.</p>
      )}

      {!rows && !error ? (
        <div className="skeleton h-[420px] rounded-3xl" aria-busy="true" />
      ) : rows && rows.length === 0 ? (
        <div className={`grid place-items-center rounded-3xl px-6 py-14 text-center ${GLASS}`}>
          <CalendarDays size={28} className="text-blue-600" />
          <h3 className="mt-3 text-[16px] font-extrabold text-slate-900">مفيش كورسات في {monthName(loadedMonth ?? month)}</h3>
          <p className="mt-1 text-[13px] text-slate-600">جرّب شهر تاني أو امسح الفلاتر.</p>
        </div>
      ) : rows ? (
        <>
          {/* Tablet and up: the table. */}
          <div className={cx('hidden overflow-x-auto rounded-3xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05),0_18px_40px_-20px_rgba(15,23,42,0.25)] md:block xl:overflow-visible xl:[&_td]:overflow-hidden', loading && 'opacity-60')}>
            {/* Below 1280px the table scrolls inside its own box; from there up the
                columns are fixed shares of the width, so it never pushes the page
                sideways and its header can stick under the app bar. */}
            <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-start xl:min-w-0 xl:table-fixed">
              <colgroup>
                {[19, 13, 10, 9, 10, 8, 9, 8, 6, 8].map((share, i) => (
                  <col key={i} style={{ width: `${share}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr className="text-[12px] font-extrabold text-slate-600">
                  {['الكورس', 'الباقة', 'المدرّب', 'النوع', 'المواعيد', 'الأيام', 'الوقت (KSA)', 'الحالة', 'المتدربين', 'المحاضرة الجاية'].map((label, i, all) => (
                    <th
                      key={label}
                      scope="col"
                      className={cx(
                        'sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-3 py-3 text-start backdrop-blur xl:top-[var(--topbar-h)]',
                        i === 0 && 'rounded-ss-3xl ps-5',
                        i === all.length - 1 && 'rounded-se-3xl pe-5'
                      )}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const next = nextLabel(row, now);
                  const selected = row.id === selectedId;
                  return (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      onClick={() => onOpen(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onOpen(row.id);
                        }
                      }}
                      aria-current={selected ? 'true' : undefined}
                      className={cx(
                        'group cursor-pointer align-middle transition-colors focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-blue-400',
                        selected ? 'bg-blue-50/80' : 'hover:bg-slate-50/80'
                      )}
                    >
                      <td className={cx('relative border-b border-slate-100 py-3 pe-3 ps-5', selected && 'shadow-[inset_-3px_0_0_#2563eb] ltr:shadow-[inset_3px_0_0_#2563eb]')}>
                        <p className="flex min-w-0 max-w-[17rem]">
                          <bdi dir="auto" className="truncate text-[14px] font-extrabold text-slate-900" title={row.courseName}>
                            {row.courseName}
                          </bdi>
                        </p>
                        <p className="mt-0.5 text-[11.5px] font-medium text-slate-500">{row.courseCode ? `كود ${row.courseCode}` : 'من غير كود'}</p>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <PackageCell row={row} />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <bdi dir="auto" className="block max-w-[10rem] truncate text-[12.5px] font-semibold text-slate-800">
                          {row.instructor ?? '—'}
                        </bdi>
                      </td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3 text-[12.5px] text-slate-700">{row.trainingType ?? '—'}</td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <ScheduleCell row={row} month={loadedMonth ?? month} />
                      </td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3 text-[12px] font-semibold text-slate-700">{days(row) || '—'}</td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3">
                        {ksaHours(row) ? (
                          <>
                            <p className="text-[12.5px] font-bold text-slate-900">{ksaHours(row)}</p>
                            <p className="text-[10.5px] font-bold tracking-wide text-slate-400">KSA</p>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <StatusChip status={row.statusCanonical} stage={row.status} />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <Trainees row={row} />
                      </td>
                      <td className="whitespace-nowrap border-b border-slate-100 py-3 pe-5 ps-3">
                        <p className={cx('text-[12.5px] font-bold', next.tone)}>{next.day}</p>
                        {next.time && <p className="text-[12px] text-slate-600">{next.time}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones: the same rows, stacked. */}
          <ul className={cx('grid gap-2.5 md:hidden', loading && 'opacity-60')}>
            {rows.map((row) => {
              const next = nextLabel(row, now);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    className={cx(
                      'grid w-full min-w-0 gap-2 rounded-2xl border bg-white px-4 py-3 text-start shadow-sm',
                      row.id === selectedId ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'
                    )}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <bdi dir="auto" className="block truncate text-[14.5px] font-extrabold text-slate-900">
                          {row.courseName}
                        </bdi>
                        <p className="text-[11.5px] text-slate-500">{row.courseCode ? `كود ${row.courseCode}` : 'من غير كود'}</p>
                      </div>
                      <StatusChip status={row.statusCanonical} stage={row.status} />
                    </div>
                    <PackageCell row={row} />
                    <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
                      <ScheduleCell row={row} month={loadedMonth ?? month} />
                      <Trainees row={row} />
                    </div>
                    <p className="flex min-w-0 flex-wrap gap-x-2 text-[12px] text-slate-600">
                      {days(row) && <span>{days(row)}</span>}
                      {ksaHours(row) && <span className="font-semibold text-slate-800">{ksaHours(row)} KSA</span>}
                    </p>
                    <p className="rounded-xl bg-slate-50 px-3 py-1.5 text-[12.5px]">
                      <span className="text-slate-500">المحاضرة الجاية: </span>
                      <b className={next.tone}>{next.day}</b>
                      {next.time && <span className="text-slate-700"> · {next.time}</span>}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
