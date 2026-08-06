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
  Search,
  Users,
  Video,
  X,
} from 'lucide-react';
import { errorMessage } from '../lib/api';
import {
  attendeesLabel,
  fetchAnalytics,
  fetchCourse,
  fetchCourses,
  fetchStatus,
  groupByDay,
  kindLabel,
  matches,
  placeLabel,
  progressOf,
  refreshCourses,
  sessionsLeftLabel,
  stageLabel,
  staleLabel,
  shortDate,
  timeOf,
  whenLabel,
  type Course,
  type CourseDetail,
  type CoursesOverview,
  type EventsAnalytics,
} from '../lib/events';
import { BarList, ChartCard, ColumnChart, SplitBar, StatTile } from '../components/Charts';
import { EmptyState, Modal, Segmented, Spinner, useToast } from '../components/ui';
import { cx } from '../lib/utils';

type Lane = 'today' | 'running' | 'upcoming' | 'analysis';

/** A course matches on anything somebody would plausibly remember about it. */
const hits = (query: string) => (course: Course) =>
  matches(query, course.name, course.code, course.instructor, course.branch, course.venue);

export function Events() {
  const { push } = useToast();
  const [data, setData] = useState<CoursesOverview | null>(null);
  const [problem, setProblem] = useState<{ message: string; missing: string[] } | null>(null);
  const [lane, setLane] = useState<Lane>('today');
  const [openId, setOpenId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
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
          <h1 className="text-[26px] font-extrabold text-ink">الإيفينت</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            التدريب اللي بميعاد — محاضرات النهاردة، الكورسات الشغالة، والمدرّبين.
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
                { value: 'analysis', label: 'تحليل' },
              ]}
            />
          </div>

          {/* Not on the analysis tab: there is nothing there to search, and a
              box that does nothing is worse than no box. */}
          {lane !== 'analysis' && (
            <div className="relative mb-3">
              <Search
                size={16}
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                className="field ps-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="دوّر بالاسم أو الكود أو المدرّب…"
              />
            </div>
          )}

          {lane === 'today' && (
            <TodayLane
              sessions={data.today.filter((session) => matches(query, session.eventName, session.name))}
              onOpen={setOpenId}
            />
          )}
          {lane === 'running' && (
            <CourseGrid courses={data.running.filter(hits(query))} onOpen={setOpenId} running />
          )}
          {lane === 'upcoming' && (
            <CourseGrid courses={data.upcoming.filter(hits(query))} onOpen={setOpenId} />
          )}
          {lane === 'analysis' && <EventsAnalysis />}
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
        <li key={session.id} className="card flex items-center gap-3 p-3.5 transition-colors hover:border-brand-300">
          <button
            type="button"
            onClick={() => session.eventId && onOpen(session.eventId)}
            className="flex min-w-0 flex-1 items-center gap-3.5 text-start"
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
          </button>

          <JoinButton session={session} />
          <ChevronLeft size={18} className="shrink-0 text-ink-faint rtl:rotate-180" />
        </li>
      ))}
    </ul>
  );
}

/**
 * The one thing somebody wants from a lecture that is about to start.
 *
 * Absent rather than disabled when there is no link: a greyed-out button
 * invites clicking and explains nothing. When Zoom simply has not been set up
 * for the session yet, that is said out loud, because it is somebody's job
 * rather than a fault.
 */
function JoinButton({ session }: { session: CoursesOverview['today'][number] }) {
  if (session.joinUrl) {
    return (
      <a
        href={session.joinUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="btn-primary btn-sm shrink-0 gap-1.5"
      >
        <Video size={15} />
        ادخل المحاضرة
      </a>
    );
  }
  if (!session.meetingReady) {
    return (
      <span className="shrink-0 rounded-lg bg-status-warnBg px-2.5 py-1.5 text-[11.5px] font-semibold text-accent-600">
        لينك الزووم لسه مااتعملش
      </span>
    );
  }
  return null;
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

/**
 * The analysis tab.
 *
 * Every chart here compares sizes — how many courses sit in each stage, which
 * instructors carry the most — so they are all one hue, darker for more. Giving
 * each bar its own colour would claim the categories differ in kind rather than
 * in size, and would bury whichever bar is actually the point.
 *
 * Loaded only when the tab is opened: it is four `read_group` calls against
 * Odoo and nobody should pay for them to look at today's lectures.
 */
function EventsAnalysis() {
  const [data, setData] = useState<EventsAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchAnalytics()
      .then((rows) => !cancelled && setData(rows))
      .catch((err) => !cancelled && setError(errorMessage(err, 'ar')));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-status-badBg px-3 py-2.5 text-[13px] font-semibold text-status-bad">
        <AlertCircle size={16} />
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton h-56 rounded-2xl" />
        ))}
      </div>
    );
  }

  const fill = data.seats > 0 ? Math.round((data.students / data.seats) * 100) : null;

  return (
    <div className="grid gap-3">
      {data.stale && (
        <p className="mb-3 flex items-center gap-2 rounded-xl bg-status-warnBg px-3.5 py-2.5 text-[12.5px] font-semibold text-accent-600">
          <AlertCircle size={15} />
          أودو مارِدّش دلوقتي — دي آخر أرقام وصلت {staleLabel(data.fetchedAt)}.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="كورسات شغالة" value={data.runningCount} icon={<GraduationCap size={17} />} />
        <StatTile label="طلاب في الكورسات الشغالة" value={data.students} icon={<Users size={17} />} />
        <StatTile
          label="أماكن متاحة"
          value={Math.max(0, data.seats - data.students)}
          hint={data.seats ? `من ${data.seats} مكان` : undefined}
          icon={<CalendarClock size={17} />}
        />
        <StatTile
          label="نسبة الإشغال"
          value={fill === null ? '—' : `${fill}٪`}
          hint={fill === null ? 'مفيش حد أقصى مسجّل' : undefined}
          tone={fill !== null && fill >= 70 ? 'good' : 'plain'}
          icon={<Users size={17} />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="الكورسات حسب المرحلة" hint="كل الكورسات المسجّلة على النظام">
          <BarList
            data={data.byStage.map((row) => ({ ...row, label: stageLabel(row.label) }))}
          />
        </ChartCard>

        <ChartCard
          title="أكتر المدرّبين تحميلاً"
          hint={`عدد الكورسات في آخر ${data.months} شهور`}
        >
          <BarList data={data.byInstructor} />
        </ChartCard>

        <ChartCard title="الكورسات شهر بشهر" hint={`بداية الكورسات في آخر ${data.months} شهور`}>
          <ColumnChart data={data.byMonth} />
        </ChartCard>

        <ChartCard title="أونلاين ولا حضوري" hint={`آخر ${data.months} شهور`}>
          <SplitBar parts={data.byMode} />
        </ChartCard>
      </div>
    </div>
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
                            {past ? (
                              <span className="shrink-0 text-ink-faint">خلصت</span>
                            ) : (
                              session.joinUrl && (
                                <a
                                  href={session.joinUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="shrink-0 font-bold text-brand-600 hover:underline"
                                >
                                  ادخل
                                </a>
                              )
                            )}
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
