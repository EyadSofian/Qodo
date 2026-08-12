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
  comparisonHint,
  dateRangeLabel,
} from '../components/TrainingAnalytics';
import { EmptyState, Segmented, Spinner, useToast } from '../components/ui';
import { cx } from '../lib/utils';

function formatMoney(value: number, currency: string | null): string {
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
            الكورسات المسجلة والمنشورة حاليًا — المبيعات، الاشتراكات، التقدم والإكمال.
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
  const topPaid = data?.topPaidCourses[0];

  return (
    <div className="grid gap-4">
      <AnalyticsPeriodPicker
        value={range}
        onApply={setRange}
        loading={loading}
        basis="الإيراد المحصّل بتاريخ الدفع من Insights Hub، والبيع المؤكد بتاريخ الطلب ونشاط التعلّم من Odoo"
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
          تحليل البيع غير متاح لصلاحيات حساب الربط الحالية. نشاط التعلّم وأرقام كل الوقت ما زالت ظاهرة،
          لكن لا يتم اعتبار التسجيل وحده عملية بيع.
        </p>
      )}

      {data && !data.revenueAvailable && (
        <p className="rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          تعذّر الوصول إلى إيراد الفواتير المدفوعة من Insights Hub، لذلك لن نعرض رقمًا ماليًا بديلًا من
          Odoo أو نفترض عملة. أعداد الطلبات والحجوزات بالأسفل ما زالت متاحة من Odoo.
        </p>
      )}

      {data?.revenueStale && (
        <p className="rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          Insights Hub لم يرد في آخر تحديث؛ الإيراد الظاهر هو آخر نتيجة مالية ناجحة محفوظة.
        </p>
      )}

      {data?.salesAvailable && data.commercialCurrent && data.commercialPrevious && (
        <div className={cx('grid gap-4 transition-opacity', loading && 'opacity-55')}>
          <section className="relative overflow-hidden rounded-2xl bg-navy px-5 py-5 text-white shadow-card">
            <span className="absolute -end-12 -top-14 h-40 w-40 rounded-full border-[28px] border-white/[0.04]" />
            <div className="relative grid gap-4 lg:grid-cols-[1.35fr_1fr] lg:items-end">
              <div>
                <p className="text-[11.5px] font-bold text-brand-200">
                  المبيعات المدفوعة · {dateRangeLabel(data.period.from, data.period.to)}
                </p>
                <h2 className="mt-2 max-w-2xl text-[19px] font-black leading-relaxed sm:text-[22px]">
                  {topPaid ? (
                    <>
                      <bdi dir="auto">«{topPaid.name}»</bdi> الأكثر بيعًا بـ{' '}
                      {topPaid.totalSales.toLocaleString('ar-EG')} مرة مباشرة أو داخل باقة.
                    </>
                  ) : (
                    'لم تُسجّل مبيعات مدفوعة للكورسات في الفترة المختارة.'
                  )}
                </h2>
                <p className="mt-2 text-[12.5px] text-white/60">
                  المجاني وسطور البيع صفر القيمة خارج ترتيب الطلبات. الإيراد المحصّل منفصل ويأتي من الفواتير
                  المدفوعة في Insights Hub للكورسات المسجّلة فقط.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <LearningQuickFact
                  label="إيراد محصّل"
                  value={
                    data.revenueAvailable && data.collectedCurrent
                      ? formatMoney(data.collectedCurrent.amount, data.currency)
                      : 'غير متاح'
                  }
                />
                <LearningQuickFact
                  label="باقات مباعة"
                  value={data.commercialCurrent.packagesSold.toLocaleString('ar-EG')}
                />
              </div>
            </div>
          </section>

          {data.revenueAvailable && data.collectedCurrent && data.revenueSource && (
            <section className="rounded-2xl border border-brand-100 bg-brand-50/55 px-4 py-3.5">
              <h3 className="text-[13px] font-extrabold text-ink">مصدر الإيراد المالي</h3>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
                <a
                  className="font-bold text-brand-700 underline underline-offset-2"
                  href={data.revenueSource.repository}
                  target="_blank"
                  rel="noreferrer"
                >
                  Insights Hub
                </a>{' '}
                · {data.revenueSource.tab} · {data.revenueSource.dateBasis} ·{' '}
                {data.revenueSource.valueBasis}. المعروض بالدولار كما هو من المصدر، ومفلتر على تصنيف{' '}
                <bdi dir="ltr">Recorded</bdi> فقط؛ لا يدخل Event أو Attendance أو الكورسات المجانية.
              </p>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.revenueAvailable && data.collectedCurrent && data.collectedPrevious && (
              <StatTile
                label="إيراد محصّل"
                value={formatMoney(data.collectedCurrent.amount, data.currency)}
                hint={comparisonHint(data.collectedCurrent.amount, data.collectedPrevious.amount)}
                explanation="إجمالي ما تم تحصيله فعليًا بالدولار من الفواتير المدفوعة خلال الفترة، حسب تاريخ الدفع في Insights Hub. يشمل كورسات Recorded فقط، ولا يشمل البيع غير المدفوع أو الإيفينتات أو الحضوري أو المجاني."
                tone={data.collectedCurrent.amount > data.collectedPrevious.amount ? 'good' : 'plain'}
                icon={<BadgeDollarSign size={17} />}
              />
            )}
            <StatTile
              label="مشتريات"
              value={data.commercialCurrent.purchases}
              hint="وحدات كورسات مباشرة + باقات"
              explanation="إجمالي الوحدات المباعة: كل وحدة كورس مدفوع خارج باقة تُحسب واحدة، وكل باقة مكتملة تُحسب واحدة. لذلك الرقم قد يختلف عن عدد الطلبات؛ الطلب الواحد يمكن أن يحتوي أكثر من عملية شراء."
              icon={<ShoppingCart size={17} />}
            />
            <StatTile
              label="باقات مباعة"
              value={data.commercialCurrent.packagesSold}
              explanation="عدد الباقات التي تم التعرف عليها داخل طلبات Odoo المؤكدة عن طريق مطابقة كورسات الطلب مع مكونات الباقة. الباقة ذات القيمة صفر لا تُحسب كبيع مدفوع."
              hint={comparisonHint(
                data.commercialCurrent.packagesSold,
                data.commercialPrevious.packagesSold
              )}
              icon={<PackageCheck size={17} />}
            />
            <StatTile
              label="طلبات بيع مؤكدة"
              value={data.commercialCurrent.paidOrders}
              explanation="عدد طلبات Odoo المختلفة بحالة Sale أو Done التي تحتوي كورسًا مدفوعًا مباشرًا أو باقة مدفوعة واحدة على الأقل خلال الفترة، حسب تاريخ الطلب. الطلب يُحسب مرة واحدة مهما كان عدد الكورسات بداخله."
              hint={comparisonHint(
                data.commercialCurrent.paidOrders,
                data.commercialPrevious.paidOrders
              )}
              icon={<CheckCircle2 size={17} />}
            />
            <StatTile
              label="بيع كورسات مباشر"
              value={data.commercialCurrent.directSales}
              hint="عدد الوحدات المباعة خارج الباقات"
              explanation="عدد وحدات الكورسات المدفوعة التي بيعت منفردة خارج أي باقة مطابقة. هذا عدد بيع وليس إيرادًا، ولا تدخل فيه الكورسات المجانية أو سطور البيع صفر القيمة."
              icon={<BookOpen size={17} />}
            />
            <StatTile
              label="كورسات حققت بيعًا"
              value={data.commercialCurrent.coursesWithSales}
              hint={`من ${data.commercialCurrent.paidCourses.toLocaleString('ar-EG')} كورس قابل للبيع`}
              explanation="عدد الكورسات المدفوعة القابلة للبيع التي ظهر لها بيع واحد على الأقل خلال الفترة، سواء بيعت منفردة أو كجزء من باقة. الكورس يُحسب مرة واحدة مهما تكرر بيعه."
              icon={<Layers size={17} />}
            />
            <StatTile
              label="بلا بيع مدفوع"
              value={data.commercialCurrent.noSales}
              explanation="عدد الكورسات المدفوعة القابلة للبيع التي لم يظهر لها أي بيع مباشر ولا بيع داخل باقة خلال الفترة المختارة. الكورسات المجانية غير موجودة في هذا الرقم."
              hint={comparisonHint(
                data.commercialCurrent.noSales,
                data.commercialPrevious.noSales
              )}
              tone={data.commercialCurrent.noSales > 0 ? 'warn' : 'good'}
              icon={<CircleSlash2 size={17} />}
            />
            <StatTile
              label="مجاني مستبعد"
              value={data.commercialCurrent.freeExcluded}
              hint="لا يدخل في البيع أو المقارنة"
              explanation="عدد الكورسات المعروفة كمجانية، مثل The Freelance Masterclass أو الكورس المتاح للعامة. يتم استبعادها بالكامل من المبيعات المدفوعة وترتيب الأكثر والأقل بيعًا حتى لا تفسد المقارنة."
              icon={<Users size={17} />}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="الكورسات الأكثر بيعًا" hint="المباشر منفصل عن مرات البيع داخل الباقات">
              <DemandRanking
                rows={data.topPaidCourses.map((course) => ({
                  id: course.id,
                  name: course.name,
                  primary: course.directSales,
                  secondary: course.packageSales,
                  note: `${course.directOrders.toLocaleString('ar-EG')} طلب مباشر${
                    course.packageOrders
                      ? ` · ${course.packageOrders.toLocaleString('ar-EG')} طلب باقة`
                      : ''
                  }${course.packages.length ? ` · ضمن ${course.packages.join('، ')}` : ''}`,
                }))}
                empty="لا توجد مبيعات مدفوعة"
                primaryLabel="مباشر"
                secondaryLabel="داخل باقة"
              />
            </ChartCard>

            <ChartCard title="مبيعات الباقات" hint="مطابقة منتجات الطلب بمكونات الباقة في أودو">
              <DemandRanking
                rows={data.packageSales.map((item) => ({
                  id: item.id,
                  name: item.name,
                  primary: item.sales,
                  secondary: item.previousSales,
                  note: `${item.componentCount.toLocaleString('ar-EG')} كورسات مدفوعة · ${item.orders.toLocaleString('ar-EG')} طلب`,
                }))}
                empty="لم تُبع باقات في الفترة"
                primaryLabel="الحالية"
                secondaryLabel="السابقة"
              />
            </ChartCard>

            <ChartCard title="كورسات بلا بيع مدفوع" hint="المجاني غير موجود في هذه القائمة">
              <NoPaidSales rows={data.noPaidSales} />
            </ChartCard>

            {data.revenueAvailable && data.collectedCurrent && (
              <ChartCard
                title="الإيراد المحصّل حسب مجموعة الكورس"
                hint={`${data.collectedCurrent.invoices.toLocaleString('ar-EG')} فاتورة مدفوعة · Recorded فقط`}
              >
                <BarList
                  data={data.collectedCurrent.families.slice(0, 10).map((family) => ({
                    label: family.name,
                    value: family.amount,
                    display: `${formatMoney(family.amount, data.currency)} · ${family.invoices.toLocaleString('ar-EG')} فاتورة`,
                  }))}
                />
              </ChartCard>
            )}
          </div>
        </div>
      )}

      {data && !data.periodAvailable && (
        <p className="rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          حساب أودو يقدر يقرأ الكورسات لكنه لا يقدر يقرأ سجل العضويات، لذلك تحليل الفترة والإقبال غير متاح.
          امنح حساب الربط صلاحية eLearning Officer؛ أرقام كل الوقت بالأسفل ما زالت صحيحة.
        </p>
      )}

      {data?.periodAvailable && data.current && data.previous && (
        <div className={cx('grid gap-4 transition-opacity', loading && 'opacity-55')}>
          <section className="rounded-2xl border border-brand-100 bg-brand-50/55 px-4 py-3.5">
            <h2 className="text-[15px] font-extrabold text-ink">نشاط التعلّم للكورسات المدفوعة</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              العضويات والدعوات هنا لقياس البدء والإكمال بعد التسجيل، وليست بديلًا عن البيع المؤكد بالأعلى.
              {data.freeActivity && data.freeActivity.courses > 0
                ? ` النشاط المجاني منفصل: ${data.freeActivity.enrollments.toLocaleString('ar-EG')} تسجيل في ${data.freeActivity.courses.toLocaleString('ar-EG')} كورس مجاني خلال الفترة.`
                : ''}
            </p>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="اشتراكات جديدة"
              value={data.current.enrollments}
              hint={comparisonHint(data.current.enrollments, data.previous.enrollments)}
              tone={data.current.enrollments > data.previous.enrollments ? 'good' : 'plain'}
              icon={<UserPlus size={17} />}
            />
            <StatTile
              label="دعوات لم تُقبل"
              value={data.current.invited}
              hint={comparisonHint(data.current.invited, data.previous.invited)}
              icon={<Send size={17} />}
            />
            <StatTile
              label="بدأوا التعلّم"
              value={data.current.started}
              hint={data.current.startRate === null ? 'لا توجد اشتراكات' : `${data.current.startRate}٪ من مسجلي الفترة`}
              icon={<PlayCircle size={17} />}
            />
            <StatTile
              label="أكملوا الكورس"
              value={data.current.completed}
              hint={comparisonHint(data.current.completed, data.previous.completed)}
              tone={data.current.completed > data.previous.completed ? 'good' : 'plain'}
              icon={<CheckCircle2 size={17} />}
            />
            <StatTile
              label="كورسات عليها نشاط"
              value={data.current.activeCourses}
              hint={`${(data.current.courses - data.current.activeCourses).toLocaleString('ar-EG')} بدون حركة جديدة`}
              icon={<BookOpen size={17} />}
            />
            <StatTile
              label="بلا نشاط تعلّم"
              value={data.current.noDemand}
              hint={comparisonHint(data.current.noDemand, data.previous.noDemand)}
              tone={data.current.noDemand > 0 ? 'warn' : 'good'}
              icon={<CircleSlash2 size={17} />}
            />
            <StatTile
              label="تحويل الدعوات لاشتراك"
              value={data.current.conversionRate === null ? '—' : `${data.current.conversionRate}٪`}
              hint="الاشتراكات من إجمالي الاشتراكات والدعوات"
              icon={<Users size={17} />}
            />
            <StatTile
              label="الكورسات المدفوعة"
              value={data.current.courses}
              hint={`${data.current.published.toLocaleString('ar-EG')} منشور`}
              icon={<Layers size={17} />}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="الأعلى نشاطًا بعد التسجيل" hint="الكورسات المدفوعة فقط؛ العضويات والدعوات الجديدة">
              <DemandRanking
                rows={data.topDemand.map((course) => ({
                  id: course.id,
                  name: course.name,
                  primary: course.enrollments,
                  secondary: course.invited,
                  note: `${course.started.toLocaleString('ar-EG')} بدأوا · ${course.completed.toLocaleString('ar-EG')} أكملوا`,
                }))}
                empty="لا توجد اشتراكات أو دعوات جديدة"
                primaryLabel="مشترك"
                secondaryLabel="دعوة"
              />
            </ChartCard>

            <ChartCard title="الأقل نشاطًا بعد التسجيل" hint="تبدأ بالكورسات المدفوعة التي لم تستقبل عضوية جديدة">
              <DemandRanking
                rows={data.lowDemand.map((course) => ({
                  id: course.id,
                  name: course.name,
                  primary: course.enrollments,
                  secondary: course.invited,
                  note: `${course.members.toLocaleString('ar-EG')} مشترك إجمالي`,
                }))}
                empty="لا توجد كورسات"
                primaryLabel="مشترك"
                secondaryLabel="دعوة"
              />
            </ChartCard>

            <ChartCard title="نشاط العضويات شهرًا بشهر" hint="الكورسات المدفوعة حسب تاريخ إنشاء العضوية">
              <DemandRanking
                rows={data.trend.map((point, index) => ({
                  id: index,
                  name: point.label,
                  primary: point.enrollments,
                  secondary: point.invited,
                  note: `${point.completed.toLocaleString('ar-EG')} أكملوا`,
                }))}
                empty="لا توجد حركة شهرية"
                primaryLabel="مشترك"
                secondaryLabel="دعوة"
              />
            </ChartCard>

            <ChartCard title="مسار التعلّم" hint="وضع المشتركين الجدد حاليًا">
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
            <h2 className="text-[15px] font-extrabold text-ink">الكتالوج المسجل الحالي</h2>
            <p className="text-[11.5px] text-ink-faint">الكورسات المنشورة والنشطة الآن فقط؛ المسودات والمتوقفة مستبعدة.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="كورسات مسجلة شغالة" value={totals.courses} icon={<BookOpen size={17} />} />
            <StatTile label="مشتركين" value={totals.members} icon={<Users size={17} />} />
            <StatTile
              label="خلّصوا الكورس"
              value={totals.completed}
              hint={totals.completionRate === null ? 'النسخة دي مش بتوفّر الرقم' : `${totals.completionRate}٪ من المشتركين`}
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
            <ChartCard title="أعلى نسب الإكمال" hint="الكورسات التي فيها ٥ مشتركين على الأقل">
              <BarList data={data.topByCompletion} empty="مفيش كورس عليه مشتركين كفاية" />
            </ChartCard>
            <ChartCard title="أكبر الكورسات محتوى" hint="عدد الدروس">
              <BarList data={data.biggest} empty="مفيش دروس متسجّلة" />
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
    return <p className="py-8 text-center text-[12.5px] text-status-ok">كل الكورسات المدفوعة عليها بيع في الفترة.</p>;
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
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-ink" title={course.name}>
            {course.name}
          </span>
          {!course.published && <span className="chip bg-white text-ink-faint">مسودة</span>}
        </li>
      ))}
    </ol>
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
