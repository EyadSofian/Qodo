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
  BarChart3,
  BadgeDollarSign,
  BookOpen,
  CheckCircle2,
  CircleSlash2,
  Clock,
  Layers,
  PlayCircle,
  RefreshCw,
  Search,
  Send,
  UserPlus,
  Users,
} from 'lucide-react';
import { errorMessage } from '../lib/api';
import {
  elearningKindLabel,
  fetchElearning,
  fetchElearningAnalytics,
  fetchStatus,
  matches,
  refreshElearning,
  staleLabel,
  type ElearningAnalytics,
  type ElearningCourse,
  type ElearningOverview,
  type AnalyticsRange,
} from '../lib/events';
import { BarList, ChartCard, Meter, StatTile } from '../components/Charts';
import {
  AnalyticsPeriodPicker,
  DEFAULT_ANALYTICS_RANGE,
  DemandRanking,
  TrainingSourceComparison,
  dateRangeLabel,
} from '../components/TrainingAnalytics';
import { EmptyState, Segmented, Spinner, useToast } from '../components/ui';
import { cx } from '../lib/utils';

function formatMoney(value: number, currency: string | null): string {
  if (currency === 'USD') {
    return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD`;
  }
  if (!currency) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${currency}`;
  }
}

function friendlyCourseName(value: string): string {
  // Course names stay exactly as the team wrote them in Odoo; only the
  // internal product code is hidden because it is not useful to managers.
  return value.replace(/^\s*\[[^\]]+\]\s*/, '').replace(/\s+/g, ' ').trim();
}

function changePercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

function movementLabel(value: number | null): string {
  if (value === null) return 'مفيش أيام قبلها نقدر نقارن بيها';
  if (value === 0) return 'زي الأيام اللي قبلها';
  return `${value > 0 ? '↑' : '↓'} ${Math.abs(value).toLocaleString('en-US')}%`;
}

function previousDaysHint(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return 'مفيش مقارنة متاحة';
  if (current === previous) return 'زي الأيام اللي قبلها';
  if (previous === 0) return current > 0 ? 'ظهر بيع جديد' : 'مفيش تغيير';
  const change = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return `${change > 0 ? '↑' : '↓'} ${Math.abs(change).toLocaleString('en-US')}% عن الأيام اللي قبلها`;
}

type Tab = 'courses' | 'analysis';

