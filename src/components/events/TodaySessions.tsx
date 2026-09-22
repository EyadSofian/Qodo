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
import { Avatar, EmptyState } from '../ui';
import { AVATAR_TINT } from './CourseCard';
import { GLASS } from './tones';

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
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-300/20 bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-700">
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
  const live = upcoming.filter((session) => new Date(session.startsAt).getTime() <= now.getTime()).length;

  return (
    <div className="grid gap-5">
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4 ${GLASS}`}>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/30">
            <CalendarClock size={20} />
          </span>
          <div>
            <p className="text-[12px] font-bold text-slate-500">النهاردة</p>
            <h2 className="text-[19px] font-black text-slate-900">{cairoDay(`${data.date}T12:00:00Z`)}</h2>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[12.5px] font-bold">
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-700 ring-1 ring-inset ring-blue-200">{data.sessions.length} محاضرة</span>
          {live > 0 && <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700 ring-1 ring-inset ring-emerald-200">{live} شغّالة دلوقتي</span>}
          <span className="rounded-full bg-violet-50 px-3 py-1.5 text-violet-700 ring-1 ring-inset ring-violet-200">{upcoming.length - live} لسه جاية</span>
          {done.length > 0 && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-600 ring-1 ring-inset ring-slate-200">{done.length} خلصت</span>}
        </div>
      </div>

      {data.stale && (
        <p className="flex items-center gap-2.5 rounded-2xl border border-amber-300 bg-gradient-to-l from-amber-50 to-orange-50 px-4 py-3 text-[13px] font-bold text-amber-900">
          <AlertCircle size={16} />
          أودو مش متاح دلوقتي — دي آخر مزامنة ناجحة {agoLabel(data.fetchedAt)}.
        </p>
      )}

      {data.sessions.length === 0 ? (
        <div className={`rounded-3xl ${GLASS}`}>
          <EmptyState icon={<CalendarClock size={26} />} title="مفيش محاضرات النهاردة" body="شوف تاب «الكورسات» للكورسات الشغّالة والجاية." />
        </div>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <Timeline sessions={upcoming} now={now} onOpen={onOpen} />
          ) : (
            <p className={`rounded-2xl px-5 py-4 text-[13.5px] font-semibold text-slate-600 ${GLASS}`}>كل محاضرات النهاردة خلصت.</p>
          )}
          {done.length > 0 && (
            <details className="group">
              <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full bg-white px-4 py-2 text-[13px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 [&::-webkit-details-marker]:hidden">
                خلصت النهاردة ({done.length.toLocaleString('en-US')})
                <span className="text-blue-700 group-open:rotate-45">＋</span>
              </summary>
              <div className="mt-4 opacity-80">
                <Timeline sessions={done} now={now} onOpen={onOpen} />
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
 * The day as a timeline: the hour is the big anchor on the rail, the lectures
 * that start then sit beside it. The hour leads because it is what somebody is
 * looking for when they open this tab before a lecture.
 */
function Timeline({ sessions, now, onOpen }: { sessions: TodaySession[]; now: Date; onOpen: (id: number) => void }) {
  const hours: Array<{ hour: string; at: string; items: TodaySession[] }> = [];
  for (const session of sessions) {
    const hour = ksaTime(session.startsAt);
    const last = hours.at(-1);
    if (last && last.hour === hour) last.items.push(session);
    else hours.push({ hour, at: session.startsAt, items: [session] });
  }

  return (
    <ol className="grid">
      {hours.map(({ hour, at, items }, index) => {
        const liveHere = items.some((s) => new Date(s.startsAt).getTime() <= now.getTime() && sessionEnd(s) >= now.getTime());
        return (
          <li key={hour} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
            <div className="pt-3 text-end">
              <p className="text-[19px] font-black leading-none tabular-nums text-slate-900">{hour}</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">السعودية</p>
              <p className="text-[11px] text-slate-400">{cairoTime(at)} القاهرة</p>
            </div>
            <div className={cx('relative border-s-2 ps-5', index === hours.length - 1 ? 'border-transparent pb-0' : 'border-slate-200 pb-5')}>
              <span
                aria-hidden
                className={cx(
                  'absolute -start-[9px] top-4 grid h-4 w-4 place-items-center rounded-full ring-4 ring-slate-100',
                  liveHere ? 'bg-emerald-500' : 'bg-blue-600'
                )}
              >
                {liveHere && <span className="absolute h-4 w-4 animate-ping rounded-full bg-emerald-400 opacity-60" />}
              </span>
              <ul className="grid gap-3">
                {items.map((session) => (
                  <SessionCard key={session.id} session={session} now={now} onOpen={onOpen} />
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SessionCard({ session, now, onOpen }: { session: TodaySession; now: Date; onOpen: (id: number) => void }) {
  const live = new Date(session.startsAt).getTime() <= now.getTime() && sessionEnd(session) >= now.getTime();
  const location = session.event.location ?? { offlineKind: null, branch: null, venue: null };
  const place = session.event.deliveryMode ? placeLabel({ deliveryMode: session.event.deliveryMode, location }) : null;
  const online = session.event.deliveryMode !== 'offline';
  // Planned lectures win when Odoo has generated fewer: "4 of 12", not "4 of 4".
  const total = Math.max(session.totalSessions ?? 0, session.lectureCount ?? 0) || null;

  return (
    <li
      className={cx(
        'relative flex flex-wrap items-center gap-3 overflow-hidden rounded-2xl border bg-white p-4 ps-5 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_28px_-16px_rgba(15,23,42,0.2)] transition-all hover:-translate-y-0.5',
        live ? 'border-emerald-300 ring-4 ring-emerald-100' : 'border-slate-200 hover:border-blue-200'
      )}
    >
      <span aria-hidden className={cx('absolute inset-y-0 start-0 w-1', online ? 'bg-blue-500' : 'bg-orange-500')} />
      <button
        type="button"
        onClick={() => session.event.id && onOpen(session.event.id)}
        className="min-w-0 flex-1 rounded-xl text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span dir="auto" className="min-w-0 truncate text-[15.5px] font-extrabold text-slate-900">
            {session.event.courseName ?? '—'}
          </span>
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11.5px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              شغّالة دلوقتي
            </span>
          )}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] font-medium text-slate-600">
          {session.number && (
            <span className="rounded-full bg-violet-50 px-2.5 py-0.5 font-bold text-violet-700 ring-1 ring-inset ring-violet-200">
              محاضرة <span className="tabular-nums">{session.number}</span>
              {total ? <> من <span className="tabular-nums">{total}</span></> : null}
            </span>
          )}
          {session.event.instructor && (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={session.event.instructor} size={22} color={AVATAR_TINT} />
              <span dir="auto" className="font-bold text-slate-800">
                {session.event.instructor}
              </span>
            </span>
          )}
          {place && (
            <span className="inline-flex items-center gap-1">
              {online ? <Video size={13} className="text-blue-500" /> : <MapPin size={13} className="text-orange-500" />}
              {place}
            </span>
          )}
          {session.durationHours > 0 && <span className="tabular-nums">{session.durationHours} ساعة</span>}
        </span>
      </button>
      <JoinAction session={session} />
      <ChevronLeft size={18} aria-hidden className="hidden shrink-0 text-slate-400 sm:block" />
    </li>
  );
}

function JoinAction({ session }: { session: TodaySession }) {
  if (session.joinUrl) {
    return (
      <a
        href={session.joinUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-[13px] font-bold text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700"
      >
        <Video size={15} />
        ادخل على زووم
      </a>
    );
  }
  if (session.zoomExpected && session.meetingReady !== true) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200">
        <AlertCircle size={14} />
        لينك الزووم لسه مااتعملش
      </span>
    );
  }
  return null;
}
