/**
 * One course, understood in about three seconds.
 *
 * The workbook had fifty columns; a card has the eight things an operations
 * person needs on every pass — who teaches it, how it is delivered, how full
 * it is, when it runs, where it has got to, and what happens next. Everything
 * else is one click away in the drawer. The rule for adding anything here is
 * whether it is needed *every* time the list is scanned; almost nothing is.
 */

import { ArrowLeft, CalendarDays, Clock, MessageSquareText, User, Video } from 'lucide-react';
import { type TrainingScheduleRow, hhmmLabel, ksaShortDate, ksaTime, placeLabel } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { CapacityCell, Missing, QualityMark, StatusChip, WorkDaysChips } from './ScheduleCells';

/** "15 Aug → 12 Sep", or whichever half Odoo knows. */
function DateRange({ row }: { row: TrainingScheduleRow }) {
  if (!row.startsAt && !row.endsAt) return <Missing label="مفيش تواريخ في أودو" />;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {row.startsAt ? ksaShortDate(row.startsAt) : '—'}
      <span className="mx-1 text-ink-faint">→</span>
      {row.endsAt ? ksaShortDate(row.endsAt) : '—'}
    </span>
  );
}

function SessionProgress({ row }: { row: TrainingScheduleRow }) {
  if (row.sessionsTotal === 0) {
    return (
      <p className="text-[12px] text-accent-700">
        {row.lectureCount ? `${row.lectureCount} محاضرة مخطّطة، لسه مش متولّدة في أودو` : 'مفيش محاضرات'}
      </p>
    );
  }
  const ratio = row.sessionsPast / row.sessionsTotal;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-ink">
          {row.sessionsPast} / {row.sessionsTotal}
          <span className="font-normal text-ink-muted"> محاضرة</span>
        </span>
        <span className="text-[11.5px] tabular-nums text-ink-faint">{Math.round(ratio * 100)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <div
          className={cx('h-full rounded-full transition-[width]', ratio >= 1 ? 'bg-status-ok' : 'bg-brand-500')}
          style={{ width: `${Math.max(3, ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** The one thing most likely to be acted on today. */
function NextSession({ row, now }: { row: TrainingScheduleRow; now: Date }) {
  const next = row.nextSession;
  if (!next) return null;
  const isToday = ksaShortDate(next.startsAt) === ksaShortDate(now.toISOString());
  return (
    <div
      className={cx(
        'flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[12px]',
        isToday ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100' : 'bg-surface-bg text-ink-muted'
      )}
    >
      <Clock size={13} className="shrink-0" />
      <span className="min-w-0 truncate">
        <span className="font-semibold">{isToday ? 'النهاردة' : ksaShortDate(next.startsAt)}</span>
        <span className="mx-1.5 text-ink-faint">·</span>
        <span className="tabular-nums">{ksaTime(next.startsAt)}</span>
        <span className="mx-1.5 text-ink-faint">·</span>
        <span>S{next.number} من {row.sessionsTotal}</span>
      </span>
    </div>
  );
}

function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-muted">
      <span className="shrink-0 text-ink-faint">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** "Mechanical • HVAC Package" — context, never a column of its own. */
function Subtitle({ row }: { row: TrainingScheduleRow }) {
  const parts = [row.department, row.package ?? row.section].filter(Boolean) as string[];
  return (
    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-muted">
      {parts.length > 0 && <span className="min-w-0 truncate">{parts.join(' • ')}</span>}
      {parts.length > 0 && row.courseCode && <span className="text-ink-faint">•</span>}
      {row.courseCode && <span className="shrink-0 font-mono text-[11.5px] tracking-tight">{row.courseCode}</span>}
    </p>
  );
}

export function CourseCard({
  row,
  now,
  onOpen,
}: {
  row: TrainingScheduleRow;
  now: Date;
  onOpen: (id: number) => void;
}) {
  const place = placeLabel(row);
  return (
    <article
      onClick={() => onOpen(row.id)}
      className="group flex min-w-0 cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border border-surface-line bg-white p-4 shadow-[0_1px_2px_rgba(11,37,69,0.04)] transition-all hover:border-brand-200 hover:shadow-[0_4px_16px_rgba(11,37,69,0.07)] focus-within:border-brand-300"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold leading-snug text-ink">
            <bdi dir="auto">{row.courseName}</bdi>
          </h3>
          <Subtitle row={row} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <QualityMark flags={row.qualityFlags} />
          <StatusChip status={row.statusCanonical} stage={row.status} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Meta icon={<User size={13} />}>{row.instructor ?? <span className="text-ink-faint">مفيش مدرّب</span>}</Meta>
        {row.trainingType && <Meta icon={<Video size={13} />}>{row.trainingType}</Meta>}
        {place && <Meta icon={<CalendarDays size={13} />}>{place}</Meta>}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-muted">
          <DateRange row={row} />
          <WorkDaysChips days={row.workDays} source={row.workDaysSource} />
          {row.startTimeKsa && (
            <span className="whitespace-nowrap tabular-nums">
              {hhmmLabel(row.startTimeKsa)}
              {row.endTimeKsa ? ` – ${hhmmLabel(row.endTimeKsa)}` : ''}
              <span className="ms-1 text-[11px] font-semibold text-ink-faint">KSA</span>
            </span>
          )}
        </div>
        <CapacityCell count={row.traineeCount} capacity={row.capacity} />
      </div>

      <SessionProgress row={row} />
      <NextSession row={row} now={now} />

      <footer className="flex items-center justify-between gap-3 border-t border-surface-line pt-2.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ink-muted">
          {row.coordinator ? (
            <>
              <span className="shrink-0 text-ink-faint">Coordinator</span>
              <span className="min-w-0 truncate font-medium text-ink">{row.coordinator}</span>
            </>
          ) : row.comments ? (
            <>
              <MessageSquareText size={13} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 truncate">{row.comments}</span>
            </>
          ) : null}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row.id);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-brand-600 transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
        >
          التفاصيل <ArrowLeft size={13} />
        </button>
      </footer>
    </article>
  );
}

/** The same course at operations density — one line, still not a spreadsheet. */
export function CourseListRow({
  row,
  now,
  onOpen,
}: {
  row: TrainingScheduleRow;
  now: Date;
  onOpen: (id: number) => void;
}) {
  const next = row.nextSession;
  const isToday = next ? ksaShortDate(next.startsAt) === ksaShortDate(now.toISOString()) : false;
  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      className="flex w-full items-center gap-4 border-b border-surface-line bg-white px-4 py-3 text-start transition-colors last:border-b-0 hover:bg-brand-50/40 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-400"
    >
      <div className="min-w-0 flex-[2.2]">
        <p className="flex items-center gap-1.5">
          <bdi dir="auto" className="truncate text-[13.5px] font-bold text-ink">{row.courseName}</bdi>
          <QualityMark flags={row.qualityFlags} />
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
          {[row.instructor, row.trainingType].filter(Boolean).join(' • ') || '—'}
        </p>
      </div>

      <div className="hidden min-w-0 flex-1 sm:block">
        <CapacityCell count={row.traineeCount} capacity={row.capacity} compact />
      </div>

      <div className="hidden min-w-0 flex-[1.4] text-[12px] text-ink-muted lg:block">
        <DateRange row={row} />
        <p className="mt-0.5 truncate text-[11px]">
          {row.workDays.join(' · ') || '—'}
          {row.startTimeKsa ? ` · ${hhmmLabel(row.startTimeKsa)} KSA` : ''}
        </p>
      </div>

      <div className="hidden min-w-0 flex-1 text-[12px] md:block">
        {next ? (
          <span className={cx('truncate', isToday ? 'font-semibold text-brand-700' : 'text-ink-muted')}>
            {isToday ? 'النهاردة' : ksaShortDate(next.startsAt)} · {ksaTime(next.startsAt)}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </div>

      <div className="shrink-0">
        <StatusChip status={row.statusCanonical} stage={row.status} />
      </div>
    </button>
  );
}
