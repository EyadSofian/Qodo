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

function Mark({ state, size = 24, inverted }: { state: State; size?: number; inverted?: boolean }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cx(
        'grid shrink-0 place-items-center rounded-full',
        state === 'past' && 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/40',
        state === 'today' && (inverted ? 'bg-white text-blue-700' : 'bg-blue-600 text-white ring-4 ring-blue-100'),
        state === 'upcoming' && 'bg-white text-slate-400 ring-2 ring-inset ring-slate-300',
        state === 'missing' && 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-300'
      )}
    >
      {state === 'past' ? (
        <Check size={Math.round(size * 0.55)} strokeWidth={3} />
      ) : state === 'today' ? (
        <span className={cx('h-2.5 w-2.5 rounded-full', inverted ? 'bg-blue-600' : 'bg-white')} />
      ) : state === 'upcoming' ? (
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
      ) : (
        <span className="text-[12px] font-black">!</span>
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
        <h4 className="text-[14px] font-extrabold text-slate-900">المحاضرات</h4>
        <button type="button" onClick={onViewAll} className="rounded-full bg-blue-50 px-3 py-1 text-[12.5px] font-bold text-blue-700 hover:bg-blue-100">
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
                'flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1 py-3 text-center transition-transform',
                state === 'today' && 'border-blue-600 bg-gradient-to-b from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-600/30',
                state === 'past' && 'border-emerald-200 bg-emerald-50/70',
                state === 'upcoming' && 'border-slate-200 bg-white',
                state === 'missing' && 'border-amber-300 bg-amber-50'
              )}
            >
              <Mark state={state} size={24} inverted={state === 'today'} />
              <bdi className={cx('mt-0.5 block font-mono text-[12.5px] font-black', state === 'today' ? 'text-white' : 'text-slate-900')}>S{session.number}</bdi>
              <span className={cx('w-full truncate text-[11px] font-semibold', state === 'today' ? 'text-blue-50' : 'text-slate-600')}>
                {session.startsAt ? (state === 'today' ? 'النهاردة' : ksaShortDate(session.startsAt)) : 'من غير ميعاد'}
              </span>
              <span className={cx('w-full truncate text-[11px] tabular-nums', state === 'today' ? 'text-blue-100' : 'text-slate-500')}>
                {session.startsAt ? ksaTime(session.startsAt) : ''}
              </span>
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
    return <p className="rounded-xl bg-slate-50 px-4 py-4 text-[13px] text-slate-600">{emptyLabel}</p>;
  }
  const counts = sessionCounts(sessions, now);

  return (
    <div>
      <p className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] font-bold">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 ring-1 ring-inset ring-emerald-200">{counts.past} خلصت</span>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 ring-1 ring-inset ring-blue-200">{counts.today} النهاردة</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 ring-1 ring-inset ring-slate-200">{counts.upcoming} جاية</span>
        {counts.missing > 0 && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800 ring-1 ring-inset ring-amber-300">{counts.missing} من غير ميعاد</span>
        )}
      </p>

      <ol className="relative">
        {sessions.map((session, index) => {
          const state = stateOf(session, now);
          const last = index === sessions.length - 1;
          return (
            <li key={session.id} className="relative flex gap-3.5 pb-3">
              {!last && <span aria-hidden className={cx('absolute start-[11px] top-7 h-[calc(100%-1.25rem)] w-0.5 rounded-full', state === 'past' ? 'bg-emerald-300' : 'bg-slate-200')} />}
              <Mark state={state} />
              <div
                className={cx(
                  'min-w-0 flex-1 rounded-xl border px-3.5 py-2.5',
                  state === 'today' && 'border-blue-300 bg-blue-50 shadow-sm',
                  state === 'past' && 'border-transparent',
                  state === 'upcoming' && 'border-slate-200 bg-white',
                  state === 'missing' && 'border-amber-200 bg-amber-50'
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={cx('text-[13.5px] font-extrabold', state === 'past' ? 'text-slate-500' : 'text-slate-900')}>
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
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[12.5px] font-bold text-white shadow-md shadow-blue-600/30 hover:bg-blue-700"
                      >
                        <Video size={13} /> ادخل على زووم
                      </a>
                    ) : online ? (
                      <span className="text-[11.5px] font-semibold text-amber-800">لينك الزووم لسه مااتعملش</span>
                    ) : null)}
                </div>
                {session.startsAt && (
                  <p className="mt-0.5 text-[12px] tabular-nums text-slate-600">
                    {ksaTime(session.startsAt)}
                    {session.endsAt ? ` – ${ksaTime(session.endsAt)}` : ''}
                    {session.durationHours ? <span className="text-slate-500"> • {session.durationHours} ساعة</span> : null}
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
