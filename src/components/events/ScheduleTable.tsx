/**
 * The schedule grid — the operations sheet, rebuilt as a table that behaves.
 *
 * Same columns and words the team knows, left-to-right like the workbook, with
 * what the workbook could not do: headers and the course column that stay put
 * while you scroll, sorting on any column, one click into the whole course,
 * and S-columns that stop at the longest course on screen instead of running
 * blank to S40.
 *
 * Long lists are windowed: only the rows in view (plus a margin) are in the
 * DOM. Rows are a fixed height for that reason — comments truncate to one line
 * and show in full on hover and in the drawer.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { COLUMNS, groupOf, headerGroups } from '@shared/eventsSchedule';
import {
  DAY_PART_AR,
  hhmmLabel,
  ksaDate,
  ksaMonth,
  ksaShortDate,
  ksaTime,
  type TrainingScheduleRow,
} from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { CapacityCell, CommentCell, Missing, QualityMark, StatusChip, WorkDaysChips } from './ScheduleCells';
import { SessionCell } from './SessionCell';

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

const ROW_HEIGHT = 50;
const WINDOW_THRESHOLD = 120;
const OVERSCAN = 10;
const MAX_STICKY = 2;

const WIDTHS: Record<string, number> = {
  group: 176,
  courseName: 232,
  course: 260,
  courseNameCode: 272,
  webinarName: 240,
  instructor: 150,
  type: 128,
  code: 108,
  lectures: 112,
  trainees: 116,
  attCapacity: 150,
  capacity: 88,
  registrations: 128,
  month: 128,
  startDate: 108,
  endDate: 108,
  date: 116,
  startTime: 122,
  endTime: 116,
  timeKsa: 150,
  dayPart: 100,
  workDays: 150,
  nextSession: 150,
  status: 118,
  coordinator: 140,
  comments: 220,
};
const SESSION_WIDTH = 96;

const isSession = (id: string) => /^s\d+$/.test(id);
const widthOf = (id: string) => (isSession(id) ? SESSION_WIDTH : WIDTHS[id] ?? 120);

function labelOf(id: string, groupLabel: string, labels: Record<string, string>) {
  if (isSession(id)) return id.toUpperCase();
  if (id === 'group') return groupLabel;
  return labels[id] ?? COLUMNS[id as keyof typeof COLUMNS]?.label ?? id;
}

function CourseTitle({ row, withCode }: { row: TrainingScheduleRow; withCode?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0">
        <bdi dir="auto" className="block truncate font-semibold text-ink" title={row.courseName}>
          {row.courseName}
        </bdi>
        {withCode && (
          <span className="block truncate font-mono text-[10.5px] tabular-nums text-ink-faint">
            {[row.courseCode, row.department].filter(Boolean).join(' · ') || '—'}
          </span>
        )}
      </span>
      <QualityMark flags={row.qualityFlags} />
    </span>
  );
}

function renderCell(id: string, row: TrainingScheduleRow, ctx: { now: Date; coordinatorKnown: boolean }): ReactNode {
  if (isSession(id)) {
    const index = Number(id.slice(1)) - 1;
    return <SessionCell session={row.sessions[index]} index={index} now={ctx.now} />;
  }
  switch (id) {
    case 'group': {
      const value = groupOf(row) ?? row.department;
      return value ? <bdi dir="auto" className="block truncate text-ink-muted" title={value}>{value}</bdi> : <Missing />;
    }
    case 'courseName':
    case 'webinarName':
      return <CourseTitle row={row} />;
    case 'course':
      return <CourseTitle row={row} withCode />;
    case 'courseNameCode':
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <bdi dir="auto" className="truncate font-semibold text-ink" title={row.courseName}>{row.courseName}</bdi>
          {row.courseCode && <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">{row.courseCode}</span>}
          <QualityMark flags={row.qualityFlags} />
        </span>
      );
    case 'instructor':
      return row.instructor ? <bdi dir="auto" className="block truncate" title={row.instructor}>{row.instructor}</bdi> : <Missing label="مفيش مدرّب متسجّل" />;
    case 'type':
      return row.trainingType ? <span className="block truncate text-ink-muted">{row.trainingType}</span> : <Missing />;
    case 'code':
      return row.courseCode ? <span className="font-mono tabular-nums text-ink-muted">{row.courseCode}</span> : <Missing label="مفيش كود" />;
    case 'lectures':
      if (row.lectureCount === null && row.sessionsTotal === 0) return <Missing />;
      return (
        <span className="tabular-nums" title={`${row.sessionsTotal} lectures scheduled in Odoo`}>
          {row.lectureCount ?? row.sessionsTotal}
          {row.lectureCount !== null && row.sessionsTotal > 0 && row.sessionsTotal !== row.lectureCount && (
            <span className="text-accent-700"> ({row.sessionsTotal})</span>
          )}
        </span>
      );
    case 'trainees':
      return <CapacityCell count={row.traineeCount} capacity={row.capacity} />;
    case 'attCapacity':
      return <CapacityCell count={row.traineeCount} capacity={row.capacity} compact />;
    case 'capacity':
      return row.capacity !== null ? <span className="tabular-nums">{row.capacity}</span> : <Missing label="السعة مش مكتوبة في أودو" />;
    case 'registrations':
      return (
        <span className="tabular-nums">
          {row.traineeCount}
          {row.registrations.interested > 0 && <span className="text-ink-faint"> +{row.registrations.interested} interested</span>}
        </span>
      );
    case 'month':
      return row.startsAt ? ksaMonth(row.startsAt) : <Missing />;
    case 'startDate':
    case 'date':
      return row.startsAt ? <span className="whitespace-nowrap tabular-nums">{ksaDate(row.startsAt)}</span> : <Missing label="تاريخ البداية ناقص" />;
    case 'endDate':
      return row.endsAt ? <span className="whitespace-nowrap tabular-nums">{ksaDate(row.endsAt)}</span> : <Missing label="تاريخ النهاية ناقص" />;
    case 'startTime':
      return row.startTimeKsa ? <span className="whitespace-nowrap tabular-nums">{hhmmLabel(row.startTimeKsa)}</span> : <Missing />;
    case 'endTime':
      return row.endTimeKsa ? <span className="whitespace-nowrap tabular-nums">{hhmmLabel(row.endTimeKsa)}</span> : <Missing />;
    case 'timeKsa':
      return row.startTimeKsa ? (
        <span className="whitespace-nowrap tabular-nums">
          {hhmmLabel(row.startTimeKsa)}
          {row.endTimeKsa && ` – ${hhmmLabel(row.endTimeKsa)}`}
        </span>
      ) : (
        <Missing />
      );
    case 'dayPart':
      return row.dayPart ? <span title={row.dayPart}>{DAY_PART_AR[row.dayPart]}</span> : <Missing />;
    case 'workDays':
      return <WorkDaysChips days={row.workDays} source={row.workDaysSource} />;
    case 'nextSession':
      return row.nextSession ? (
        <span className="whitespace-nowrap tabular-nums">
          <span className="font-semibold text-ink">S{row.nextSession.number}</span>
          <span className="text-ink-muted"> · {ksaShortDate(row.nextSession.startsAt)} {ksaTime(row.nextSession.startsAt)}</span>
        </span>
      ) : (
        <Missing label="مفيش محاضرات جاية" />
      );
    case 'status':
      return <StatusChip status={row.statusCanonical} stage={row.status} />;
    case 'coordinator':
      if (row.coordinator) return <bdi dir="auto" className="block truncate">{row.coordinator}</bdi>;
      return <Missing label={ctx.coordinatorKnown ? 'مفيش كوردينيتور متسجّل' : 'أودو مفيهوش حقل كوردينيتور'} />;
    case 'comments':
      return <CommentCell text={row.comments} />;
    default:
      return null;
  }
}

export function ScheduleTable({
  rows,
  columns,
  grouped,
  groupLabel,
  labels = {},
  sort,
  onSort,
  onOpen,
  now,
  coordinatorKnown,
  dimmed,
}: {
  rows: TrainingScheduleRow[];
  columns: string[];
  grouped: boolean;
  groupLabel: string;
  /** The view's own header words where its sheet differed (English says "Instructor"). */
  labels?: Record<string, string>;
  sort: SortState;
  onSort: (sort: SortState) => void;
  onOpen: (id: number) => void;
  now: Date;
  coordinatorKnown: boolean;
  dimmed?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(800);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setViewport(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Frozen columns: the leading run of sticky ones, at most two.
  const stickyOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    let left = 0;
    for (const id of columns) {
      if (offsets.size >= MAX_STICKY || !COLUMNS[id as keyof typeof COLUMNS]?.sticky) break;
      offsets.set(id, left);
      left += widthOf(id);
    }
    return offsets;
  }, [columns]);
  const lastSticky = [...stickyOffsets.keys()].at(-1);

  const windowed = rows.length > WINDOW_THRESHOLD;
  const first = windowed ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const last = windowed ? Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN) : rows.length;
  const visible = rows.slice(first, last);
  const groups = grouped ? headerGroups(columns) : [];
  const totalWidth = columns.reduce((sum, id) => sum + widthOf(id), 0);

  const toggleSort = (key: string) => {
    if (sort?.key !== key) onSort({ key, dir: 'asc' });
    else if (sort.dir === 'asc') onSort({ key, dir: 'desc' });
    else onSort(null);
  };

  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, id: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(id);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const sibling = (event.key === 'ArrowDown'
        ? event.currentTarget.nextElementSibling
        : event.currentTarget.previousElementSibling) as HTMLElement | null;
      if (sibling?.tabIndex === 0) sibling.focus();
    }
  };

  const stickyStyle = (id: string) =>
    stickyOffsets.has(id) ? { left: stickyOffsets.get(id), position: 'sticky' as const } : undefined;

  return (
    <div
      ref={scroller}
      dir="ltr"
      onScroll={(event) => windowed && setScrollTop(event.currentTarget.scrollTop)}
      className={cx(
        'relative max-h-[calc(100dvh-300px)] min-h-[360px] overflow-auto rounded-2xl border border-surface-line bg-white shadow-card transition-opacity',
        dimmed && 'opacity-60'
      )}
    >
      <table className="border-separate border-spacing-0 text-[12.5px] text-ink" style={{ width: totalWidth, tableLayout: 'fixed' }}>
        <colgroup>
          {columns.map((id) => (
            <col key={id} style={{ width: widthOf(id) }} />
          ))}
        </colgroup>
        <thead>
          {grouped && (
            <tr>
              {groups.flatMap((group, index) => {
                const band = 'sticky top-0 z-20 h-7 border-b border-surface-line bg-surface-bg px-3 text-start text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint';
                // The first band is split where the frozen columns end, so the
                // part above them freezes too instead of scrolling off blank.
                const frozen = index === 0 ? Math.min(group.span, stickyOffsets.size) : 0;
                if (frozen > 0) {
                  return [
                    <th key="frozen-band" colSpan={frozen} scope="colgroup" style={{ left: 0 }} className={cx(band, 'z-30 shadow-[1px_0_0_theme(colors.surface.line)]')}>
                      {group.label}
                    </th>,
                    ...(group.span > frozen ? [<th key="band-0" colSpan={group.span - frozen} className={band} aria-hidden />] : []),
                  ];
                }
                return [
                  <th key={`${group.group}-${index}`} colSpan={group.span} scope="colgroup" className={cx(band, 'border-s')}>
                    {group.label}
                  </th>,
                ];
              })}
            </tr>
          )}
          <tr>
            {columns.map((id) => {
              const meta = COLUMNS[id as keyof typeof COLUMNS];
              const sortKey = isSession(id) ? null : meta?.sortKey ?? null;
              const active = sortKey && sort?.key === sortKey;
              const label = labelOf(id, groupLabel, labels);
              return (
                <th
                  key={id}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  style={stickyStyle(id)}
                  className={cx(
                    'sticky z-20 h-9 border-b border-surface-line bg-white px-3 text-start text-[11px] font-bold text-ink-muted',
                    grouped ? 'top-7' : 'top-0',
                    stickyOffsets.has(id) && 'z-30',
                    id === lastSticky && 'shadow-[1px_0_0_theme(colors.surface.line)]',
                    isSession(id) && 'text-center font-mono'
                  )}
                >
                  {sortKey ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(sortKey)}
                      className="-mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
                    >
                      <bdi dir="auto" className="truncate">{label}</bdi>
                      {active && (sort!.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  ) : (
                    <bdi dir="auto" className="block truncate">{label}</bdi>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {windowed && first > 0 && (
            <tr aria-hidden style={{ height: first * ROW_HEIGHT }}>
              <td colSpan={columns.length} />
            </tr>
          )}
          {visible.map((row) => (
            <tr
              key={row.id}
              tabIndex={0}
              onClick={() => onOpen(row.id)}
              onKeyDown={(event) => onRowKey(event, row.id)}
              aria-label={`${row.courseName}${row.courseCode ? ` ${row.courseCode}` : ''} — open details`}
              className="group cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-400"
              style={{ height: ROW_HEIGHT }}
            >
              {columns.map((id) => (
                <td
                  key={id}
                  style={stickyStyle(id)}
                  className={cx(
                    'overflow-hidden border-b border-surface-line/70 bg-white px-3 align-middle transition-colors group-hover:bg-surface-bg',
                    stickyOffsets.has(id) && 'z-10',
                    id === lastSticky && 'shadow-[1px_0_0_theme(colors.surface.line)]',
                    isSession(id) && 'px-1.5'
                  )}
                >
                  {renderCell(id, row, { now, coordinatorKnown })}
                </td>
              ))}
            </tr>
          ))}
          {windowed && last < rows.length && (
            <tr aria-hidden style={{ height: (rows.length - last) * ROW_HEIGHT }}>
              <td colSpan={columns.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** The grid's shape while the first answer is on its way — never a flash of "no courses". */
export function ScheduleTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-surface-line bg-white shadow-card" aria-busy="true" aria-label="Loading schedule">
      <div className="h-7 border-b border-surface-line bg-surface-bg" />
      <div className="flex h-9 items-center gap-4 border-b border-surface-line px-3">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="skeleton h-2.5 w-20 rounded" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex h-[50px] items-center gap-4 border-b border-surface-line/70 px-3">
          <div className="skeleton h-3 w-32 rounded" />
          <div className="skeleton h-3 w-48 rounded" />
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-3 w-16 rounded" />
          <div className="skeleton hidden h-3 w-20 rounded md:block" />
          <div className="skeleton hidden h-3 w-24 rounded lg:block" />
        </div>
      ))}
    </div>
  );
}
