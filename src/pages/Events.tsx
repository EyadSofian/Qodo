/**
 * الكورسات — Engosoft's training, read out of Odoo.
 *
 * The page answers three questions in the order people ask them: what is on
 * today, what is running, and what starts next. Odoo's own kanban answers a
 * fourth question — which records exist — and that is why nobody opens it to
 * find out whether there is a lecture at seven.
 *
 * Everything is read-only on purpose. Courses are run in Odoo; this is the
 * window, not a second steering wheel.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  ChevronLeft,
  Clock,
  GraduationCap,
  MapPin,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { errorMessage } from '../lib/api';
import {
  attendeesLabel,
  fetchCourse,
  fetchCourses,
  fetchStatus,
  groupByDay,
  kindLabel,
  placeLabel,
  progressOf,
  refreshCourses,
  sessionsLeftLabel,
  stageLabel,
  shortDate,
  timeOf,
  whenLabel,
  type Course,
  type CourseDetail,
  type CoursesOverview,
} from '../lib/events';
import { EmptyState, Modal, Segmented, Spinner, useToast } from '../components/ui';
import { cx } from '../lib/utils';

type Lane = 'today' | 'running' | 'upcoming';

export function Events() {
  const { push } = useToast();
  const [data, setData] = useState<CoursesOverview | null>(null);
  const [problem, setProblem] = useState<{ message: string; missing: string[] } | null>(null);
  const [lane, setLane] = useState<Lane>('today');
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const status = await fetchStatus();
      if (!status.configured) {
        setProblem({ message: 'الاتصال بأودو لسه مش متظبط.', missing: status.missing });
        setData(null);
        return;
      }
      setProblem(null);
      setData(await fetchCourses());
    } catch (err) {
      setProblem({ message: errorMessage(err, 'ar'), missing: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      setData(await refreshCourses());
      push('اتحدّثت من أودو.');
    } catch (err) {
      push(errorMessage(err, 'ar'), 'bad');
    } finally {
      setBusy(false);
    }
  };

  // The first lane worth opening on: no point landing on an empty "today".
  useEffect(() => {
    if (data && data.today.length === 0 && data.running.length > 0) setLane('running');
  }, [data]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold text-ink">الكورسات</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            اللي شغال دلوقتي، ومحاضرات النهاردة، ومين المدرّب — جاية من أودو على طول.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={busy || !data}
          className="btn-ghost btn-sm gap-1.5"
        >
          {busy ? <Spinner size={15} /> : <RefreshCw size={15} />}
          تحديث
        </button>
      </header>

      {problem && (
        <div className="rounded-2xl border border-status-warn/30 bg-status-warnBg p-5">
          <p className="flex items-center gap-2 text-[14px] font-bold text-accent-600">
            <AlertCircle size={18} />
            {problem.message}
          </p>
          {problem.missing.length > 0 && (
            <>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                محتاج تضيف المتغيرات دي في إعدادات النشر وتعيد التشغيل:
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {problem.missing.map((name) => (
                  <li
                    key={name}
                    className="rounded-lg bg-white px-2.5 py-1 font-mono text-[12px] font-bold text-ink"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {!problem && !data && (
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="skeleton h-48 rounded-2xl" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="mb-4">
            <Segmented
              value={lane}
              onChange={(value) => setLane(value as Lane)}
              options={[
                { value: 'today', label: 'النهاردة', count: data.today.length },
                { value: 'running', label: 'شغّالة', count: data.running.length },
                { value: 'upcoming', label: 'جاية', count: data.upcoming.length },
              ]}
            />
          </div>

          {lane === 'today' && <TodayLane sessions={data.today} onOpen={setOpenId} />}
          {lane === 'running' && <CourseGrid courses={data.running} onOpen={setOpenId} running />}
          {lane === 'upcoming' && <CourseGrid courses={data.upcoming} onOpen={setOpenId} />}
        </>
      )}

      <CoursePanel id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** The one list somebody checks before leaving the house. */
