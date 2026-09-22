/**
 * The schedule on a phone: one card per course with what fits in a thumb's
 * glance, and a tap for the rest. The forty-column sheet is a desk job; this
 * is for checking a course on the way to one.
 */

import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { hhmmLabel, ksaDate, ksaShortDate, ksaTime, type TrainingScheduleRow } from '../../lib/eventsSchedule';
import { CapacityCell, QualityMark, StatusChip, WorkDaysChips } from './ScheduleCells';

const PAGE = 40;

export function ScheduleMobileList({ rows, onOpen }: { rows: TrainingScheduleRow[]; onOpen: (id: number) => void }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2">
        {rows.slice(0, shown).map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpen(row.id)}
              className="card grid w-full gap-2.5 p-3.5 text-start transition-colors hover:border-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
            >
              <span className="flex items-start gap-2" dir="ltr">
                <span className="min-w-0 flex-1">
                  <bdi dir="auto" className="block truncate text-[14px] font-bold text-ink">{row.courseName}</bdi>
                  <span className="block truncate text-[11.5px] text-ink-faint">
                    {[row.courseCode, row.instructor, row.trainingType].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <QualityMark flags={row.qualityFlags} />
                <StatusChip status={row.statusCanonical} stage={row.status} />
              </span>
              <span className="grid grid-cols-2 gap-2 text-[12px] text-ink-muted" dir="ltr">
                <span>
                  <span className="block text-[10.5px] text-ink-faint">Start</span>
                  {row.startsAt ? ksaDate(row.startsAt) : '—'}
                  {row.startTimeKsa && <span className="text-ink-faint"> · {hhmmLabel(row.startTimeKsa)}</span>}
                </span>
                <span>
                  <span className="block text-[10.5px] text-ink-faint">Trainees</span>
                  <CapacityCell count={row.traineeCount} capacity={row.capacity} />
                </span>
                <span>
                  <span className="block text-[10.5px] text-ink-faint">Next session</span>
                  {row.nextSession ? `S${row.nextSession.number} · ${ksaShortDate(row.nextSession.startsAt)} ${ksaTime(row.nextSession.startsAt)}` : '—'}
                </span>
                <span>
                  <span className="block text-[10.5px] text-ink-faint">Work days</span>
                  <WorkDaysChips days={row.workDays} source={row.workDaysSource} />
                </span>
              </span>
              {row.progress !== null && (
                <span className="flex items-center gap-2 text-[11px] text-ink-faint" dir="ltr">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${row.progress}%` }} />
                  </span>
                  {row.sessionsPast}/{row.sessionsTotal}
                  <ChevronLeft size={14} className="rotate-180" aria-hidden />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {rows.length > shown && (
        <button type="button" className="btn-ghost btn-sm justify-self-center" onClick={() => setShown(shown + PAGE)}>
          اعرض {Math.min(PAGE, rows.length - shown)} كمان
        </button>
      )}
    </div>
  );
}