export function Elearning() {
  const { push } = useToast();
  const [data, setData] = useState<ElearningOverview | null>(null);
  const [problem, setProblem] = useState<{ message: string; missing: string[] } | null>(null);
  const [tab, setTab] = useState<Tab>('analysis');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [analysisVersion, setAnalysisVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const status = await fetchStatus();
      if (!status.configured) {
        setProblem({ message: 'الاتصال بأودو لسه مش متظبط.', missing: status.missing });
        setChecked(true);
        return;
      }
      setProblem(null);
      setChecked(true);
      fetchElearning()
        .then(setData)
        .catch((err) => setProblem({ message: errorMessage(err, 'ar'), missing: [] }));
    } catch (err) {
      setProblem({ message: errorMessage(err, 'ar'), missing: [] });
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      const refreshed = await refreshElearning();
      setData(refreshed);
      setAnalysisVersion((version) => version + 1);
      push(
        refreshed.insightsSync?.directAccepted
          ? 'اتعملت مزامنة مباشرة من أودو وInsights Hub.'
          : 'أودو اتحدّث؛ Insights Hub حافظ على آخر نسخة مالية سليمة.',
        refreshed.insightsSync?.directAccepted ? 'ok' : 'bad'
      );
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
          <h1 className="text-[26px] font-extrabold text-ink">الكورسات</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            الكورسات المسجلة اللي شغالة دلوقتي: إيه اللي اتباع، ومين اشترك، ومين بدأ أو خلّص.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={busy || !data}
          className="btn-ghost btn-sm gap-1.5"
        >
          {busy ? <Spinner size={15} /> : <RefreshCw size={15} />}
          مزامنة مباشرة
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

      {!problem && !checked && (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-40 rounded-2xl" />
          ))}
        </div>
      )}

      {!problem && checked && (
        <>
          <div className="mb-4">
            <Segmented
              value={tab}
              onChange={(value) => setTab(value as Tab)}
              options={[
                { value: 'analysis', label: 'الملخص العام', icon: <BarChart3 size={14} /> },
                { value: 'courses', label: 'كل الكورسات', count: data?.courses.length },
              ]}
            />
          </div>

          {tab === 'courses' && !data && (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton h-40 rounded-2xl" />
              ))}
            </div>
          )}
          {tab === 'courses' && data && (
            <>
              <div className="relative mb-3">
                <Search
                  size={16}
                  className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint"
                />
                <input
                  className="field ps-9"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="دوّر باسم الكورس أو صاحبه…"
                />
              </div>
              <CourseList
                courses={data.courses.filter((course) =>
                  matches(query, course.name, course.owner, course.summary)
                )}
              />
            </>
          )}
          {tab === 'analysis' && <ElearningAnalysis version={analysisVersion} />}
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
        body="لو عندكم كورسات في أودو ومش ظاهرة هنا، غالباً حساب الربط محتاج صلاحية يشوف الكورسات."
      />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {courses.map((course) => (
        <article key={course.id} className="card flex flex-col gap-3 p-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-[14.5px] font-bold leading-snug text-ink" title={course.name}>
                {friendlyCourseName(course.name)}
              </h3>
              <p className="mt-0.5 text-[11.5px] text-ink-faint">
                {elearningKindLabel(course.kind)}
                {course.owner ? ` · ${course.owner}` : ''}
              </p>
            </div>
            {!course.published && (
              <span className="chip shrink-0 bg-surface-sunken text-ink-muted">مسودة</span>
            )}
            {course.free && (
              <span className="chip shrink-0 bg-status-okBg text-status-ok">مجاني</span>
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

function ElearningAnalysis({ version }: { version: number }) {
  const [range, setRange] = useState<AnalyticsRange>(DEFAULT_ANALYTICS_RANGE);
  const [data, setData] = useState<ElearningAnalytics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    fetchElearningAnalytics(range)
      .then((rows) => !cancelled && setData(rows))
      .catch((err) => !cancelled && setError(errorMessage(err, 'ar')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, version]);

  const totals = data?.totals;
  const has = (field: string) => Boolean(data?.available.includes(field));
  const collected = data?.collectedCurrent;
  const collectedPrevious = data?.collectedPrevious;
  const revenueChange =
    collected && collectedPrevious ? changePercent(collected.amount, collectedPrevious.amount) : null;
  const topRevenue = collected?.products[0];

  return (
    <div className="grid gap-4">
      <AnalyticsPeriodPicker
        value={range}
        onApply={setRange}
        loading={loading}
        basis="التحصيل حسب يوم الدفع من Insights Hub، ونشاط التعلم حسب يوم الاشتراك من أودو — كل رقم في جزء منفصل"
      />

      {error && (
        <p className="flex items-center gap-2 rounded-xl bg-status-badBg px-3 py-2.5 text-[13px] font-semibold text-status-bad">
          <AlertCircle size={16} />
          {error}
        </p>
      )}

      {!data && loading && (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-44 rounded-2xl" />
          ))}
        </div>
      )}

      {data?.stale && (
        <p className="mb-3 flex items-center gap-2 rounded-xl bg-status-warnBg px-3.5 py-2.5 text-[12.5px] font-semibold text-accent-600">
          <AlertCircle size={15} />
          أودو مارِدّش دلوقتي — دي آخر أرقام وصلت {staleLabel(data.fetchedAt)}.
        </p>
      )}

      {data && !data.revenueAvailable && (
        <p className="rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          مش قادرين نوصل للفواتير اللي اتدفعت دلوقتي، فمش هنعرض رقم بيع أو فلوس غير مؤكد. نشاط التعلم
          من أودو ما زال ظاهر تحت.
        </p>
      )}

      {data?.revenueStale && (
        <p className="rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          مصدر الفواتير ما ردّش في آخر تحديث؛ رقم الفلوس الظاهر هو آخر رقم صحيح محفوظ.
        </p>
      )}

      {data?.revenueAvailable && collected && collectedPrevious && data.revenueSource && (
        <div className={cx('grid gap-4 transition-opacity', loading && 'opacity-55')}>
          <section className="relative overflow-hidden rounded-2xl bg-navy px-5 py-5 text-white shadow-card">
            <span className="absolute -end-12 -top-14 h-40 w-40 rounded-full border-[28px] border-white/[0.04]" />
            <div className="relative grid gap-4 lg:grid-cols-[1.35fr_1fr] lg:items-end">
              <div>
                <p className="text-[11.5px] font-bold text-brand-200">
                  التحصيل المدفوع · Insights Hub · {dateRangeLabel(data.period.from, data.period.to)}
                </p>
                <h2 className="mt-2 max-w-2xl text-[19px] font-black leading-relaxed sm:text-[22px]">
                  {topRevenue
                    ? <><bdi dir="auto">«{friendlyCourseName(topRevenue.name)}»</bdi> جاب أعلى تحصيل من الكورسات المسجلة في الأيام دي.</>
                    : 'مفيش تحصيل للكورسات المسجلة في الأيام دي.'}
                </h2>
                <p className="mt-2 text-[12.5px] text-white/60">
                  الرقم مطابق لطريقة Insights Hub: فواتير مدفوعة، حسب يوم الدفع، والقيمة USD Paid.
                  الكورسات الحضورية والمجانية مش داخلين.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <LearningQuickFact
                  label="الفلوس زادت ولا قلت؟"
                  value={movementLabel(revenueChange)}
                />
                <LearningQuickFact
                  label="كورسات دخل لها فلوس"
                  value={collected.products.length.toLocaleString('en-US')}
                />
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="الفلوس اللي اتحصلت"
              value={formatMoney(collected.amount, data.currency)}
              hint={previousDaysHint(collected.amount, collectedPrevious.amount)}
              explanation="مجموع USD Paid للكورسات المسجلة المدفوعة خلال الأيام المختارة. الحضوري والمجاني مش محسوبين."
              tone={collected.amount > collectedPrevious.amount ? 'good' : 'plain'}
              icon={<BadgeDollarSign size={17} />}
            />
            <StatTile
              label="فواتير مدفوعة"
              value={collected.invoices}
              hint="كل فاتورة مرة واحدة"
              explanation="عدد الفواتير المختلفة اللي فيها كورس مسجل مدفوع. الفاتورة ممكن يكون جواها أكتر من كورس."
              icon={<CheckCircle2 size={17} />}
            />
            <StatTile
              label="كورسات دخل لها فلوس"
              value={collected.products.length}
              hint="حسب اسم المنتج في الفاتورة"
              explanation="عدد أسماء الكورسات المسجلة اللي ظهر لها مبلغ مدفوع فعلًا في الفترة."
              icon={<BookOpen size={17} />}
            />
          </div>

          <ChartCard
            title="الفلوس اللي اتحصلت من كل كورس"
            hint="كل كورس لوحده؛ الاسم بالإنجليزي زي الفاتورة"
          >
            <RevenueBreakdown
              products={collected.products}
              total={collected.amount}
              currency={data.currency}
              sourceUrl={data.revenueSource.appUrl}
            />
          </ChartCard>

          <details className="group rounded-2xl border border-surface-line bg-white px-4 py-3.5">
            <summary className="cursor-pointer list-none text-[12.5px] font-extrabold text-ink [&::-webkit-details-marker]:hidden">
              الأرقام دي جاية منين؟ <span className="text-brand-600 group-open:hidden">＋</span>
              <span className="hidden text-brand-600 group-open:inline">−</span>
            </summary>
            <div className="mt-2 grid gap-2 text-[11.5px] leading-relaxed text-ink-muted">
              <p>
                التحصيل جاي من{' '}
                <a
                  className="font-bold text-brand-700 underline underline-offset-2"
                  href={data.revenueSource.appUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Insights Hub
                </a>{' '}
                وتحديدًا Paid Invoices، حسب Payment Date، والقيمة USD Paid. بنطابق المنتج مع كتالوج
                الكورسات المسجلة المدفوعة في أودو؛ المجاني والحضوري مستبعدين.
              </p>
              <p>
                شلنا من ملخص البيع «طلبات أودو» و«بيع لوحده أو جوه باقة» لأن تاريخ إنشاء الطلب مش هو تاريخ
                دفع الفاتورة، وكان خلطهم مع Insights Hub بيطلع مقارنة مضللة. أرقام الاشتراك والمشاهدة تحت
                منفصلة لأنها نشاط تعلم، مش مبيعات.
              </p>
              {collected.authority === 'postgres-last-good' && (
                <p className="font-semibold text-accent-600">
                  المزامنة المباشرة ما اتقبلتش، فـ Insights Hub حافظ على آخر نسخة مالية سليمة بدل ما يعرض
                  رقم ناقص أو متغيّر. اضغط «مزامنة مباشرة» للمحاولة تاني.
                </p>
              )}
              {collected.authority === 'odoo-direct' && (
                <p className="font-semibold text-status-ok">
                  التحصيل اتراجع مباشرة من أودو وعدّى فحص اكتمال الفواتير قبل ما يظهر هنا
                  {collected.syncedAt ? ` · آخر مزامنة ${staleLabel(collected.syncedAt)}` : ''}.
                </p>
              )}
              {collected.authority === 'postgres-live' && (
                <p className="font-semibold text-status-ok">
                  بيانات التحصيل متزامنة من Odoo عن طريق n8n إلى PostgreSQL
                  {collected.syncedAt ? ` · آخر مزامنة ${staleLabel(collected.syncedAt)}` : ''}.
                </p>
              )}
            </div>
          </details>
        </div>
      )}

      {data?.revenueAvailable && data.periodAvailable && data.revenueSource && (
        <TrainingSourceComparison
          rows={data.comparison}
          mode="elearning"
          insightsUrl={data.revenueSource.appUrl}
        />
      )}

      {data && !data.periodAvailable && (
        <p className="rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          حساب الربط شايف الكورسات، بس مش شايف مين اشترك وإمتى؛ علشان كده تحليل الإقبال مش متاح دلوقتي.
          ادّي حساب الربط صلاحية مسؤول الكورسات. الأرقام العامة اللي تحت ما زالت صحيحة.
        </p>
      )}

      {data?.periodAvailable && data.current && data.previous && (
        <div className={cx('grid gap-4 transition-opacity', loading && 'opacity-55')}>
          <section className="rounded-2xl border border-brand-100 bg-brand-50/55 px-4 py-3.5">
            <h2 className="text-[15px] font-extrabold text-ink">الناس عملت إيه بعد ما اشتركت؟</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              الجزء ده بيقول مين اشترك، ومين بدأ، ومين خلّص. البيع المؤكد والفلوس موجودين فوق.
              {data.freeActivity && data.freeActivity.courses > 0
                ? ` الكورسات المجانية لوحدها: ${data.freeActivity.enrollments.toLocaleString('en-US')} اشتراك في ${data.freeActivity.courses.toLocaleString('en-US')} كورس مجاني خلال الأيام دي.`
                : ''}
            </p>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="ناس اشتركت"
              value={data.current.enrollments}
              hint={previousDaysHint(data.current.enrollments, data.previous.enrollments)}
              tone={data.current.enrollments > data.previous.enrollments ? 'good' : 'plain'}
              icon={<UserPlus size={17} />}
            />
            <StatTile
              label="دعوات لسه ما اتقبلتش"
              value={data.current.invited}
              hint={previousDaysHint(data.current.invited, data.previous.invited)}
              icon={<Send size={17} />}
            />
            <StatTile
              label="ناس بدأت الكورس"
              value={data.current.started}
              hint={data.current.startRate === null ? 'محدش اشترك' : `${data.current.startRate.toLocaleString('en-US')}% من الناس اللي اشتركت في الأيام دي`}
              icon={<PlayCircle size={17} />}
            />
            <StatTile
              label="ناس خلّصت الكورس"
              value={data.current.completed}
              hint={previousDaysHint(data.current.completed, data.previous.completed)}
              tone={data.current.completed > data.previous.completed ? 'good' : 'plain'}
              icon={<CheckCircle2 size={17} />}
            />
            <StatTile
              label="كورسات عليها حركة"
              value={data.current.activeCourses}
              hint={`${(data.current.courses - data.current.activeCourses).toLocaleString('en-US')} بدون حركة جديدة`}
              icon={<BookOpen size={17} />}
            />
            <StatTile
              label="كورسات من غير حركة"
              value={data.current.noDemand}
              hint={previousDaysHint(data.current.noDemand, data.previous.noDemand)}
              tone={data.current.noDemand > 0 ? 'warn' : 'good'}
              icon={<CircleSlash2 size={17} />}
            />
            <StatTile
              label="نسبة قبول الدعوات"
              value={data.current.conversionRate === null ? '—' : `${data.current.conversionRate.toLocaleString('en-US')}%`}
              hint="كام دعوة اتحولت لاشتراك فعلي"
              icon={<Users size={17} />}
            />
            <StatTile
              label="كورسات مدفوعة"
              value={data.current.courses}
              hint={`${data.current.published.toLocaleString('en-US')} ظاهر للناس`}
              icon={<Layers size={17} />}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="أكتر كورسات عليها حركة" hint="ناس اشتركت أو اتبعت لها دعوة في الأيام دي">
              <DemandRanking
                rows={data.topDemand.map((course) => ({
                  id: course.id,
                  name: friendlyCourseName(course.name),
                  primary: course.enrollments,
                  secondary: course.invited,
                  note: `${course.started.toLocaleString('en-US')} بدأوا · ${course.completed.toLocaleString('en-US')} أكملوا`,
                }))}
                empty="مفيش اشتراكات أو دعوات جديدة"
                primaryLabel="مشترك"
                secondaryLabel="دعوة"
              />
            </ChartCard>

            <ChartCard title="أقل كورسات عليها حركة" hint="الكورسات اللي محدش اشترك فيها بتظهر الأول">
              <DemandRanking
                rows={data.lowDemand.map((course) => ({
                  id: course.id,
                  name: friendlyCourseName(course.name),
                  primary: course.enrollments,
                  secondary: course.invited,
                  note: `${course.members.toLocaleString('en-US')} مشترك في الكورس دلوقتي`,
                }))}
                empty="مفيش كورسات"
                primaryLabel="مشترك"
                secondaryLabel="دعوة"
              />
            </ChartCard>

            <ChartCard title="الاشتراكات شهر بشهر" hint="حسب اليوم اللي الشخص اشترك فيه">
              <DemandRanking
                rows={data.trend.map((point, index) => ({
                  id: index,
                  name: point.label,
                  primary: point.enrollments,
                  secondary: point.invited,
                  note: `${point.completed.toLocaleString('en-US')} أكملوا`,
                }))}
                empty="مفيش اشتراكات شهرية"
                primaryLabel="مشترك"
                secondaryLabel="دعوة"
              />
            </ChartCard>

            <ChartCard title="الناس وصلت لفين في الكورس؟" hint="وضع الناس اللي اشتركت في الأيام دي">
              <BarList
                data={[
                  { label: 'اشتركوا', value: data.current.enrollments },
                  { label: 'بدأوا المحتوى', value: data.current.started },
                  { label: 'أكملوا', value: data.current.completed },
                ]}
              />
            </ChartCard>
          </div>
        </div>
      )}

      {data && totals && (
        <section className="grid gap-3 border-t border-surface-line pt-4">
          <div>
            <h2 className="text-[15px] font-extrabold text-ink">الكورسات الموجودة دلوقتي</h2>
            <p className="text-[11.5px] text-ink-faint">الكورسات الشغالة والظاهرة للناس بس؛ المسودات والكورسات المتوقفة مش محسوبة.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="كورسات شغالة" value={totals.courses} icon={<BookOpen size={17} />} />
            <StatTile label="مشتركين" value={totals.members} icon={<Users size={17} />} />
            <StatTile
              label="خلّصوا الكورس"
              value={totals.completed}
              hint={totals.completionRate === null ? 'النسخة دي مش بتوفّر الرقم' : `${totals.completionRate.toLocaleString('en-US')}% من المشتركين`}
              tone={totals.completionRate !== null && totals.completionRate >= 50 ? 'good' : 'plain'}
              icon={<CheckCircle2 size={17} />}
            />
            <StatTile
              label="عدد الدروس"
              value={totals.lessons}
              hint={totals.hours > 0 ? `${totals.hours} ساعة` : 'درس'}
              icon={<Layers size={17} />}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="أكتر كورسات الناس خلّصتها" hint="بنحسب الكورسات اللي فيها 5 مشتركين أو أكتر">
              <BarList
                data={data.topByCompletion.map((item) => ({ ...item, label: friendlyCourseName(item.label) }))}
                empty="مفيش كورس عليه مشتركين كفاية"
              />
            </ChartCard>
            <ChartCard title="الكورسات اللي فيها دروس أكتر" hint="عدد الدروس جوه كل كورس">
              <BarList
                data={data.biggest.map((item) => ({ ...item, label: friendlyCourseName(item.label) }))}
                empty="مفيش دروس متسجّلة"
              />
            </ChartCard>
          </div>
        </section>
      )}

      {data && !has('members_completed_count') && (
        <p className={cx('rounded-xl bg-status-warnBg px-3.5 py-2.5 text-[12.5px] text-accent-600')}>
          نسخة أودو دي مش بتوفّر عدد اللي خلّصوا الكورس، فنسب الإكمال مش ظاهرة.
        </p>
      )}
    </div>
  );
}

function RevenueBreakdown({
  products,
  total,
  currency,
  sourceUrl,
}: {
  products: NonNullable<ElearningAnalytics['collectedCurrent']>['products'];
  total: number;
  currency: string | null;
  sourceUrl: string;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 px-3.5 py-3">
        <div>
          <p className="text-[11px] font-bold text-ink-muted">كل اللي اتدفع في الأيام دي</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {products.length.toLocaleString('en-US')} كورس دخل لهم فلوس من فواتير مدفوعة
          </p>
        </div>
        <strong className="text-[19px] font-black tabular-nums text-brand-800">
          {formatMoney(total, currency)}
        </strong>
      </div>

      <ol className="grid gap-2">
        {products.map((product, index) => (
          <li
            key={product.key}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border border-surface-line bg-white px-3 py-2.5"
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-surface-sunken text-[11px] font-black text-ink-muted">
              {index + 1}
            </span>
            <div className="min-w-0">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[12.5px] font-bold leading-relaxed text-brand-700 hover:underline"
                title="راجع المنتج في Insights Hub"
              >
                {friendlyCourseName(product.name)}
              </a>
              <p className="text-[10.5px] text-ink-faint">المبلغ اللي اتدفع فعلًا للكورس ده</p>
            </div>
            <strong className="whitespace-nowrap text-[12.5px] font-black tabular-nums text-ink">
              {formatMoney(product.amount, currency)}
            </strong>
          </li>
        ))}
      </ol>

      {products.length === 0 && (
        <p className="rounded-xl bg-surface-sunken px-3 py-6 text-center text-[12px] text-ink-muted">
          مفيش مبلغ مدفوع متسجل لأي كورس في الأيام دي.
        </p>
      )}

      <p className="text-[10.5px] leading-relaxed text-ink-faint">
        ملاحظة: ما بنعرضش عدد فواتير لكل كورس هنا؛ الفاتورة الواحدة ممكن يكون جواها أكتر من كورس، وده كان
        بيخلّي الرقم يتفهم غلط.
      </p>
    </div>
  );
}

function LearningQuickFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 backdrop-blur">
      <p className="text-[10.5px] font-semibold text-white/55">{label}</p>
      <p className="mt-0.5 text-[21px] font-black tabular-nums text-white">{value}</p>
    </div>
  );
}
