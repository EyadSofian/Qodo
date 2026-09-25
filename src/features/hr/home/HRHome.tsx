/**
 * /hr — the executive view. Six figures, then four places where something
 * needs a decision. Recruitment detail lives in Recruitment; this page only
 * says whether it is healthy and where to look if it is not.
 */

import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, BriefcaseBusiness, CircleUserRound, PieChart, ShieldCheck, UserPlus, UsersRound, Wallet } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { hrApi, useHRQuery } from '../api';
import { money, monthLabel, num, pct, useHRText } from '../format';
import type { HomeData } from '../types';
import { Card, HeroStat, Metric, PageHeader, SectionTitle } from '../ui/primitives';
import { labelColor } from '../ui/theme';
import { LeaveRow, OutTodayStrip, personName } from '../ui/timeOff';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../ui/states';
import { SEVERITY_TONE, TONE, type Tone } from '../ui/tones';

/** Old `/hr?tab=…` bookmarks keep working. */
const LEGACY_TABS: Record<string, string> = {
  overview: '/hr',
  people: '/hr/people',
  leave: '/hr/personnel/leave',
  payroll: '/hr/payroll',
  recruitment: '/hr/recruitment',
  kpi: '/hr/performance?tab=scorecards',
  organization: '/hr/organization',
  offices: '/hr/organization?view=offices',
  imports: '/hr/settings?section=imports',
};

