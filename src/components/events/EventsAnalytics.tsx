/**
 * The Analytics tab — moved here from the old Events page unchanged in what it
 * counts and how.
 *
 * Every chart here compares sizes — how many courses sit in each stage, which
 * instructors carry the most — so they are all one hue, darker for more. The
 * basis is the one the tab always had: in-person events whose `date_begin`
 * falls inside the chosen days, registrations grouped by state, and the paid
 * figures from Insights Hub kept visibly separate from Odoo's bookings.
 *
 * Loaded only when the tab is opened: it is several `read_group` calls against
 * Odoo and nobody should pay for them to look at today's lectures.
 */

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  BadgeDollarSign,
  CalendarDays,
  CircleSlash2,
  GraduationCap,
  TicketCheck,
  UserRoundSearch,
  Users,
} from 'lucide-react';
import { errorMessage } from '../../lib/api';
import {
  fetchAnalytics,
  kindLabel,
  shortDate,
  stageLabel,
  staleLabel,
  type AnalyticsRange,
  type EventsAnalytics as EventsAnalyticsData,
} from '../../lib/events';
import { BarList, ChartCard, StatTile } from '../Charts';
import {
  AnalyticsPeriodPicker,
  DEFAULT_ANALYTICS_RANGE,
  DemandRanking,
  TrainingSourceComparison,
  dateRangeLabel,
} from '../TrainingAnalytics';
import { cx } from '../../lib/utils';

