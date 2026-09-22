/**
 * Sessions as a timeline, which is what they are.
 *
 * The workbook spread S1…S40 across forty columns and made the reader scroll
 * sideways to find today. A course's lectures are a sequence in time, so they
 * are drawn as one: past, today, upcoming, down the page. Long courses collapse
 * to a summary line and open on request, so a forty-lecture Civil course costs
 * the same screen as a four-lecture one until somebody asks.
 */

import { useState } from 'react';
import { Check, Circle, Dot, Video } from 'lucide-react';
import { sessionState } from '@shared/eventsSchedule';
import { ksaShortDate, ksaTime, type TrainingSession } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';

const STATE_STYLE = {
  past: { ring: 'bg-surface-sunken text-ink-faint', label: 'خلصت' },
  today: { ring: 'bg-brand-500 text-white', label: 'النهاردة' },
  upcoming: { ring: 'bg-white text-ink-faint ring-1 ring-inset ring-surface-line', label: 'جاية' },
  missing: { ring: 'bg-surface-sunken text-ink-faint', label: 'من غير تاريخ' },
} as const;

function Marker({ state }: { state: keyof typeof STATE_STYLE }) {
  const icon =
    state === 'past' ? <Check size={12} strokeWidth={3} /> :
    state === 'today' ? <Dot size={16} strokeWidth={4} /> :
    state === 'missing' ? <span aria-hidden>—</span> :
    <Circle size={7} strokeWidth={3} />;
  return (
    <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full', STATE_STYLE[state].ring)} aria-hidden>
      {icon}
    </span>
  );
}

function Row({ session, now }: { session: TrainingSession; now: Date }) {
  const state = sessionState(session, now) as keyof typeof STATE_STYLE;
  const today = state === 'today';
  return (
    <li
      className={cx(
        'flex items-center gap-3 rounded-xl px-2.5 py-2',
        today ? 'bg-brand-50/70 ring-1 ring-inset ring-brand-100' : 'hover:bg-surface-bg'
      )}
    >
      <Marker state={state} />
      <span className="w-10 shrink-0 font-mono text-[12px] font-bold text-ink">S{session.number}</span>
      <span className="min-w-0 flex-1 text-[12.5px] text-ink-muted">
        {session.startsAt ? (
          <>
            <span className={cx('font-semibold', today ? 'text-brand-700' : 'text-ink')}>
              {today ? 'النهاردة' : ksaShortDate(session.startsAt)}
            </span>
            <span className="mx-1.5 text-ink-faint">·</span>
            <span className="tabular-nums">{ksaTime(session.startsAt)}</span>
            {session.durationHours ? <span className="text-ink-faint"> · {session.durationHours}h</span> : null}
          </>
        ) : (
          <span className="text-ink-faint">لسه من غير ميعاد</span>
        )}
      </span>
      <span className="sr-only">{STATE_STYLE[state].label}</span>
      {session.joinUrl && today && (
        <a
          href={session.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-500 px-2 py-1 text-[11.5px] font-semibold text-white hover:bg-brand-600"
        >
          <Video size={12} /> ادخل
        </a>
      )}
    </li>
  );
}

/** How many lectures are shown before the list asks to be opened. */
const PREVIEW = 6;

export function SessionTimeline({
  sessions,
  now = new Date(),
  emptyLabel = 'مفيش محاضرات متولّدة في أودو لحد دلوقتي',
}: {
  sessions: TrainingSession[];
  now?: Date;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  if (sessions.length === 0) {
    return <p className="rounded-xl bg-surface-bg px-3 py-3 text-[12.5px] text-ink-muted">{emptyLabel}</p>;
  }

  const counts = sessions.reduce(
    (acc, session) => {
      const state = sessionState(session, now) as keyof typeof STATE_STYLE;
      acc[state] += 1;
      return acc;
    },
    { past: 0, today: 0, upcoming: 0, missing: 0 }
  );

  // Opening on today keeps the useful part on screen for a running course.
  const todayIndex = sessions.findIndex((session) => sessionState(session, now) === 'today');
  const anchor = todayIndex >= 0 ? todayIndex : counts.past;
  const shown = open ? sessions : sessions.slice(Math.max(0, Math.min(anchor - 1, sessions.length - PREVIEW)), Math.max(PREVIEW, anchor + PREVIEW - 1));
  const hidden = sessions.length - shown.length;

  return (
    <div>
      <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
        <span className="font-semibold text-ink">{counts.past} خلصت</span>
        {counts.today > 0 && (
          <>
            <span className="text-ink-faint">·</span>
            <span className="font-semibold text-brand-600">{counts.today} النهاردة</span>
          </>
        )}
        <span className="text-ink-faint">·</span>
        <span>{counts.upcoming} جاية</span>
        {counts.missing > 0 && (
          <>
            <span className="text-ink-faint">·</span>
            <span className="text-accent-700">{counts.missing} من غير ميعاد</span>
          </>
        )}
      </p>

      <ul className="space-y-0.5">
        {shown.map((session) => (
          <Row key={session.id} session={session} now={now} />
        ))}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-2 w-full rounded-xl border border-surface-line bg-white px-3 py-2 text-[12.5px] font-semibold text-brand-600 transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
        >
          {open ? 'اعرض أقل' : `اعرض كل الـ${sessions.length} محاضرة`}
        </button>
      )}
    </div>
  );
}
