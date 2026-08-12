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
  PackageCheck,
  PlayCircle,
  RefreshCw,
  Search,
  Send,
  ShoppingCart,
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
  dateRangeLabel,
} from '../components/TrainingAnalytics';
import { EmptyState, Segmented, Spinner, useToast } from '../components/ui';
import { cx } from '../lib/utils';

function formatMoney(value: number, currency: string | null): string {
  if (currency === 'USD') {
    return `${value.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} دولار`;
  }
  if (!currency) return value.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
  try {
    return new Intl.NumberFormat('ar-EG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ${currency}`;
  }
}

function friendlyCourseName(value: string): string {
  const name = value.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
  const rules: Array<[RegExp, string]> = [
    [/^CFM Preparation Course$/i, 'كورس التحضير لشهادة CFM'],
    [/^CFM Exam Simulator$/i, 'محاكي امتحان CFM'],
    [/^PMP Exam Simulator \(AR\)$/i, 'محاكي امتحان PMP بالعربي'],
    [/^PMP Exam Simulator \(EN\)$/i, 'محاكي امتحان PMP بالإنجليزي'],
    [/^PMP Preparation Course - 8th Edition$/i, 'كورس التحضير لشهادة PMP – الإصدار الثامن'],
    [/^Management - PRIMAVERA$/i, 'كورس بريمافيرا لإدارة المشروعات'],
    [/^Planning & Control Using Primavera P6$/i, 'التخطيط ومتابعة المشروعات ببرنامج بريمافيرا'],
    [/^Occupational Safety and Health Administration \(OSHA\)$/i, 'السلامة والصحة المهنية (OSHA)'],
    [/^CMRP.*Recorded$/i, 'كورس التحضير لشهادة CMRP – مسجّل'],
    [/^CMRP Exam Simulator$/i, 'محاكي امتحان CMRP'],
    [/^Transportation and Traffic Engineering$/i, 'هندسة النقل والمرور'],
    [/^Interior Design Basics Using SketchUp$/i, 'أساسيات التصميم الداخلي ببرنامج SketchUp'],
    [/^Mechanical Site Execution$/i, 'التنفيذ الميكانيكي في الموقع'],
    [/^Civil Structural Design of Bridges & Tunnels$/i, 'التصميم الإنشائي للكباري والأنفاق'],
    [/^Light Current$/i, 'أنظمة التيار الخفيف'],
    [/^Medical Gas Systems Design$/i, 'تصميم أنظمة الغازات الطبية'],
    [/^AI Tools for Interior Design$/i, 'أدوات الذكاء الاصطناعي للتصميم الداخلي'],
    [/^The Freelance Masterclass$/i, 'كورس العمل الحر'],
  ];
  return rules.find(([pattern]) => pattern.test(name))?.[1] ?? name;
}

function friendlyPackageName(value: string): string {
  return value
    .replace(/Professional Track/gi, 'المتكاملة')
    .replace(/^BIM Architecture/i, 'باقة BIM للعمارة')
    .replace(/^BIM MEP/i, 'باقة BIM للأعمال الكهروميكانيكية')
    .replace(/^BIM Structure/i, 'باقة BIM للإنشاءات')
    .replace(/^BIM Manager/i, 'باقة مدير BIM')
    .replace(/^Electrical Design/i, 'باقة التصميم الكهربائي')
    .replace(/^Mechanical Engineering/i, 'باقة الهندسة الميكانيكية')
    .replace(/^Interior Design/i, 'باقة التصميم الداخلي')
    .replace(/^Infrastructure/i, 'باقة البنية التحتية')
    .replace(/^Road Constructions/i, 'باقة تنفيذ الطرق');
}

function changePercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

function sharePercent(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

function movementLabel(value: number | null): string {
  if (value === null) return 'مفيش أيام قبلها نقدر نقارن بيها';
  if (value === 0) return 'زي الأيام اللي قبلها';
  return `${value > 0 ? '↑' : '↓'} ${Math.abs(value).toLocaleString('ar-EG')}٪`;
}

function previousDaysHint(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return 'مفيش مقارنة متاحة';
  if (current === previous) return 'زي الأيام اللي قبلها';
  if (previous === 0) return current > 0 ? 'ظهر بيع جديد' : 'مفيش تغيير';
  const change = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return `${change > 0 ? '↑' : '↓'} ${Math.abs(change).toLocaleString('ar-EG')}٪ عن الأيام اللي قبلها`;
}

function executiveAssessment(data: ElearningAnalytics) {
  const current = data.commercialCurrent;
  const previous = data.commercialPrevious;
  if (!current || !previous) return null;

  const orderChange = changePercent(current.paidOrders, previous.paidOrders);
  const revenueChange =
    data.collectedCurrent && data.collectedPrevious
      ? changePercent(data.collectedCurrent.amount, data.collectedPrevious.amount)
      : null;
  const soldCoverage = sharePercent(current.coursesWithSales, current.paidCourses);
  const dormantShare = sharePercent(current.noSales, current.paidCourses);
  const packageShare = sharePercent(current.packagesSold, current.purchases);
  const needsAttention =
    (orderChange !== null && orderChange <= -10) ||
    (revenueChange !== null && revenueChange <= -10) ||
    (dormantShare !== null && dormantShare >= 35);
  const improving =
    orderChange !== null &&
    orderChange >= 10 &&
    revenueChange !== null &&
    revenueChange >= 10 &&
    (dormantShare === null || dormantShare < 30);

  const status = needsAttention ? 'attention' : improving ? 'improving' : 'watch';
  const actions = [];
  if (orderChange !== null && orderChange < 0) {
    actions.push(
      `الطلبات قلت ${Math.abs(orderChange).toLocaleString('ar-EG')}٪؛ راجع الإعلانات ومصادر العملاء والكورسات اللي بيعها قل.`
    );
  }
  if (revenueChange !== null && revenueChange < 0) {
    actions.push(
      `راجع الفواتير اللي اتدفعت؛ الفلوس المحصّلة من الكورسات قلت ${Math.abs(revenueChange).toLocaleString('ar-EG')}٪.`
    );
  }
  if (dormantShare !== null && dormantShare >= 30) {
    actions.push(
      `${current.noSales.toLocaleString('ar-EG')} كورس من غير بيع (${dormantShare.toLocaleString('ar-EG')}٪ من الكورسات المعروضة): حدّد اللي يحتاج إعلان أو عرض أو إيقاف.`
    );
  }
  if (packageShare !== null && packageShare < 10) {
    actions.push(
      `الباقات عملت ${packageShare.toLocaleString('ar-EG')}٪ بس من البيع؛ راجع سعر الباقة وطريقة عرضها للعميل.`
    );
  }
  actions.push('حطّ هدف شهري واضح للفلوس والطلبات؛ من غير هدف نقدر نقول الأرقام طلعت أو نزلت، لكن مش نقدر نقول الخطة اتحققت.');

  return {
    status,
    title:
      status === 'attention'
        ? 'النتيجة أضعف من الأيام اللي قبلها ومحتاجة تدخل.'
        : status === 'improving'
          ? 'النتيجة أحسن من الأيام اللي قبلها.'
          : 'النتيجة قريبة من الأيام اللي قبلها ومحتاجة متابعة.',
    orderChange,
    revenueChange,
    soldCoverage,
    dormantShare,
    packageShare,
    actions,
  };
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
      setData(await refreshElearning());
      setAnalysisVersion((version) => version + 1);
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
  const executive = data ? executiveAssessment(data) : null;

  return (
    <div className="grid gap-4">
      <AnalyticsPeriodPicker
        value={range}
        onApply={setRange}
        loading={loading}
        basis="الفلوس حسب يوم الدفع، والطلبات حسب يوم عمل الطلب، ونشاط الكورسات حسب يوم الاشتراك"
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

      {data && !data.salesAvailable && (
        <p className="rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          أرقام البيع مش متاحة بصلاحيات الربط الحالية. نشاط الكورسات ما زال ظاهر، لكن الاشتراك لوحده مش
          معناه إن العميل دفع.
        </p>
      )}

      {data && !data.revenueAvailable && (
        <p className="rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          مش قادرين نوصل للفواتير اللي اتدفعت دلوقتي، فمش هنعرض رقم فلوس غير مؤكد. أعداد الطلبات والبيع
          ما زالت ظاهرة من أودو.
        </p>
      )}

      {data?.revenueStale && (
        <p className="rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          مصدر الفواتير ما ردّش في آخر تحديث؛ رقم الفلوس الظاهر هو آخر رقم صحيح محفوظ.
        </p>
      )}

      {data?.salesAvailable && data.commercialCurrent && data.commercialPrevious && (
        <div className={cx('grid gap-4 transition-opacity', loading && 'opacity-55')}>
          <section className="relative overflow-hidden rounded-2xl bg-navy px-5 py-5 text-white shadow-card">
            <span className="absolute -end-12 -top-14 h-40 w-40 rounded-full border-[28px] border-white/[0.04]" />
            <div className="relative grid gap-4 lg:grid-cols-[1.35fr_1fr] lg:items-end">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11.5px] font-bold text-brand-200">
                    قراءة الإدارة · {dateRangeLabel(data.period.from, data.period.to)}
                  </p>
                  {executive && (
                    <span
                      className={cx(
                        'rounded-full px-2.5 py-1 text-[10.5px] font-black',
                        executive.status === 'attention' && 'bg-accent-500 text-white',
                        executive.status === 'improving' && 'bg-status-ok text-white',
                        executive.status === 'watch' && 'bg-white/10 text-white/80'
                      )}
                    >
                      {executive.status === 'attention'
                        ? 'يحتاج تدخل'
                        : executive.status === 'improving'
                          ? 'يتحسن'
                          : 'تحت المتابعة'}
                    </span>
                  )}
                </div>
                <h2 className="mt-2 max-w-2xl text-[19px] font-black leading-relaxed sm:text-[22px]">
                  {executive?.title ?? 'لا توجد بيانات كافية لإصدار قراءة إدارية.'}
                </h2>
                <p className="mt-2 text-[12.5px] text-white/60">
                  المقارنة هنا مع نفس عدد الأيام اللي قبلها. علشان نقول الخطة اتحققت أو لأ، لازم الإدارة
                  تحدد هدفًا شهريًا للفلوس وعدد الطلبات.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <LearningQuickFact
                  label="الفلوس زادت ولا قلت؟"
                  value={movementLabel(executive?.revenueChange ?? null)}
                />
                <LearningQuickFact
                  label="الطلبات زادت ولا قلت؟"
                  value={movementLabel(executive?.orderChange ?? null)}
                />
              </div>
            </div>
          </section>

          {executive && (
            <section className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-[15px] font-black text-ink">الخلاصة للإدارة</h3>
                  <p className="mt-1 text-[11.5px] text-ink-muted">
                    بنقول «يحتاج تدخل» لو الأرقام نزلت ١٠٪ أو أكتر، أو لو ٣٥٪ من الكورسات ما عليهاش بيع.
                  </p>
                </div>
                <span className="chip bg-white text-ink-muted">مقارنة بنفس عدد الأيام اللي قبلها</span>
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                <ManagementSignal
                  label="الطلبات المؤكدة"
                  value={data.commercialCurrent.paidOrders.toLocaleString('ar-EG')}
                  detail={`${movementLabel(executive.orderChange)} مقارنة بالأيام اللي قبلها`}
                  tone={
                    executive.orderChange === null
                      ? 'plain'
                      : executive.orderChange < 0
                        ? 'warn'
                        : 'good'
                  }
                />
                <ManagementSignal
                  label="الفلوس اللي اتحصلت"
                  value={
                    data.collectedCurrent
                      ? formatMoney(data.collectedCurrent.amount, data.currency)
                      : 'غير متاح'
                  }
                  detail={`${movementLabel(executive.revenueChange)} مقارنة بالأيام اللي قبلها`}
                  tone={
                    executive.revenueChange === null
                      ? 'plain'
                      : executive.revenueChange < 0
                        ? 'warn'
                        : 'good'
                  }
                />
                <ManagementSignal
                  label="كام كورس اتباع؟"
                  value={executive.soldCoverage === null ? '—' : `${executive.soldCoverage.toLocaleString('ar-EG')}٪`}
                  detail={`${data.commercialCurrent.coursesWithSales.toLocaleString('ar-EG')} من ${data.commercialCurrent.paidCourses.toLocaleString('ar-EG')} كورس باع مرة على الأقل`}
                  tone={executive.soldCoverage !== null && executive.soldCoverage < 65 ? 'warn' : 'good'}
                />
                <ManagementSignal
                  label="الباقات عملت كام من البيع؟"
                  value={executive.packageShare === null ? '—' : `${executive.packageShare.toLocaleString('ar-EG')}٪`}
                  detail={`${data.commercialCurrent.packagesSold.toLocaleString('ar-EG')} باقات من أصل ${data.commercialCurrent.purchases.toLocaleString('ar-EG')} بيعة`}
                  tone="plain"
                />
              </div>

              <div className="mt-3 rounded-xl border border-white bg-white/80 px-3.5 py-3">
                <p className="text-[12px] font-black text-ink">نعمل إيه دلوقتي؟</p>
                <ol className="mt-2 grid gap-1.5 text-[11.5px] leading-relaxed text-ink-muted lg:grid-cols-2">
                  {executive.actions.map((action, index) => (
                    <li key={action} className="flex gap-2">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand-50 text-[10px] font-black text-brand-700">
                        {index + 1}
                      </span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          )}

          {data.revenueAvailable && data.collectedCurrent && data.revenueSource && (
            <details className="group rounded-2xl border border-surface-line bg-white px-4 py-3.5">
              <summary className="cursor-pointer list-none text-[12.5px] font-extrabold text-ink [&::-webkit-details-marker]:hidden">
                الأرقام دي اتحسبت إزاي؟ <span className="text-brand-600 group-open:hidden">＋</span>
                <span className="hidden text-brand-600 group-open:inline">−</span>
              </summary>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
                رقم الفلوس جاي من{' '}
                <a
                  className="font-bold text-brand-700 underline underline-offset-2"
                  href={data.revenueSource.repository}
                  target="_blank"
                  rel="noreferrer"
                >
                  لوحة الفواتير
                </a>{' '}
                للفواتير اللي اتدفعت فعلًا، حسب يوم الدفع. لو الفاتورة بعملة تانية بنحوّلها لدولار. بنطابق اسم
                الكورس في الفاتورة مع الكورسات المدفوعة الموجودة في منصة الكورسات. الكورس الحضوري والمجاني مش داخلين.
                عدد الطلبات والبيع جاي من أودو حسب يوم عمل الطلب، علشان كده عدد الطلبات مش لازم يساوي عدد
                الفواتير اللي اتدفعت في نفس الأيام.
              </p>
            </details>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.revenueAvailable && data.collectedCurrent && data.collectedPrevious && (
              <StatTile
                label="الفلوس اللي اتحصلت"
                value={formatMoney(data.collectedCurrent.amount, data.currency)}
                hint={previousDaysHint(data.collectedCurrent.amount, data.collectedPrevious.amount)}
                explanation="كل الفلوس اللي اتدفعت فعلًا للكورسات خلال الأيام المختارة، بالدولار. الكورسات الحضورية والمجانية مش محسوبة."
                tone={data.collectedCurrent.amount > data.collectedPrevious.amount ? 'good' : 'plain'}
                icon={<BadgeDollarSign size={17} />}
              />
            )}
            <StatTile
              label="كام حاجة اتباعت؟"
              value={data.commercialCurrent.purchases}
              hint="كورسات اتباعت لوحدها + باقات"
              explanation="كل كورس اتباع لوحده يتحسب مرة، وكل باقة اتباعت تتحسب مرة. الطلب الواحد ممكن يكون فيه أكتر من كورس، علشان كده الرقم ده ممكن يكون أكبر من عدد الطلبات."
              icon={<ShoppingCart size={17} />}
            />
            <StatTile
              label="باقات اتباعت"
              value={data.commercialCurrent.packagesSold}
              explanation="عدد الباقات اللي لقينا كل كورساتها موجودة مع بعض في طلب مؤكد. أي باقة قيمتها صفر مش محسوبة."
              hint={previousDaysHint(
                data.commercialCurrent.packagesSold,
                data.commercialPrevious.packagesSold
              )}
              icon={<PackageCheck size={17} />}
            />
            <StatTile
              label="طلبات مؤكدة"
              value={data.commercialCurrent.paidOrders}
              explanation="عدد الطلبات المؤكدة اللي فيها كورس مدفوع أو باقة. كل طلب يتحسب مرة واحدة حتى لو جواه أكتر من كورس."
              hint={previousDaysHint(
                data.commercialCurrent.paidOrders,
                data.commercialPrevious.paidOrders
              )}
              icon={<CheckCircle2 size={17} />}
            />
            <StatTile
              label="كورسات اتباعت لوحدها"
              value={data.commercialCurrent.directSales}
              hint="بعيدًا عن الباقات"
              explanation="عدد الكورسات المدفوعة اللي اتباعت لوحدها، مش جوه باقة. المجاني وأي سطر قيمته صفر مش محسوبين."
              icon={<BookOpen size={17} />}
            />
            <StatTile
              label="كورسات عليها بيع"
              value={data.commercialCurrent.coursesWithSales}
              hint={`من ${data.commercialCurrent.paidCourses.toLocaleString('ar-EG')} كورس مدفوع`}
              explanation="عدد أنواع الكورسات اللي اتباع منها مرة واحدة على الأقل، سواء لوحدها أو جوه باقة."
              icon={<Layers size={17} />}
            />
            <StatTile
              label="كورسات من غير بيع"
              value={data.commercialCurrent.noSales}
              explanation="كورسات مدفوعة معروضة للبيع، لكن ما اتباعش منها ولا مرة في الأيام المختارة. المجاني مش داخل هنا."
              hint={previousDaysHint(
                data.commercialCurrent.noSales,
                data.commercialPrevious.noSales
              )}
              tone={data.commercialCurrent.noSales > 0 ? 'warn' : 'good'}
              icon={<CircleSlash2 size={17} />}
            />
            <StatTile
              label="كورسات مجانية مش محسوبة"
              value={data.commercialCurrent.freeExcluded}
              hint="لا يدخل في البيع أو المقارنة"
              explanation="عدد الكورسات المجانية. شلناها من حساب البيع ومن مقارنة الأعلى والأقل علشان ما تلخبطش النتيجة."
              icon={<Users size={17} />}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="أكتر كورسات اتباعت" hint="بيع لوحده أو جوه باقة">
              <DemandRanking
                rows={data.topPaidCourses.map((course) => ({
                  id: course.id,
                  name: friendlyCourseName(course.name),
                  primary: course.directSales,
                  secondary: course.packageSales,
                  note: `${course.directOrders.toLocaleString('ar-EG')} طلب فيه بيع لوحده${
                    course.packageOrders
                      ? ` · ${course.packageOrders.toLocaleString('ar-EG')} طلب فيه باقة`
                      : ''
                  }${course.packages.length ? ` · جوه ${course.packages.map(friendlyPackageName).join('، ')}` : ''}`,
                }))}
                empty="مافيش بيع مدفوع في الأيام دي"
                primaryLabel="اتباع لوحده"
                secondaryLabel="جوه باقة"
              />
            </ChartCard>

            <ChartCard title="الباقات اللي اتباعت" hint="الحالية مقارنة بنفس عدد الأيام اللي قبلها">
              <DemandRanking
                rows={data.packageSales.map((item) => ({
                  id: item.id,
                  name: friendlyPackageName(item.name),
                  primary: item.sales,
                  secondary: item.previousSales,
                  note: `${item.componentCount.toLocaleString('ar-EG')} كورسات مدفوعة جوه الباقة · ${item.orders.toLocaleString('ar-EG')} طلب`,
                }))}
                empty="مافيش باقات اتباعت في الأيام دي"
                primaryLabel="الأيام دي"
                secondaryLabel="اللي قبلها"
              />
            </ChartCard>

            <ChartCard title="كورسات من غير بيع" hint="الكورسات المجانية مش موجودة هنا">
              <NoPaidSales rows={data.noPaidSales} />
            </ChartCard>

            {data.revenueAvailable && data.collectedCurrent && (
              <ChartCard
                title="الفلوس اللي اتحصلت من كل كورس"
                hint="كل كورس لوحده؛ المحاكي مش مدموج مع الكورس المسجّل"
              >
                <RevenueBreakdown
                  products={data.collectedCurrent.products ?? []}
                  total={data.collectedCurrent.amount}
                  currency={data.currency}
                />
              </ChartCard>
            )}
          </div>
        </div>
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
                ? ` الكورسات المجانية لوحدها: ${data.freeActivity.enrollments.toLocaleString('ar-EG')} اشتراك في ${data.freeActivity.courses.toLocaleString('ar-EG')} كورس مجاني خلال الأيام دي.`
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
              hint={data.current.startRate === null ? 'محدش اشترك' : `${data.current.startRate}٪ من الناس اللي اشتركت في الأيام دي`}
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
              hint={`${(data.current.courses - data.current.activeCourses).toLocaleString('ar-EG')} بدون حركة جديدة`}
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
              value={data.current.conversionRate === null ? '—' : `${data.current.conversionRate}٪`}
              hint="كام دعوة اتحولت لاشتراك فعلي"
              icon={<Users size={17} />}
            />
            <StatTile
              label="كورسات مدفوعة"
              value={data.current.courses}
              hint={`${data.current.published.toLocaleString('ar-EG')} ظاهر للناس`}
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
                  note: `${course.started.toLocaleString('ar-EG')} بدأوا · ${course.completed.toLocaleString('ar-EG')} أكملوا`,
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
                  note: `${course.members.toLocaleString('ar-EG')} مشترك في الكورس دلوقتي`,
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
                  note: `${point.completed.toLocaleString('ar-EG')} أكملوا`,
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
              hint={totals.completionRate === null ? 'النسخة دي مش بتوفّر الرقم' : `${totals.completionRate}٪ من المشتركين`}
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
            <ChartCard title="أكتر كورسات الناس خلّصتها" hint="بنحسب الكورسات اللي فيها ٥ مشتركين أو أكتر">
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

function NoPaidSales({ rows }: { rows: ElearningAnalytics['noPaidSales'] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[12.5px] text-status-ok">كل الكورسات المدفوعة اتباع منها في الأيام دي.</p>;
  }
  return (
    <ol className="grid gap-2">
      {rows.map((course, index) => (
        <li
          key={course.templateId}
          className="flex items-center gap-2.5 rounded-xl bg-surface-sunken px-3 py-2"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white text-[11px] font-black text-ink-muted">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 text-[12.5px] font-bold leading-relaxed text-ink" title={course.name}>
            {friendlyCourseName(course.name)}
          </span>
          {!course.published && <span className="chip bg-white text-ink-faint">مسودة</span>}
        </li>
      ))}
    </ol>
  );
}

function RevenueBreakdown({
  products,
  total,
  currency,
}: {
  products: NonNullable<ElearningAnalytics['collectedCurrent']>['products'];
  total: number;
  currency: string | null;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 px-3.5 py-3">
        <div>
          <p className="text-[11px] font-bold text-ink-muted">كل اللي اتدفع في الأيام دي</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {products.length.toLocaleString('ar-EG')} كورس دخل لهم فلوس من فواتير مدفوعة
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
              <p className="text-[12.5px] font-bold leading-relaxed text-ink">
                {friendlyCourseName(product.name)}
              </p>
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

function ManagementSignal({
  label,
  value,
  detail,
  tone = 'plain',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'plain' | 'good' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-surface-line bg-white px-3.5 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] font-bold text-ink-muted">{label}</p>
        <span
          className={cx(
            'h-2.5 w-2.5 rounded-full',
            tone === 'good' && 'bg-status-ok',
            tone === 'warn' && 'bg-accent-500',
            tone === 'plain' && 'bg-brand-400'
          )}
        />
      </div>
      <p className="mt-1 text-[22px] font-black tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{detail}</p>
    </div>
  );
}