function formatUsd(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD`;
}

function friendlyEventProduct(value: string): string {
  return value.replace(/^\s*\[[^\]]+\]\s*/, '').replace(/\s+/g, ' ').trim();
}

function previousDaysHint(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return 'مفيش مقارنة متاحة';
  if (current === previous) return 'زي الأيام اللي قبلها';
  if (previous === 0) return current > 0 ? 'ظهر جديد في الأيام دي' : 'مفيش تغيير';
  const change = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return `${change > 0 ? '↑' : '↓'} ${Math.abs(change).toLocaleString('en-US')}% عن الأيام اللي قبلها`;
}

export function EventsAnalytics({ version, onOpen }: { version: number; onOpen: (id: number) => void }) {
  const [range, setRange] = useState<AnalyticsRange>(DEFAULT_ANALYTICS_RANGE);
  const [data, setData] = useState<EventsAnalyticsData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    fetchAnalytics(range)
      .then((rows) => !cancelled && setData(rows))
      .catch((err) => !cancelled && setError(errorMessage(err, 'ar')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, version]);

  const current = data?.current;
  const previous = data?.previous;
  const top = data?.topDemand[0];
  const collected = data?.collectedCurrent;
  const collectedPrevious = data?.collectedPrevious;
  const topPaid = collected?.products[0];

  return (
    <div className="grid gap-4">
      <AnalyticsPeriodPicker
        value={range}
        onApply={setRange}
        loading={loading}
        basis="الإيفينتات الحضورية اللي ميعاد بدايتها جوه الأيام المختارة — مش حسب يوم عمل الحجز"
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
        <p className="flex items-center gap-2 rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          <AlertCircle size={15} />
          Insights Hub مارِدّش، فمش هنعرض رقم تحصيل غير مؤكد. حجوزات وتشغيل أودو ما زالوا ظاهرين تحت.
        </p>
      )}

      {data?.revenueStale && (
        <p className="flex items-center gap-2 rounded-xl bg-status-warnBg px-3.5 py-3 text-[12.5px] leading-relaxed text-accent-600">
          <AlertCircle size={15} />
          رقم التحصيل الظاهر هو آخر رقم صحيح محفوظ من Insights Hub.
        </p>
      )}

      {data && current && previous && (
        <div className={cx('grid gap-4 transition-opacity', loading && 'opacity-55')}>
          {data.revenueAvailable && collected && collectedPrevious && data.revenueSource && (
            <section className="grid gap-3 rounded-2xl border border-brand-100 bg-brand-50/55 p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black text-brand-700">البيع المدفوع · Insights Hub · حسب يوم الدفع</p>
                  <h2 className="mt-1 text-[18px] font-black leading-relaxed text-ink">
                    {topPaid
                      ? <><bdi dir="auto">«{friendlyEventProduct(topPaid.name)}»</bdi> جاب أعلى تحصيل حضوري في الأيام دي.</>
                      : 'مفيش تحصيل حضوري واضح في الفواتير خلال الأيام دي.'}
                  </h2>
                  <p className="mt-1 max-w-3xl text-[11.5px] leading-relaxed text-ink-muted">
                    هنا بنحسب سطور الفواتير المدفوعة اللي اسم المنتج فيها مكتوب بوضوح Offline Attendance أو Riyadh.
                    الأونلاين وأي Event نوعه مش واضح مش داخلين في الرقم.
                  </p>
                </div>
                <a
                  href={data.revenueSource.appUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="btn-ghost btn-sm bg-white"
                >
                  افتح Insights Hub
                </a>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile
                  label="فلوس إيفينتات حضورية"
                  value={formatUsd(collected.amount)}
                  hint={previousDaysHint(collected.amount, collectedPrevious.amount)}
                  explanation="مجموع USD Paid في سطور الفواتير المدفوعة للحضور Offline/Riyadh خلال الأيام المختارة."
                  tone={collected.amount > collectedPrevious.amount ? 'good' : 'plain'}
                  icon={<BadgeDollarSign size={17} />}
                />
                <StatTile
                  label="فواتير حضوري مدفوعة"
                  value={collected.invoices}
                  hint="كل رقم فاتورة بيتحسب مرة واحدة"
                  explanation="عدد الفواتير المختلفة اللي فيها منتج حضور واضح. الفاتورة ممكن يكون جواها أكتر من منتج."
                  icon={<TicketCheck size={17} />}
                />
                <StatTile
                  label="منتجات حضوري دخل لها فلوس"
                  value={collected.products.length}
                  hint="حسب اسم المنتج في الفاتورة"
                  explanation="عدد أسماء منتجات الحضور المختلفة اللي ظهر لها تحصيل فعلي. ده مش عدد الإيفينتات اللي بدأت."
                  icon={<CalendarDays size={17} />}
                />
                <StatTile
                  label="فواتير مش مربوطة بإيفينت"
                  value={collected.unassignedInvoices}
                  hint={collected.unassignedInvoices ? 'تحتاج ربط في المصدر' : 'كل الفواتير مربوطة'}
                  explanation="الفلوس صحيحة، لكن خانة Event في سطر الفاتورة فاضية؛ لذلك ما نقدرش ننسبها لسجل إيفينت بعينه."
                  tone={collected.unassignedInvoices > 0 ? 'warn' : 'good'}
                  icon={<AlertCircle size={17} />}
                />
              </div>

              <EventRevenueBreakdown
                products={collected.products}
                sourceUrl={data.revenueSource.appUrl}
              />

              {(collected.excludedOnlineInvoices > 0 || collected.excludedUnknownInvoices > 0) && (
                <p className="rounded-xl bg-white px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-muted">
                  علشان شاشة الإيفينتات حضوري بس: استبعدنا {collected.excludedOnlineInvoices.toLocaleString('en-US')} فاتورة
                  أونلاين بقيمة {formatUsd(collected.excludedOnlineAmount)}، و{collected.excludedUnknownInvoices.toLocaleString('en-US')} فاتورة
                  Event نوع الحضور فيها مش واضح بقيمة {formatUsd(collected.excludedUnknownAmount)}. ما خمّناش النوع.
                </p>
              )}
              {collected.authority === 'postgres-last-good' && (
                <p className="rounded-xl bg-status-warnBg px-3.5 py-3 text-[11.5px] font-semibold leading-relaxed text-accent-600">
                  المزامنة المباشرة ما اتقبلتش، فـ Insights Hub حافظ على آخر نسخة مالية سليمة بدل ما يعرض
                  رقم ناقص أو متغيّر. اضغط «مزامنة مباشرة» للمحاولة تاني.
                </p>
              )}
              {collected.authority === 'odoo-direct' && (
                <p className="rounded-xl bg-status-okBg px-3.5 py-3 text-[11.5px] font-semibold leading-relaxed text-status-ok">
                  التحصيل اتراجع مباشرة من أودو وعدّى فحص اكتمال الفواتير قبل ما يظهر هنا
                  {collected.syncedAt ? ` · آخر مزامنة ${staleLabel(collected.syncedAt)}` : ''}.
                </p>
              )}
              {collected.authority === 'postgres-live' && (
                <p className="rounded-xl bg-status-okBg px-3.5 py-3 text-[11.5px] font-semibold leading-relaxed text-status-ok">
                  بيانات التحصيل متزامنة من Odoo عن طريق n8n إلى PostgreSQL
                  {collected.syncedAt ? ` · آخر مزامنة ${staleLabel(collected.syncedAt)}` : ''}.
                </p>
              )}
            </section>
          )}

          {data.revenueAvailable && data.revenueSource && (
            <TrainingSourceComparison
              rows={data.comparison}
              mode="events"
              insightsUrl={data.revenueSource.appUrl}
            />
          )}

          <section className="rounded-2xl border border-surface-line bg-white px-4 py-3.5 shadow-sm">
            <h2 className="text-[15px] font-black text-ink">التشغيل والحجوزات · أودو · حسب ميعاد بداية الإيفينت</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              الجزء اللي تحت مش فلوس ومش فواتير: ده بيجيب الإيفينتات الحضورية اللي بدأت في الأيام المختارة،
              وبعدها يعدّ الأشخاص المسجلين عليها. علشان كده ما ينفعش نقارن الرقم ده مباشرة برقم Insights Hub.
            </p>
          </section>

          <section className="relative overflow-hidden rounded-2xl bg-navy px-5 py-5 text-white shadow-card">
            <span className="absolute -end-12 -top-14 h-40 w-40 rounded-full border-[28px] border-white/[0.04]" />
            <div className="relative grid gap-4 lg:grid-cols-[1.3fr_1fr] lg:items-end">
              <div>
                <p className="text-[11.5px] font-bold text-brand-200">
                  قراءة سريعة · {dateRangeLabel(data.period.from, data.period.to)}
                </p>
                <h2 className="mt-2 max-w-2xl text-[19px] font-black leading-relaxed sm:text-[22px]">
                  {top
                    ? top.bookings > 0
                      ? <><bdi dir="auto">«{top.name}»</bdi> عليه أكتر حجز في الأيام دي: {top.bookings.toLocaleString('en-US')} حجز مؤكد.</>
                      : <><bdi dir="auto">«{top.name}»</bdi> عليه {top.interested.toLocaleString('en-US')} مهتم ولسه مفيش حجز مؤكد.</>
                    : 'مفيش حجز أو اهتمام متسجل على إيفينتات الأيام دي.'}
                </h2>
                <p className="mt-2 text-[12.5px] text-white/60">
                  {current.noDemand > 0
                    ? `${current.noDemand.toLocaleString('en-US')} إيفينت بلا حجز أو اهتمام ويحتاج مراجعة التسويق أو الموعد.`
                    : 'كل الإيفينتات في الأيام دي عليها حجز أو اهتمام.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <QuickFact label="إيفينتات عليها حركة" value={current.demandRate === null ? '—' : `${current.demandRate.toLocaleString('en-US')}%`} />
                <QuickFact label="نسبة الحجوزات المؤكدة" value={current.confirmationRate === null ? '—' : `${current.confirmationRate.toLocaleString('en-US')}%`} />
              </div>
            </div>
          </section>

          <details className="group rounded-2xl border border-surface-line bg-white px-4 py-3.5">
            <summary className="cursor-pointer list-none text-[12.5px] font-extrabold text-ink [&::-webkit-details-marker]:hidden">
              الأرقام دي جاية منين وأتابع الإيفينت فين؟ <span className="text-brand-600 group-open:hidden">＋</span>
              <span className="hidden text-brand-600 group-open:inline">−</span>
            </summary>
            <div className="mt-2 grid gap-2 text-[11.5px] leading-relaxed text-ink-muted">
              <p>
                الإيفينت نفسه جاي من أودو، وبنحسب الحضوري بس لو ميعاد بدايته جوه الأيام المختارة. الحجز
                المؤكد هو الشخص اللي حالته «مفتوح» أو «تم»، و«لسه مش مؤكد» هو اللي حالته مسودة، والملغي
                حالته إلغاء. تاريخ عمل الحجز مش هو فلتر الفترة.
              </p>
              <p>
                نسبة المقاعد بتتحسب بس للإيفينتات اللي السعة مكتوبة فيها: الحجوزات المؤكدة ÷ عدد المقاعد.
                اضغط اسم أي إيفينت في القوائم تحت علشان تفتح تفاصيله هنا: الميعاد، المدرّب، المكان،
                وعدد المسجلين والمحاضرات. رابط أودو موجود جوه التفاصيل كاختيار إضافي لو حسابك عنده صلاحية.
              </p>
            </div>
          </details>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="إيفينتات بدأت في الأيام دي"
              value={current.events}
              hint={previousDaysHint(current.events, previous.events)}
              explanation="عدد الإيفينتات الحضورية اللي ميعاد بدايتها واقع بين التاريخين المختارين."
              icon={<CalendarDays size={17} />}
            />
            <StatTile
              label="ناس حجزت واتأكدت"
              value={current.bookings}
              hint={previousDaysHint(current.bookings, previous.bookings)}
              explanation="عدد الأشخاص في أودو وحالة حجزهم مفتوح أو تم، على إيفينتات الأيام المختارة."
              tone={current.bookings > previous.bookings ? 'good' : 'plain'}
              icon={<TicketCheck size={17} />}
            />
            <StatTile
              label="ناس لسه مش مؤكدة"
              value={current.interested}
              hint={previousDaysHint(current.interested, previous.interested)}
              explanation="أشخاص موجودون على الإيفينت لكن حالة تسجيلهم ما زالت مسودة؛ ما بنحسبهمش حجز مؤكد."
              icon={<UserRoundSearch size={17} />}
            />
            <StatTile
              label="إيفينتات من غير حجز أو اهتمام"
              value={current.noDemand}
              hint={previousDaysHint(current.noDemand, previous.noDemand)}
              explanation="إيفينتات ما عليهاش ولا حجز مؤكد ولا تسجيل مسودة."
              tone={current.noDemand > 0 ? 'warn' : 'good'}
              icon={<CircleSlash2 size={17} />}
            />
            <StatTile
              label="نسبة المقاعد المحجوزة"
              value={current.fillRate === null ? '—' : `${current.fillRate.toLocaleString('en-US')}%`}
              hint={current.seats ? `${current.capacityBookings.toLocaleString('en-US')} حجز من ${current.seats.toLocaleString('en-US')} مقعد` : 'السعة مش مكتوبة في أودو'}
              explanation="الحجوزات المؤكدة مقسومة على عدد المقاعد، للإيفينتات اللي السعة مكتوبة فيها بس."
              tone={current.fillRate !== null && current.fillRate >= 70 ? 'good' : 'plain'}
              icon={<Users size={17} />}
            />
            <StatTile
              label="ناس حضورها اتسجل"
              value={current.attended}
              hint={previousDaysHint(current.attended, previous.attended)}
              explanation="عدد الأشخاص اللي حالة تسجيلهم في أودو بقت تم."
              icon={<GraduationCap size={17} />}
            />
            <StatTile
              label="حجوزات اتلغت"
              value={current.cancelled}
              hint={previousDaysHint(current.cancelled, previous.cancelled)}
              explanation="عدد تسجيلات الأشخاص اللي حالتها إلغاء في أودو."
              tone={current.cancelled > previous.cancelled ? 'warn' : 'plain'}
              icon={<AlertCircle size={17} />}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="أكتر إيفينتات عليها حجز" hint="مرتبة بالحجز المؤكد الأول، وبعده اللي لسه مش مؤكد">
              <DemandRanking
                rows={data.topDemand.map((event) => ({
                  id: event.id,
                  name: event.name,
                  primary: event.bookings,
                  secondary: event.interested,
                  onClick: () => onOpen(event.id),
                  note: [shortDate(event.startsAt), event.instructor].filter(Boolean).join(' · '),
                }))}
                empty="مفيش حجز أو اهتمام متسجل في الأيام دي"
                primaryLabel="مؤكد"
                secondaryLabel="مش مؤكد"
              />
            </ChartCard>

            <ChartCard title="إيفينتات محتاجة متابعة" hint="اللي من غير حجز أو اهتمام بتظهر الأول">
              <DemandRanking
                rows={data.lowDemand.map((event) => ({
                  id: event.id,
                  name: event.name,
                  primary: event.bookings,
                  secondary: event.interested,
                  onClick: () => onOpen(event.id),
                  note: [shortDate(event.startsAt), kindLabel(event.kind)].filter(Boolean).join(' · '),
                }))}
                empty="مفيش إيفينتات في الأيام دي"
                primaryLabel="مؤكد"
                secondaryLabel="مش مؤكد"
              />
            </ChartCard>

            <ChartCard title="الحجوزات شهر بشهر" hint="كل إيفينت بيتحسب في الشهر اللي بدأ فيه">
              <DemandRanking
                rows={data.trend.map((point, index) => ({
                  id: index,
                  name: point.label,
                  primary: point.bookings,
                  secondary: point.interested,
                  note: `${point.events.toLocaleString('en-US')} إيفينت`,
                }))}
                empty="مفيش بيانات شهرية"
                primaryLabel="مؤكد"
                secondaryLabel="مش مؤكد"
              />
            </ChartCard>

            <ChartCard title="أفراد وشركات وخاص" hint="أنواع الإيفينتات الحضورية داخل الفترة">
              <BarList data={data.byKind} />
            </ChartCard>

            <ChartCard title="الإيفينتات وصلت لفين؟" hint="مرحلة كل إيفينت في أودو">
              <BarList data={data.byStage.map((row) => ({ ...row, label: stageLabel(row.label) }))} />
            </ChartCard>

            <ChartCard title="كل مدرّب عنده كام إيفينت؟" hint="عدد الإيفينتات اللي بدأت في الأيام دي">
              <BarList data={data.byInstructor} />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}

function EventRevenueBreakdown({
  products,
  sourceUrl,
}: {
  products: NonNullable<EventsAnalyticsData['collectedCurrent']>['products'];
  sourceUrl: string;
}) {
  if (products.length === 0) {
    return (
      <p className="rounded-xl bg-white px-3 py-6 text-center text-[12px] text-ink-muted">
        مفيش منتج حضور واضح دخل له فلوس في الأيام دي.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-black text-ink">التحصيل حسب منتج الحضور</h3>
          <p className="text-[10.5px] text-ink-faint">اسم الكورس بالإنجليزي زي ما هو مكتوب في الفاتورة</p>
        </div>
        <span className="chip bg-white text-ink-muted">المصدر: Paid Invoices</span>
      </div>
      <ol className="grid gap-2 md:grid-cols-2">
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
                <bdi dir="auto">{friendlyEventProduct(product.name)}</bdi>
              </a>
              <p className="text-[10.5px] text-ink-faint">
                {product.invoices.toLocaleString('en-US')} فاتورة فيها المنتج
                {product.events.length > 0
                  ? ` · مربوط بـ ${product.events.length.toLocaleString('en-US')} إيفينت`
                  : ' · سطر الفاتورة مش مربوط بإيفينت'}
              </p>
            </div>
            <strong className="whitespace-nowrap text-[12.5px] font-black tabular-nums text-ink">
              {formatUsd(product.amount)}
            </strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

function QuickFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 backdrop-blur">
      <p className="text-[10.5px] font-semibold text-white/55">{label}</p>
      <p className="mt-0.5 text-[21px] font-black tabular-nums text-white">{value}</p>
    </div>
  );
}
