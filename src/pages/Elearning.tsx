/**
 * التعلّم الإلكتروني — the self-paced half of Engosoft's training.
 *
 * Kept as its own page rather than a tab on الإيفينت, because they are
 * different things wearing the same word. A lecture has a time and a register;
 * a recorded course has a completion percentage and no time at all. Sharing one
 * table would leave every second column blank whichever row you looked at.
 *
 * The page is honest about what this particular Odoo exposes. Field names differ
 * between a stock install and a customised one, so the reader asks the server
 * what exists and this page hides the tiles it cannot fill instead of drawing
 * zeroes and calling them data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  Layers,
  RefreshCw,
  Users,
} from 'lucide-react';
import { errorMessage } from '../lib/api';
import {
  elearningKindLabel,
  fetchElearning,
  fetchElearningAnalytics,
  fetchStatus,
  refreshElearning,
  type ElearningAnalytics,
  type ElearningCourse,
  type ElearningOverview,
} from '../lib/events';
import { BarList, ChartCard, Meter, SplitBar, StatTile } from '../components/Charts';
import { EmptyState, Segmented, Spinner, useToast } from '../components/ui';
import { cx } from '../lib/utils';

type Tab = 'courses' | 'analysis';

export function Elearning() {
  const { push } = useToast();
  const [data, setData] = useState<ElearningOverview | null>(null);
  const [problem, setProblem] = useState<{ message: string; missing: string[] } | null>(null);
  const [tab, setTab] = useState<Tab>('courses');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const status = await fetchStatus();
      if (!status.configured) {
        setProblem({ message: 'الاتصال بأودو لسه مش متظبط.', missing: status.missing });
        return;
      }
      setProblem(null);
      setData(await fetchElearning());
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
      setData(await refreshElearning());
      push('اتحدّثت من أودو.');
    } catch (err) {
      push(errorMessage(err, 'ar'), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold text-ink">التعلّم الإلكتروني</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            الكورسات المسجّلة اللي الطالب بيتفرج عليها وقت ما يحب — مين مشترك وكام خلّص.
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
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-40 rounded-2xl" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="mb-4">
            <Segmented
              value={tab}
              onChange={(value) => setTab(value as Tab)}
              options={[
                { value: 'courses', label: 'الكورسات', count: data.courses.length },
                { value: 'analysis', label: 'تحليل' },
              ]}
            />
          </div>

          {tab === 'courses' && <CourseList courses={data.courses} />}
          {tab === 'analysis' && <ElearningAnalysis />}
        </>
      )}
    </div>
  );
}

function CourseList({ courses }: { courses: ElearningCourse[] }) {
  if (courses.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={26} />}
        title="مفيش كورسات مسجّلة"
        body="لو عندكم كورسات في أودو ومش ظاهرة هنا، غالباً الحساب مالوش صلاحية قراءة على eLearning."
      />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {courses.map((course) => (
        <article key={course.id} className="card flex flex-col gap-3 p-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[14.5px] font-bold leading-snug text-ink">
                {course.name}
              </h3>
              <p className="mt-0.5 text-[11.5px] text-ink-faint">
                {elearningKindLabel(course.kind)}
                {course.owner ? ` · ${course.owner}` : ''}
              </p>
            </div>
            {!course.published && (
              <span className="chip shrink-0 bg-surface-sunken text-ink-muted">مسودة</span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <Users size={14} className="text-ink-faint" />
              {course.members} مشترك
            </span>
            <span className="flex items-center gap-1.5">
              <Layers size={14} className="text-ink-faint" />
              {course.lessons} درس
            </span>
            {course.hours > 0 && (
              <span className="flex items-center gap-1.5">
                <Clock size={14} className="text-ink-faint" />
                {Math.round(course.hours)} ساعة
              </span>
            )}
          </div>

          {/* Only drawn where enough people enrolled for a percentage to mean
              something — one member who finished is not a 100% completion rate. */}
          {course.completionRate !== null && course.members >= 5 ? (
            <Meter
              value={course.completed}
              max={course.members}
              label={`خلّصوا ${course.completed} من ${course.members}`}
            />
          ) : (
            <p className="text-[11.5px] text-ink-faint">
              {course.members === 0 ? 'لسه محدش اشترك' : 'مشتركين قليلين — النسبة مش معبّرة'}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

function ElearningAnalysis() {
  const [data, setData] = useState<ElearningAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchElearningAnalytics()
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

  const { totals } = data;
  const has = (field: string) => data.available.includes(field);

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="كورسات" value={totals.courses} hint={`${totals.published} منشور`} icon={<BookOpen size={17} />} />
        <StatTile label="مشتركين" value={totals.members} icon={<Users size={17} />} />
        <StatTile
          label="خلّصوا"
          value={totals.completed}
          hint={totals.completionRate === null ? undefined : `${totals.completionRate}٪ من المشتركين`}
          tone={totals.completionRate !== null && totals.completionRate >= 50 ? 'good' : 'plain'}
          icon={<CheckCircle2 size={17} />}
        />
        <StatTile
          label="حجم المحتوى"
          value={totals.lessons}
          hint={totals.hours > 0 ? `${totals.hours} ساعة` : 'درس'}
          icon={<Layers size={17} />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="أكتر الكورسات اشتراكاً" hint="عدد المشتركين">
          <BarList data={data.topByMembers} empty="لسه محدش اشترك في أي كورس" />
        </ChartCard>

        <ChartCard
          title="أعلى نسب الإكمال"
          hint="الكورسات اللي فيها ٥ مشتركين على الأقل — أقل من كده النسبة مش معبّرة"
        >
          <BarList data={data.topByCompletion} empty="مفيش كورس عليه مشتركين كفاية" />
        </ChartCard>

        <ChartCard title="أكبر الكورسات محتوى" hint="عدد الدروس">
          <BarList data={data.biggest} empty="مفيش دروس متسجّلة" />
        </ChartCard>

        <ChartCard title="منشور ولا مسودة">
          <SplitBar
            parts={[
              { label: 'منشور', value: totals.published },
              { label: 'مسودة', value: totals.draft },
            ]}
          />
          {has('channel_type') && data.byKind.length > 0 && (
            <div className="mt-4 border-t border-surface-line pt-3">
              <p className="mb-2 text-[12px] font-semibold text-ink-muted">حسب النوع</p>
              <BarList data={data.byKind} />
            </div>
          )}
        </ChartCard>
      </div>

      {/* Said out loud rather than drawn as zeroes: a chart of a field this Odoo
          does not have is a chart that lies quietly. */}
      {!has('completed_count') && (
        <p className={cx('rounded-xl bg-status-warnBg px-3.5 py-2.5 text-[12.5px] text-accent-600')}>
          نسخة أودو دي مش بتوفّر عدد اللي خلّصوا الكورس، فنسب الإكمال مش ظاهرة.
        </p>
      )}
    </div>
  );
}
