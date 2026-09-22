/**
 * The same course at list density — for somebody going down forty courses at
 * once. Grouped blocks, two lines each, no cell borders: a list, not a sheet.
 */

import { ChevronLeft } from 'lucide-react';
import { departmentLabel } from '@shared/eventsSchedule';
import { hhmmLabel, ksaShortDate, ksaTime, WEEKDAY_AR, type TrainingScheduleRow } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { CapacityProgress, currentOrNext, whenLabel } from './CourseBits';
import { QualityMark, StatusChip } from './EventStatusBadge';

export function CourseListRow({
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
  const pick = currentOrNext(row.sessions, now);
  const days = row.workDays.map((day) => WEEKDAY_AR[day] ?? day).join(' • ');
  const context = [departmentLabel(row.department), row.courseCode].filter(Boolean).join(' • ');

  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      aria-current={selected ? 'true' : undefined}
      className={cx(
        'grid min-h-[96px] w-full items-center gap-x-5 gap-y-2 border-b border-surface-line px-5 py-4 text-start transition-colors last:border-b-0',
        'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_9rem_auto] xl:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_9rem_minmax(0,1.6fr)_minmax(0,1.1fr)_auto]',
        'focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-400',
        selected ? 'bg-brand-50/60' : 'bg-white hover:bg-surface-bg'
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5">
          <bdi dir="auto" className="truncate text-[14.5px] font-bold text-ink">{row.courseName}</bdi>
          <QualityMark flags={row.qualityFlags} />
        </p>
        <p className="mt-1 flex min-w-0 text-[12.5px] text-ink-muted">
          <span dir="auto" className="min-w-0 truncate">
            {context || '—'}
          </span>
        </p>
      </div>

      <div className="hidden min-w-0 md:block">
        <p className="flex min-w-0 text-[13px] font-semibold text-ink">
          {row.instructor ? (
            <span dir="auto" className="min-w-0 truncate">
              {row.instructor}
            </span>
          ) : (
            <span className="font-normal text-ink-faint">مفيش مدرّب</span>
          )}
        </p>
        <p className="mt-1 truncate text-[12.5px] text-ink-muted">{row.trainingType ?? '—'}</p>
      </div>

      <CapacityProgress count={row.traineeCount} capacity={row.capacity} className="hidden md:block" />

      <div className="hidden min-w-0 text-[12.5px] xl:block">
        <p className="truncate text-ink">
          <bdi>{row.startsAt ? ksaShortDate(row.startsAt) : '—'}</bdi>
          <span className="mx-1 text-ink-faint">←</span>
          <bdi>{row.endsAt ? ksaShortDate(row.endsAt) : '—'}</bdi>
        </p>
        <p className="mt-1 truncate text-ink-muted">
          {days || '—'}
          {row.startTimeKsa ? ` • ${hhmmLabel(row.startTimeKsa)}` : ''}
        </p>
      </div>

      <div className="hidden min-w-0 text-[12.5px] xl:block">
        <p className="text-ink-faint">{pick?.live ? 'شغّالة دلوقتي' : 'الجاية'}</p>
        <p className={cx('mt-1 truncate font-semibold', pick && whenLabel(pick.session.startsAt!, now) === 'النهاردة' ? 'text-brand-700' : 'text-ink')}>
          {pick ? `${whenLabel(pick.session.startsAt!, now)} • ${ksaTime(pick.session.startsAt)}` : '—'}
        </p>
      </div>

      <div className="flex items-center gap-2 justify-self-end">
        <StatusChip status={row.statusCanonical} stage={row.status} />
        <ChevronLeft size={16} className="text-ink-faint" aria-hidden />
      </div>
    </button>
  );
}

export function CourseListSkeleton() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-surface-line bg-white" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex min-h-[96px] items-center gap-5 border-b border-surface-line px-5 last:border-b-0">
          <div className="grid flex-[2] gap-2">
            <span className="skeleton h-4 w-2/3 rounded" />
            <span className="skeleton h-3 w-1/3 rounded" />
          </div>
          <div className="hidden flex-[1.3] gap-2 md:grid">
            <span className="skeleton h-3.5 w-1/2 rounded" />
            <span className="skeleton h-3 w-1/3 rounded" />
          </div>
          <span className="skeleton h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}
