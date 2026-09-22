/**
 * A course's lectures, drawn as what they are: a sequence in time.
 *
 * `SessionPreview` is five tiles around where the course is now, for the
 * overview. `SessionTimeline` is every lecture down the page, for the Sessions
 * tab — forty of them read as easily as four, and nothing scrolls sideways.
 */

import { Check, Video } from 'lucide-react';
import { sessionState } from '@shared/eventsSchedule';
import { ksaDate, ksaShortDate, ksaTime, type TrainingSession } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';

type State = 'past' | 'today' | 'upcoming' | 'missing';
const stateOf = (session: TrainingSession, now: Date) => sessionState(session, now) as State;

const STATE_LABEL: Record<State, string> = {
  past: 'خلصت',
  today: 'النهاردة',
  upcoming: 'جاية',
  missing: 'من غير ميعاد',
};

function Mark({ state, size = 24 }: { state: State; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cx(
        'grid shrink-0 place-items-center rounded-full',
        state === 'past' && 'bg-status-okBg text-status-ok',
        state === 'today' && 'bg-brand-500 text-white',
        state === 'upcoming' && 'bg-white text-ink-faint ring-[1.5px] ring-inset ring-surface-line',
        state === 'missing' && 'bg-surface-sunken text-ink-faint'
      )}
    >
      {state === 'past' ? (
        <Check size={Math.round(size * 0.5)} strokeWidth={3} />
      ) : state === 'today' ? (
        <span className="h-2 w-2 rounded-full bg-white" />
      ) : state === 'upcoming' ? (
        <span className="h-1.5 w-1.5 rounded-full bg-ink-faint/60" />
      ) : (
        <span className="text-[11px]">—</span>
      )}
    </span>
  );
}

export function sessionCounts(sessions: TrainingSession[], now: Date) {
  const counts = { past: 0, today: 0, upcoming: 0, missing: 0 };
  for (const session of sessions) counts[stateOf(session, now)] += 1;
  return counts;
}

/** Five lectures centred on today (or the next one), for the overview. */
export function SessionPreview({
  sessions,
  now,
  onViewAll,
}: {
  sessions: TrainingSession[];
  now: Date;
  onViewAll: () => void;
}) {
  if (sessions.length === 0) return null;
  const todayIndex = sessions.findIndex((session) => stateOf(session, now) === 'today');
  const nextIndex = sessions.findIndex((session) => stateOf(session, now) === 'upcoming');
  const anchor = todayIndex >= 0 ? todayIndex : nextIndex >= 0 ? nextIndex : sessions.length - 1;
  const start = Math.max(0, Math.min(anchor - 2, sessions.length - 5));
  const shown = sessions.slice(start, start + 5);

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h4 className="text-[13px] font-bold text-ink">المحاضرات</h4>
        <button type="button" onClick={onViewAll} className="text-[12.5px] font-semibold text-brand-600 hover:underline">
          اعرض الكل ({sessions.length})
        </button>
      </div>
      <ol className="grid grid-cols-5 gap-2">
        {shown.map((session) => {
          const state = stateOf(session, now);
          return (
            <li
              key={session.id}
              className={cx(
                'flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-center',
                state === 'today' ? 'border-brand-200 bg-brand-50' : 'border-surface-line bg-white'
              )}
            >
              <Mark state={state} size={22} />
              <bdi className="mt-0.5 block font-mono text-[12px] font-bold text-ink">S{session.number}</bdi>
              <span className="w-full truncate text-[11px] text-ink-muted">
                {session.startsAt ? (state === 'today' ? 'النهاردة' : ksaShortDate(session.startsAt)) : '—'}
              </span>
              <span className="w-full truncate text-[11px] tabular-nums text-ink-faint">{session.startsAt ? ksaTime(session.startsAt) : ''}</span>
              <span className="sr-only">{STATE_LABEL[state]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Every lecture, down the page, with a join button on today's. */
export function SessionTimeline({
  sessions,
  now,
  online,
  emptyLabel,
}: {
  sessions: TrainingSession[];
  now: Date;
  online: boolean;
  emptyLabel: string;
}) {
  if (sessions.length === 0) {
    return <p className="rounded-xl bg-surface-bg px-4 py-4 text-[13px] text-ink-muted">{emptyLabel}</p>;
  }
  const counts = sessionCounts(sessions, now);

  return (
    <div>
      <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-muted">
        <span className="font-semibold text-ink">{counts.past} خلصت</span>
        <span className="text-ink-faint">•</span>
        <span className={counts.today ? 'font-semibold text-brand-600' : undefined}>{counts.today} النهاردة</span>
        <span className="text-ink-faint">•</span>
        <span>{counts.upcoming} جاية</span>
        {counts.missing > 0 && (
          <>
            <span className="text-ink-faint">•</span>
            <span className="text-accent-700">{counts.missing} من غير ميعاد</span>
          </>
        )}
      </p>

      <ol className="relative">
        {sessions.map((session, index) => {
          const state = stateOf(session, now);
          const last = index === sessions.length - 1;
          return (
            <li key={session.id} className="relative flex gap-3.5 pb-3">
              {!last && <span aria-hidden className="absolute start-[11px] top-7 h-[calc(100%-1.25rem)] w-px bg-surface-line" />}
              <Mark state={state} />
              <div
                className={cx(
                  'min-w-0 flex-1 rounded-xl px-3 py-2',
                  state === 'today' ? 'bg-brand-50 ring-1 ring-inset ring-brand-100' : state === 'past' ? '' : 'bg-white'
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={cx('text-[13px] font-bold', state === 'past' ? 'text-ink-muted' : 'text-ink')}>
                    <bdi className="font-mono">S{session.number}</bdi>
                    <span className="ms-2 font-semibold">
                      {session.startsAt ? (state === 'today' ? 'النهاردة' : ksaDate(session.startsAt)) : 'لسه من غير ميعاد'}
                    </span>
                  </p>
                  {state === 'today' &&
                    (session.joinUrl ? (
                      <a
                        href={session.joinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-brand-600"
                      >
                        <Video size={13} /> ادخل على زووم
                      </a>
                    ) : online ? (
                      <span className="text-[11.5px] font-semibold text-accent-700">لينك الزووم لسه مااتعملش</span>
                    ) : null)}
                </div>
                {session.startsAt && (
                  <p className="mt-0.5 text-[12px] tabular-nums text-ink-muted">
                    {ksaTime(session.startsAt)}
                    {session.endsAt ? ` – ${ksaTime(session.endsAt)}` : ''}
                    {session.durationHours ? <span className="text-ink-faint"> • {session.durationHours} ساعة</span> : null}
                  </p>
                )}
                <span className="sr-only">{STATE_LABEL[state]}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
