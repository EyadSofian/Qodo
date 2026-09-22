/**
 * One course, readable in about three seconds.
 *
 * Top to bottom in order of how often it is looked for: which department and
 * how it is doing, what the course is, who teaches it, how it is delivered and
 * how full it is, when it runs, and what happens next. Everything else is in
 * the details panel; the rule for adding anything here is whether it is
 * needed every time somebody scans the list.
 *
 * A thin stripe across the top carries the status colour, so a page of cards
 * reads by state before a single word is read.
 */

import { ArrowLeft, MapPin, Video } from 'lucide-react';
import { departmentLabel } from '@shared/eventsSchedule';
import { placeLabel, type TrainingScheduleRow } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { Avatar } from '../ui';
import { CapacityProgress, DateSpan, DaysAndTime, NextSessionBox } from './CourseBits';
import { QualityMark, StatusChip } from './EventStatusBadge';
import { STATUS_TONE, TONE, departmentTone } from './tones';

export const AVATAR_TINT = '#DBEAFE';

export function Person({ name, empty, size = 30 }: { name: string | null; empty: string; size?: number }) {
  if (!name) {
    return <span className="text-[13px] font-medium text-slate-500">{empty}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} size={size} color={AVATAR_TINT} className="shrink-0 ring-2 ring-white" />
      <span dir="auto" className="min-w-0 truncate text-[13.5px] font-bold text-slate-800">
        {name}
      </span>
    </span>
  );
}

export function TypeLine({ row }: { row: TrainingScheduleRow }) {
  const place = row.deliveryMode === 'offline' ? placeLabel(row) : null;
  if (!row.trainingType && !place) return <span className="text-[13px] font-medium text-slate-500">النوع مش متسجّل</span>;
  const online = row.deliveryMode !== 'offline';
  const Icon = online ? Video : MapPin;
  return (
    <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-slate-800">
      <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-lg', online ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600')}>
        <Icon size={14} />
      </span>
      <span className="min-w-0 truncate">
        {row.trainingType}
        {place && <span className="font-medium text-slate-500"> · {place}</span>}
      </span>
    </span>
  );
}

export function DepartmentChip({ department }: { department: string | null }) {
  const label = departmentLabel(department);
  if (!label) return <span />;
  const tone = TONE[departmentTone(department)];
  return (
    <span className={cx('inline-flex items-center gap-1.5 truncate rounded-full border px-2.5 py-1 text-[11.5px] font-bold', tone.soft, tone.border, tone.text)}>
      <span aria-hidden className={cx('h-1.5 w-1.5 rounded-full', tone.dot)} />
      {label}
    </span>
  );
}

export function CourseCard({
  row,
  now,
  selected,
  onOpen,
}: {
  row: TrainingScheduleRow;
  now: Date;
  selected: boolean;
  onOpen: (id: number) => void;
}) {
  const context = [row.courseCode ? `كود ${row.courseCode}` : null, row.package ?? row.section].filter(Boolean).join(' • ');
  const stripe = TONE[row.statusCanonical ? STATUS_TONE[row.statusCanonical] : 'slate'].stripe;

  return (
    <article
      tabIndex={0}
      aria-label={row.courseName}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onOpen(row.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(row.id);
        }
      }}
      className={cx(
        'group relative flex min-w-0 cursor-pointer flex-col gap-4 overflow-hidden rounded-2xl border p-5 pt-6 transition-[border-color,box-shadow,transform,background-color] duration-200',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
        selected
          ? 'border-blue-400 bg-gradient-to-b from-blue-50/70 to-white shadow-[0_0_0_4px_rgba(37,99,235,0.12),0_18px_40px_-12px_rgba(37,99,235,0.35)]'
          : 'border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.12)] hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_20px_40px_-16px_rgba(15,23,42,0.22)]'
      )}
    >
      <span aria-hidden className={cx('absolute inset-x-0 top-0 h-1 bg-gradient-to-l', stripe)} />

      <header className="flex items-center justify-between gap-2">
        <DepartmentChip department={row.department} />
        <span className="flex shrink-0 items-center gap-1.5">
          <QualityMark flags={row.qualityFlags} />
          <StatusChip status={row.statusCanonical} stage={row.status} />
        </span>
      </header>

      <div className="min-w-0">
        <h3 className="flex min-w-0 text-[18px] font-extrabold leading-snug tracking-tight text-slate-900" title={row.courseName}>
          <span dir="auto" className="min-w-0 truncate">
            {row.courseName}
          </span>
        </h3>
        {context && (
          <p className="mt-1 flex min-w-0 text-[12.5px] font-medium text-slate-500">
            <span dir="auto" className="min-w-0 truncate">
              {context}
            </span>
          </p>
        )}
      </div>

      <Person name={row.instructor} empty="مفيش مدرّب متسجّل" />

      <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50/80 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <TypeLine row={row} />
        </div>
        <CapacityProgress count={row.traineeCount} capacity={row.capacity} className="w-[9.5rem] shrink-0" />
      </div>

      <div className="grid gap-2">
        <DateSpan row={row} />
        <DaysAndTime row={row} />
      </div>

      <NextSessionBox row={row} now={now} />

      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-3.5">
        <p className="min-w-0 truncate text-[12.5px] text-slate-500">
          الكوردينيتور:{' '}
          {row.coordinator ? (
            <span dir="auto" className="font-bold text-slate-800">
              {row.coordinator}
            </span>
          ) : (
            <span className="font-semibold text-slate-400">—</span>
          )}
        </p>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row.id);
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-50 px-3.5 py-1.5 text-[12.5px] font-bold text-blue-700 transition-colors hover:bg-blue-600 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          التفاصيل <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
        </button>
      </footer>
    </article>
  );
}

export function CourseCardSkeleton() {
  return (
    <div className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 pt-6 shadow-sm" aria-hidden>
      <span className="absolute inset-x-0 top-0 h-1 bg-slate-200" />
      <div className="flex justify-between">
        <span className="skeleton h-6 w-24 rounded-full" />
        <span className="skeleton h-6 w-20 rounded-full" />
      </div>
      <div className="grid gap-2">
        <span className="skeleton h-5 w-2/3 rounded" />
        <span className="skeleton h-3.5 w-1/3 rounded" />
      </div>
      <div className="flex items-center gap-2">
        <span className="skeleton h-8 w-8 rounded-full" />
        <span className="skeleton h-3.5 w-32 rounded" />
      </div>
      <span className="skeleton h-12 w-full rounded-xl" />
      <span className="skeleton h-3.5 w-3/4 rounded" />
      <span className="skeleton h-[72px] w-full rounded-xl" />
      <span className="skeleton h-4 w-1/2 rounded" />
    </div>
  );
}