function TodayLane({
  sessions,
  onOpen,
}: {
  sessions: CoursesOverview['today'];
  onOpen: (id: number) => void;
}) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock size={26} />}
        title="مفيش محاضرات لسه فاضلة النهاردة"
        body="شوف تاب «شغّالة» للكورسات اللي لسه مكمّلة."
      />
    );
  }

  return (
    <ul className="grid gap-2">
      {sessions.map((session) => (
        <li key={session.id}>
          <button
            type="button"
            onClick={() => session.eventId && onOpen(session.eventId)}
            className="card flex w-full items-center gap-3.5 p-3.5 text-start transition-colors hover:border-brand-300"
          >
            {/* The time leads, because that is the only thing being looked for. */}
            <span className="grid w-[4.5rem] shrink-0 place-items-center rounded-xl bg-brand-50 py-2 text-center">
              <span className="text-[15px] font-extrabold leading-tight text-brand-600">
                {timeOf(session.at)}
              </span>
              <span className="text-[10.5px] font-semibold text-brand-500">
                {session.hours ? `${session.hours} ساعات` : ''}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold text-ink">
                {session.eventName}
              </span>
              {session.name && (
                <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">
                  {session.name}
                </span>
              )}
            </span>
            <ChevronLeft size={18} className="shrink-0 text-ink-faint rtl:rotate-180" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function CourseGrid({
  courses,
  onOpen,
  running,
}: {
  courses: Course[];
  onOpen: (id: number) => void;
  running?: boolean;
}) {
  if (courses.length === 0) {
    return (
      <EmptyState
        icon={<GraduationCap size={26} />}
        title={running ? 'مفيش كورسات شغالة دلوقتي' : 'مفيش كورسات جاية مسجلة'}
      />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} onOpen={onOpen} running={running} />
      ))}
    </div>
  );
}

function CourseCard({
  course,
  onOpen,
  running,
}: {
  course: Course;
  onOpen: (id: number) => void;
  running?: boolean;
}) {
  const progress = progressOf(course);

  return (
    <button
      type="button"
      onClick={() => onOpen(course.id)}
      className="card flex flex-col gap-3 p-4 text-start transition-colors hover:border-brand-300"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14.5px] font-bold leading-snug text-ink">{course.name}</h3>
          <p className="mt-0.5 truncate text-[12px] text-ink-faint ltr text-start">{course.code}</p>
        </div>
        {kindLabel(course.kind) && (
          <span className="chip shrink-0 bg-surface-sunken text-ink-muted">
            {kindLabel(course.kind)}
          </span>
        )}
      </div>

      <div className="grid gap-1.5 text-[12.5px] text-ink-muted">
        {course.instructor && (
          <span className="flex items-center gap-1.5 truncate">
            <GraduationCap size={14} className="shrink-0 text-ink-faint" />
            {course.instructor}
          </span>
        )}
        <span className="flex items-center gap-1.5 truncate">
          <MapPin size={14} className="shrink-0 text-ink-faint" />
          {placeLabel(course)}
        </span>
        <span className="flex items-center gap-1.5">
          <Users size={14} className="shrink-0 text-ink-faint" />
          {attendeesLabel(course.attendees)}
        </span>
      </div>

      {running ? (
        <>
          {/* The next lecture is the actionable half of a running course. */}
          <div
            className={cx(
              'flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-bold',
              course.nextSession && whenLabel(course.nextSession.at) === 'النهاردة'
                ? 'bg-status-okBg text-status-ok'
                : 'bg-surface-sunken text-ink-muted'
            )}
          >
            <Clock size={14} className="shrink-0" />
            {course.nextSession
              ? `الجاية ${whenLabel(course.nextSession.at)} ${timeOf(course.nextSession.at)}`
              : 'مفيش محاضرات جاية'}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-[11.5px] font-semibold text-ink-muted">
              <span>{sessionsLeftLabel(course.sessionsLeft)}</span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-[12.5px] font-bold text-ink-muted">
          <CalendarClock size={14} className="shrink-0" />
          يبدأ {whenLabel(course.startsAt)} · {timeOf(course.startsAt)}
        </div>
      )}
    </button>
  );
}

/** The whole schedule, which is the question the card raises but cannot answer. */
function CoursePanel({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    setCourse(null);
    setError('');
    fetchCourse(id)
      .then((data) => !cancelled && setCourse(data))
      .catch((err) => !cancelled && setError(errorMessage(err, 'ar')));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const now = Date.now();

  return (
    <Modal open={id !== null} onClose={onClose} width="lg" title={course?.name ?? 'الكورس'}>
      {error && (
        <p className="flex items-center gap-2 rounded-xl bg-status-badBg px-3 py-2.5 text-[13px] font-semibold text-status-bad">
          <X size={16} />
          {error}
        </p>
      )}

      {!course && !error && (
        <div className="flex items-center justify-center gap-2 py-10 text-ink-muted">
          <Spinner size={18} />
          جارٍ التحميل…
        </div>
      )}

      {course && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Fact label="المدرّب" value={course.instructor ?? '—'} />
            <Fact label="المكان" value={placeLabel(course)} />
            <Fact label="الطلاب" value={attendeesLabel(course.attendees)} />
            <Fact label="المرحلة" value={stageLabel(course.stage)} />
          </div>

          <div className="rounded-xl bg-surface-sunken px-3.5 py-3 text-[13px] text-ink-muted">
            من <b className="text-ink">{shortDate(course.startsAt)}</b> لـ{' '}
            <b className="text-ink">{shortDate(course.endsAt)}</b> · {course.sessionsTotal} محاضرة ·{' '}
            {sessionsLeftLabel(course.sessionsLeft)}
          </div>

          <div>
            <h4 className="mb-2 text-[13px] font-bold text-ink">جدول المحاضرات</h4>
            {course.sessions.length === 0 ? (
              <p className="text-[13px] text-ink-faint">مفيش محاضرات متسجّلة للكورس ده.</p>
            ) : (
              <div className="grid gap-3">
                {groupByDay(course.sessions).map(({ day, sessions }) => (
                  <div key={day}>
                    <p className="mb-1 text-[12px] font-bold text-ink-muted">{day}</p>
                    <ul className="grid gap-1">
                      {sessions.map((session) => {
                        const past = session.at ? new Date(session.at).getTime() < now : false;
                        return (
                          <li
                            key={session.id}
                            className={cx(
                              'flex items-center gap-3 rounded-lg border border-surface-line px-3 py-2 text-[12.5px]',
                              past && 'opacity-55'
                            )}
                          >
                            <span className="w-16 shrink-0 font-bold tabular-nums text-ink">
                              {timeOf(session.at)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-ink-muted">
                              {session.name ?? '—'}
                            </span>
                            {past && <span className="shrink-0 text-ink-faint">خلصت</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-surface-line px-3 py-2.5">
      <p className="text-[11px] font-semibold text-ink-faint">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-bold text-ink">{value}</p>
    </div>
  );
}
