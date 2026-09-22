/**
 * Today — the one list somebody checks before a lecture starts.
 *
 * Every lecture on today's Cairo calendar, online and in person, in time
 * order. The time leads because it is the thing being looked for; the join
 * button is there only when there is a real link. When Zoom is expected and
 * not created yet, that is said in words — a coordinator's job, not a fault —
 * instead of a greyed-out button that invites clicking and explains nothing.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CalendarClock, ChevronLeft, MapPin, RefreshCw, Video } from 'lucide-react';
import { errorMessage } from '../../lib/api';
import {
  agoLabel,
  cairoDay,
  cairoTime,
  fetchToday,
  ksaTime,
  placeLabel,
  type TodayResponse,
  type TodaySession,
} from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { EmptyState } from '../ui';

export function TodaySessions({ version, onOpen }: { version: number; onOpen: (id: number) => void }) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(() => {
    setError('');
    fetchToday()
      .then(setData)
      .catch((err) => setError(errorMessage(err, 'ar')));
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  // "Now" moves while the tab is open, so a lecture slides from next to done.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (error && !data) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-status-bad/20 bg-status-badBg px-4 py-3 text-[13px] font-semibold text-status-bad">
        <AlertCircle size={16} />
        {error}
        <button type="button" className="btn-ghost btn-sm ms-auto gap-1.5" onClick={load}>
          <RefreshCw size={14} /> جرّب تاني
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-2" aria-busy="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="skeleton h-[76px] rounded-2xl" />
        ))}
      </div>
    );
  }

  const upcoming = data.sessions.filter((session) => sessionEnd(session) >= now.getTime());
  const done = data.sessions.filter((session) => sessionEnd(session) < now.getTime());

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-black text-ink">{cairoDay(`${data.date}T12:00:00Z`)}</h2>
        <p className="text-[12px] text-ink-muted">
          {data.sessions.length.toLocaleString('en-US')} محاضرة النهاردة · {upcoming.length.toLocaleString('en-US')} لسه جاية
        </p>
      </div>

      {data.stale && (
        <p className="flex items-center gap-2 rounded-xl bg-status-warnBg px-3.5 py-2.5 text-[12.5px] font-semibold text-accent-700">
          <AlertCircle size={15} />
          أودو مش متاح دلوقتي — دي آخر مزامنة ناجحة {agoLabel(data.fetchedAt)}.
        </p>
      )}

      {data.sessions.length === 0 ? (
        <EmptyState icon={<CalendarClock size={26} />} title="مفيش محاضرات النهاردة" body="شوف تاب «الجدول» للكورسات الشغالة والجاية." />
      ) : (
        <>
          <SessionList sessions={upcoming} now={now} onOpen={onOpen} />
          {done.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer list-none text-[12.5px] font-bold text-ink-muted [&::-webkit-details-marker]:hidden">
                خلصت النهاردة ({done.length.toLocaleString('en-US')}) <span className="text-brand-600 group-open:hidden">＋</span>
              </summary>
              <div className="mt-2 opacity-70">
                <SessionList sessions={done} now={now} onOpen={onOpen} />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function sessionEnd(session: TodaySession) {
  const start = new Date(session.startsAt).getTime();
  return session.endsAt ? new Date(session.endsAt).getTime() : start + (session.durationHours || 1) * 3_600_000;
}

/**
 * Lectures grouped under the hour they start, so the day reads as a timeline
 * rather than a list of equal rows. The hour is the anchor because that is
 * what somebody is looking for when they open this tab before a lecture.
 */
function SessionList({ sessions, now, onOpen }: { sessions: TodaySession[]; now: Date; onOpen: (id: number) => void }) {
  const hours: Array<{ hour: string; items: TodaySession[] }> = [];
  for (const session of sessions) {
    const hour = ksaTime(session.startsAt);
    const last = hours.at(-1);
    if (last && last.hour === hour) last.items.push(session);
    else hours.push({ hour, items: [session] });
  }

  return (
    <div className="grid gap-4">
      {hours.map(({ hour, items }) => (
        <section key={hour}>
          <h3 className="mb-2 flex items-center gap-3">
            <span dir="ltr" className="shrink-0 text-[13px] font-extrabold tabular-nums text-ink">{hour}</span>
            <span className="text-[10.5px] font-semibold text-ink-faint">KSA</span>
            <span aria-hidden className="h-px flex-1 bg-surface-line" />
          </h3>
          <SessionRows sessions={items} now={now} onOpen={onOpen} />
        </section>
      ))}
    </div>
  );
}

function SessionRows({ sessions, now, onOpen }: { sessions: TodaySession[]; now: Date; onOpen: (id: number) => void }) {
  return (
    <ul className="grid gap-2">
      {sessions.map((session) => {
        const live = new Date(session.startsAt).getTime() <= now.getTime() && sessionEnd(session) >= now.getTime();
        const place = session.event.deliveryMode ? placeLabel({ deliveryMode: session.event.deliveryMode, location: session.event.location ?? { offlineKind: null, branch: null, venue: null } }) : null;
        // Planned lectures win when Odoo has generated fewer: "4 of 12", not "4 of 4".
        const total = Math.max(session.totalSessions ?? 0, session.lectureCount ?? 0) || null;
        return (
          <li
            key={session.id}
            className={cx('card flex items-center gap-3 p-3 transition-colors hover:border-brand-300', live && 'border-brand-300 ring-1 ring-brand-200')}
          >
            <button
              type="button"
              onClick={() => session.event.id && onOpen(session.event.id)}
              className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xl text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
            >
              <span className={cx('grid w-[5.25rem] shrink-0 place-items-center rounded-xl py-2 text-center', live ? 'bg-navy text-white' : 'bg-brand-50')}>
                <span dir="ltr" className={cx('text-[15px] font-extrabold leading-tight tabular-nums', live ? 'text-white' : 'text-brand-700')}>
                  {ksaTime(session.startsAt)}
                </span>
                <span className={cx('text-[10px] font-semibold', live ? 'text-white/70' : 'text-brand-500')}>
                  {live ? 'شغّالة دلوقتي' : `KSA · ${cairoTime(session.startsAt)} القاهرة`}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <bdi dir="auto" className="block truncate text-[14px] font-bold text-ink">
                  {session.event.courseName ?? '—'}
                </bdi>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-ink-muted">
                  {session.number && (
                    <span dir="ltr" className="font-semibold text-ink">
                      Session {session.number}
                      {total ? ` of ${total}` : ''}
                    </span>
                  )}
                  {session.event.instructor && <bdi dir="auto">{session.event.instructor}</bdi>}
                  {place && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={12} className="text-ink-faint" />
                      {place}
                    </span>
                  )}
                  {session.durationHours > 0 && <span dir="ltr">{session.durationHours}h</span>}
                </span>
              </span>
            </button>
            <JoinAction session={session} />
            <ChevronLeft size={18} aria-hidden className="hidden shrink-0 text-ink-faint sm:block" />
          </li>
        );
      })}
    </ul>
  );
}

function JoinAction({ session }: { session: TodaySession }) {
  if (session.joinUrl) {
    return (
      <a href={session.joinUrl} target="_blank" rel="noreferrer noopener" className="btn-primary btn-sm shrink-0 gap-1.5">
        <Video size={15} />
        Join Zoom
      </a>
    );
  }
  if (session.zoomExpected && session.meetingReady !== true) {
    return (
      <span className="shrink-0 rounded-lg bg-status-warnBg px-2.5 py-1.5 text-[11.5px] font-semibold text-accent-700">
        لينك الزووم لسه مااتعملش
      </span>
    );
  }
  return null;
}
