/**
 * One course, readable in about three seconds.
 *
 * Top to bottom in order of how often it is looked for: which department and
 * how it is doing, what the course is, who teaches it, how it is delivered and
 * how full it is, when it runs, and what happens next. Everything else is in
 * the details panel; the rule for adding anything here is whether it is
 * needed every time somebody scans the list.
 */

import { ArrowLeft, MapPin, Video } from 'lucide-react';
import { departmentLabel } from '@shared/eventsSchedule';
import { placeLabel, type TrainingScheduleRow } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { Avatar } from '../ui';
import { CapacityProgress, DateSpan, DaysAndTime, NextSessionBox } from './CourseBits';
import { QualityMark, StatusChip } from './EventStatusBadge';

export const AVATAR_TINT = '#D8E9F7';

export function Person({ name, empty, size = 28 }: { name: string | null; empty: string; size?: number }) {
  if (!name) {
    return <span className="text-[13px] text-ink-faint">{empty}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name} size={size} color={AVATAR_TINT} className="shrink-0" />
      <bdi dir="auto" className="min-w-0 truncate text-[13.5px] font-semibold text-ink">
        {name}
      </bdi>
    </span>
  );
}

export function TypeLine({ row }: { row: TrainingScheduleRow }) {
  const place = row.deliveryMode === 'offline' ? placeLabel(row) : null;
  if (!row.trainingType && !place) return <span className="text-[13px] text-ink-faint">النوع مش متسجّل</span>;
  const Icon = row.deliveryMode === 'offline' ? MapPin : Video;
  return (
    <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink">
      <Icon size={15} className="shrink-0 text-ink-faint" />
      <span className="min-w-0 truncate">
        {row.trainingType}
        {place && <span className="text-ink-muted"> · {place}</span>}
      </span>
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
  const department = departmentLabel(row.department);
  const context = [row.courseCode ? `كود ${row.courseCode}` : null, row.package ?? row.section].filter(Boolean).join(' • ');

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
        'group flex min-w-0 cursor-pointer flex-col gap-3.5 overflow-hidden rounded-[14px] border bg-white p-4 transition-[border-color,box-shadow,transform] duration-200',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400',
        selected
          ? 'border-brand-400 shadow-[0_0_0_3px_rgba(29,111,184,0.12)]'
          : 'border-surface-line hover:-translate-y-px hover:border-brand-200 hover:shadow-[0_6px_18px_rgba(11,37,69,0.06)]'
      )}
    >
      <header className="flex items-center justify-between gap-2">
        {department ? (
          <span className="truncate rounded-full bg-surface-sunken px-2.5 py-1 text-[11.5px] font-semibold text-ink-muted">{department}</span>
        ) : (
          <span />
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          <QualityMark flags={row.qualityFlags} />
          <StatusChip status={row.statusCanonical} stage={row.status} />
        </span>
      </header>

      <div className="min-w-0">
        <h3 className="flex min-w-0 text-[17px] font-extrabold leading-snug text-ink" title={row.courseName}>
          <span dir="auto" className="min-w-0 truncate">
            {row.courseName}
          </span>
        </h3>
        {context && (
          <p className="mt-0.5 flex min-w-0 text-[12.5px] text-ink-muted">
            <span dir="auto" className="min-w-0 truncate">
              {context}
            </span>
          </p>
        )}
      </div>

      <Person name={row.instructor} empty="مفيش مدرّب متسجّل" />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 pt-0.5">
          <TypeLine row={row} />
        </div>
        <CapacityProgress count={row.traineeCount} capacity={row.capacity} className="w-[9.5rem] shrink-0" />
      </div>

      <div className="grid gap-1.5">
        <DateSpan row={row} />
        <DaysAndTime row={row} />
      </div>

      <NextSessionBox row={row} now={now} />

      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-surface-line pt-3">
        <p className="min-w-0 truncate text-[12.5px] text-ink-muted">
          الكوردينيتور:{' '}
          {row.coordinator ? (
            <bdi dir="auto" className="font-semibold text-ink">
              {row.coordinator}
            </bdi>
          ) : (
            <span className="text-ink-faint">مش متسجّل</span>
          )}
        </p>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row.id);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-brand-600 transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
        >
          التفاصيل <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
        </button>
      </footer>
    </article>
  );
}

export function CourseCardSkeleton() {
  return (
    <div className="flex flex-col gap-3.5 rounded-[14px] border border-surface-line bg-white p-4" aria-hidden>
      <div className="flex justify-between">
        <span className="skeleton h-6 w-24 rounded-full" />
        <span className="skeleton h-6 w-20 rounded-full" />
      </div>
      <div className="grid gap-2">
        <span className="skeleton h-5 w-2/3 rounded" />
        <span className="skeleton h-3.5 w-1/3 rounded" />
      </div>
      <div className="flex items-center gap-2">
        <span className="skeleton h-7 w-7 rounded-full" />
        <span className="skeleton h-3.5 w-32 rounded" />
      </div>
      <div className="flex justify-between">
        <span className="skeleton h-3.5 w-28 rounded" />
        <span className="skeleton h-3.5 w-24 rounded" />
      </div>
      <span className="skeleton h-3.5 w-3/4 rounded" />
      <span className="skeleton h-[68px] w-full rounded-xl" />
      <span className="skeleton h-4 w-1/2 rounded" />
    </div>
  );
}