function Row({ label, value, to, tone = 'neutral', hint }: { label: string; value: number | string | null | undefined; to: string; tone?: Tone; hint?: string }) {
  const numeric = typeof value === 'number' ? value : null;
  const quiet = numeric === 0;
  return (
    <li>
      <Link to={to} className="group flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-[rgb(var(--hr-a1)/0.07)]">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-navy">
            {!quiet && tone !== 'neutral' && <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', TONE[tone].dot)} aria-hidden="true" />}
            <span className="truncate">{label}</span>
          </span>
          {hint && <span className="block truncate text-[11.5px] text-ink-faint">{hint}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cx('text-[16px] font-bold tabular-nums', quiet ? 'text-ink-faint' : tone !== 'neutral' ? TONE[tone].text : 'text-navy')}>{value ?? '—'}</span>
          <ArrowUpRight size={14} className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

export function HRHome() {
  const { t, lang, pick } = useHRText();
  const [params] = useSearchParams();
  const legacy = params.get('tab');
  const { data, error, loading, reload } = useHRQuery<HomeData>(legacy ? null : hrApi.home, { refreshMs: 180_000 });

  if (legacy) return <Navigate to={LEGACY_TABS[legacy] ?? '/hr'} replace />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton />;
  if (!data) return null;

  if (data.selfOnly) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="text-center">
          <CircleUserRound size={36} className="mx-auto text-brand-500" aria-hidden="true" />
          <h1 className="mt-3 text-[20px] font-bold text-navy">{t('ملفك في الموارد البشرية', 'Your HR profile')}</h1>
          <p className="mt-1.5 text-[13px] leading-6 text-[#5A6C82]">{t('بياناتك الوظيفية والإجازات والمستندات يراها أنت وفريق HR المخوّل فقط.', 'Your employment, leave and documents are visible only to you and authorised HR staff.')}</p>
          {data.employeeCode ? (
            <Link to={`/hr/people/${encodeURIComponent(data.employeeCode)}`} className="btn-primary mt-4">{t('افتح ملفي', 'Open my profile')}</Link>
          ) : (
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">{t('حسابك لم يُربط بكود موظف بعد.', 'Your account is not linked to an employee code yet.')}</p>
          )}
        </Card>
      </div>
    );
  }

  const m = data.metrics!;
  const r = data.recruitment;
  const p = data.personnel!;
  const perf = data.performance;
  const w = data.workforce!;
  const maxDepartment = Math.max(1, ...w.departments.map((item) => item.employees));
  const totalGender = Math.max(1, w.gender.male + w.gender.female);

  const timeOff = data.timeOff?.connected ? data.timeOff : null;
  const faces = (data.faces ?? []).map((person) => ({ name: personName(person, lang), photoUrl: person.photoUrl }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t('الموارد البشرية', 'Human resources')}
        title={t('نظرة تنفيذية', 'Executive view')}
        description={t('ستة أرقام، ثم أين يحتاج شيء قراراً. كل رقم يفتح ما خلفه — والبيانات مربوطة مباشرة بـOdoo.', 'Six figures, then where something needs a decision. Every figure opens what is behind it — live from Odoo.')}
        faces={faces}
        stats={
          <>
            <HeroStat value={num(m.activeEmployees, lang)} label={t('نشطون', 'active')} to="/hr/people?status=active" />
            {timeOff && <HeroStat value={num(timeOff.onLeaveToday.length, lang)} label={t('في إجازة اليوم', 'on leave today')} to="/hr/personnel/leave" />}
            {timeOff && timeOff.pending > 0 && <HeroStat value={num(timeOff.pending, lang)} label={t('طلب إجازة ينتظر الموافقة', 'awaiting approval')} to="/hr/personnel/leave" />}
            {data.odooOnly ? <HeroStat value={num(data.odooOnly, lang)} label={t('في Odoo وليسوا في ملف HR', 'in Odoo, not in the HR file')} to="/hr/people?source=odoo" /> : null}
          </>
        }
      />

      <div className="hr-stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric icon={UsersRound} label={t('موظفون نشطون', 'Active employees')} value={num(m.activeEmployees, lang)} to="/hr/people?status=active" emphasis />
        <Metric icon={PieChart} tone="info" label={t('رجال / سيدات', 'Men / women')} value={`${num(m.male, lang)} / ${num(m.female, lang)}`} to="/hr/reports?report=workforce" hint={t(`${pct((m.female / Math.max(1, m.male + m.female)) * 100, lang)} سيدات`, `${pct((m.female / Math.max(1, m.male + m.female)) * 100, lang)} women`)} />
        <Metric icon={UserPlus} tone="success" label={t('معينون جدد', 'New employees')} value={num(m.newEmployees, lang)} to="/hr/people?status=active&hired=month" hint={monthLabel(m.period, lang)} />
        <Metric icon={BriefcaseBusiness} tone="warning" label={t('وظائف مفتوحة', 'Open jobs')} value={m.openJobs === null ? '—' : num(m.openJobs, lang)} to="/hr/recruitment/hiring" hint={m.openSeats !== null ? t(`${num(m.openSeats, lang)} مقعد`, `${num(m.openSeats, lang)} seats`) : undefined} />
        <Metric icon={ShieldCheck} tone="success" label={t('مؤمَّن عليهم', 'Insured employees')} value={num(m.insuredEmployees, lang)} to={m.payrollUsd !== null ? '/hr/payroll#insurance' : '/hr/people'} />
        <Metric icon={Wallet} label={t('الرواتب بالدولار', 'Payroll (USD)')} value={m.payrollUsd === null ? '••••' : money(m.payrollUsd, lang, 'USD')} to={m.payrollUsd === null ? undefined : '/hr/payroll'} hint={m.payrollRate ? t(`بسعر ${m.payrollRate.sell} ج.م`, `at EGP ${m.payrollRate.sell}`) : t('يحتاج صلاحية الرواتب', 'Payroll access needed')} />
      </div>

      {timeOff && (
        <Card>
          <SectionTitle
            title={t('من خارج المكتب اليوم', 'Out of the office today')}
            hint={t('مباشر من إجازات Odoo — الإجازات المعتمدة، والعمل من المنزل والمأموريات بلون مختلف.', 'Live from Odoo time off — approved leave, with working from home and missions marked apart.')}
            action={<Link to="/hr/personnel/leave" className="text-[rgb(var(--hr-a1))] hover:underline">{t('كل الإجازات', 'All time off')}</Link>}
          />
          <OutTodayStrip absent={timeOff.onLeaveToday} away={timeOff.awayToday} empty={t('الكل في المكتب اليوم — لا توجد إجازات معتمدة لليوم في Odoo.', 'Everyone is in today — Odoo has no approved leave for today.')} />
          {timeOff.upcoming.length > 0 && (
            <div className="mt-4 border-t border-white/80 pt-3">
              <p className="mb-1 text-[12px] font-bold text-slate-500">{t('خلال الأسبوع القادم', 'In the coming week')}</p>
              <ul className="-mx-2.5">{timeOff.upcoming.slice(0, 4).map((leave) => <li key={leave.id}><LeaveRow leave={leave} /></li>)}</ul>
            </div>
          )}
        </Card>
      )}

      <div className="hr-stagger grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle title={t('صحة التوظيف', 'Recruitment health')} action={r ? <Link to="/hr/recruitment" className="text-[rgb(var(--hr-a1))] hover:underline">{t('فتح التوظيف', 'Open recruitment')}</Link> : null} />
          {r ? (
            <>
              <ul className="-mx-3">
                <Row label={t('وظائف متأخرة', 'Overdue jobs')} value={r.overdue} to="/hr/recruitment/hiring?sla=overdue" tone="critical" />
                <Row label={t('قريبة الاستحقاق', 'Due soon')} value={r.dueSoon} to="/hr/recruitment/hiring?sla=due_soon" tone="warning" />
                <Row label={t('وظائف حرجة نشطة', 'Active critical jobs')} value={r.critical} to="/hr/recruitment/hiring?priority=critical" tone="critical" />
                <Row label={t('تنبيهات سعة', 'Capacity alerts')} value={r.capacityAlerts} to="/hr/recruitment/capacity" tone="warning" />
                <Row label={t('بانتظار الاعتماد النهائي', 'Awaiting final approval')} value={r.pendingApproval} to="/hr/recruitment/requests?status=pending_approval" tone="info" />
                <Row label={t('نجاح الـSLA هذا العام', 'SLA success this year')} value={r.slaSuccess.percent === null ? '—' : pct(r.slaSuccess.percent, lang)} to="/hr/reports?report=recruitment_sla" hint={t(`${r.slaSuccess.judged} وظيفة محسومة`, `${r.slaSuccess.judged} decided jobs`)} />
              </ul>
              {r.topAlerts.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-white/80 pt-3">
                  {r.topAlerts.map((alert) => (
                    <li key={alert.id}><Link to={alert.link} className="flex items-start gap-2 text-[12.5px] hover:underline"><span className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', TONE[SEVERITY_TONE[alert.severity]].dot)} aria-hidden="true" /><span className="text-[#3F5068]">{pick(alert.body)}</span></Link></li>
                  ))}
                </ul>
              )}
            </>
          ) : <EmptyBlock title={t('التوظيف خارج صلاحياتك', 'Recruitment is outside your access')} />}
        </Card>

        <Card>
          <SectionTitle title={t('تنبيهات شئون العاملين', 'Personnel alerts')} action={<Link to="/hr/personnel" className="text-[rgb(var(--hr-a1))] hover:underline">{t('فتح شئون العاملين', 'Open personnel')}</Link>} />
          <ul className="-mx-3">
            <Row label={t('تهيئة موظفين جدد مفتوحة', 'Open onboarding')} value={p.onboardingOpen} to="/hr/personnel/onboarding" tone="info" />
            <Row label={t('إخلاء طرف مفتوح', 'Open clearance')} value={p.clearanceOpen} to="/hr/personnel/clearance" tone="warning" />
            <Row label={t('طلبات موظفين مفتوحة', 'Open employee requests')} value={p.requestsOpen} to="/hr/personnel/requests" tone="info" />
            <Row label={t('طلبات إجازة مفتوحة', 'Open leave requests')} value={p.leaveOpen} to="/hr/personnel/leave" tone="info" />
            <Row label={t('مستندات غير مكتملة', 'Incomplete documents')} value={p.documentsIncomplete} to="/hr/people?documents=incomplete" tone="warning" />
            <Row label={t('أرصدة إجازات سالبة', 'Negative leave balances')} value={p.negativeLeave} to="/hr/personnel/leave?negative=1" tone="critical" />
            {p.unlinkedAccounts !== null && <Row label={t('موظفون بلا حساب Qodo', 'Employees without a Qodo account')} value={p.unlinkedAccounts} to="/hr/settings?section=reconciliation" />}
            {p.activeWithoutPayroll !== null && <Row label={t('نشطون بلا سجل راتب', 'Active without payroll')} value={p.activeWithoutPayroll} to="/hr/payroll#gaps" tone="warning" />}
          </ul>
        </Card>

        <Card>
          <SectionTitle title={t('انتباه للأداء', 'Performance attention')} action={<Link to="/hr/performance" className="text-[rgb(var(--hr-a1))] hover:underline">{t('فتح الأداء', 'Open performance')}</Link>} />
          {perf ? (
            <ul className="-mx-3">
              <Row label={t('بطاقة أداء أقل من 70%', 'Scorecard below 70%')} value={perf.lowGeneral} to="/hr/performance?filter=low" tone="warning" />
              <Row label={t('مؤشر توظيف أقل من 70%', 'Recruitment KPI below 70%')} value={perf.lowRecruitment} to="/hr/recruitment/kpi" tone="warning" />
              <Row label={t(`تقييمات ${perf.quarter} غير معتمدة`, `${perf.quarter} reviews not final`)} value={perf.reviewsPending} to="/hr/performance?tab=reviews" tone="info" />
            </ul>
          ) : <EmptyBlock title={t('الأداء خارج صلاحياتك', 'Performance is outside your access')} />}
        </Card>

        <Card>
          <SectionTitle title={t('لقطة القوى العاملة', 'Workforce snapshot')} action={<Link to="/hr/people" className="text-[rgb(var(--hr-a1))] hover:underline">{t('فتح الموظفين', 'Open people')}</Link>} />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <ul className="space-y-2.5">
              {w.departments.slice(0, 6).map((item) => (
                <li key={item.department}>
                  <Link to={`/hr/people?department=${encodeURIComponent(item.department)}`} className="block">
                    <span className="flex items-center justify-between gap-2 text-[12.5px]"><span className="truncate font-semibold text-[#3F5068]">{item.department}</span><b className="tabular-nums text-navy">{num(item.employees, lang)}</b></span>
                    <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-200/70"><span className="block h-full rounded-full" style={{ width: `${(item.employees / maxDepartment) * 100}%`, backgroundImage: `linear-gradient(90deg, rgb(${labelColor(item.department)}), rgb(${labelColor(item.department)} / 0.6))` }} /></span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="space-y-3">
              <div className="rounded-2xl bg-white/70 p-3">
                <p className="text-[11.5px] font-semibold text-slate-500">{t('التوزيع', 'Split')}</p>
                <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-200/70">
                  <span className="bg-gradient-to-r from-blue-600 to-indigo-600" style={{ width: `${(w.gender.male / totalGender) * 100}%` }} />
                  <span className="bg-gradient-to-r from-pink-500 to-rose-500" style={{ width: `${(w.gender.female / totalGender) * 100}%` }} />
                </div>
                <p className="mt-1.5 flex justify-between text-[11.5px] text-[#5A6C82]"><span>{t('رجال', 'Men')} {num(w.gender.male, lang)}</span><span>{t('سيدات', 'Women')} {num(w.gender.female, lang)}</span></p>
              </div>
              <div className="rounded-2xl bg-white/70 p-3">
                <p className="text-[11.5px] font-semibold text-slate-500">{t('متوسط العمر', 'Average age')}</p>
                <p className="mt-0.5 text-[20px] font-bold tabular-nums text-navy">{w.averageAge ?? '—'}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default HRHome;
