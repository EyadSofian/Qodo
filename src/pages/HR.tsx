import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Bot,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Database,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  GitBranch,
  Gauge,
  IdCard,
  Landmark,
  Link2,
  ListFilter,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  LayoutDashboard,
  UploadCloud,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cx } from '../lib/utils';
import { Avatar, EmptyState, Modal, Spinner, useToast } from '../components/ui';
import { KPIScorecards, type KPISubject } from '../components/hr/KPIScorecards';
import {
  HR_SOURCE_LABELS,
  type HRDashboardData,
  type HRDatasetMeta,
  type HREmployeeProfile,
  type HREmployeeSummary,
  type HROrganizationPosition,
  type HROdooRecruitmentData,
  type HRRecruitmentAnalytics,
  type HRRecruitmentRequest,
  type HRSource,
} from '../lib/hr';

type HRTab = 'overview' | 'people' | 'payroll' | 'recruitment' | 'kpi' | 'organization' | 'imports';

const TABS: Array<{ id: HRTab; ar: string; en: string; icon: typeof UsersRound }> = [
  { id: 'overview', ar: 'نظرة عامة', en: 'Overview', icon: LayoutDashboard },
  { id: 'people', ar: 'الموظفون', en: 'People', icon: UsersRound },
  { id: 'payroll', ar: 'الرواتب', en: 'Payroll', icon: Banknote },
  { id: 'recruitment', ar: 'التوظيف', en: 'Recruitment', icon: BriefcaseBusiness },
  { id: 'kpi', ar: 'مؤشرات الأداء', en: 'KPIs', icon: Gauge },
  { id: 'organization', ar: 'الهيكل', en: 'Organization', icon: GitBranch },
  { id: 'imports', ar: 'تحديث البيانات', en: 'Data sync', icon: Database },
];

const SOURCE_ICONS: Record<HRSource, typeof Database> = {
  master: Database,
  payroll: WalletCards,
  insurance: ShieldCheck,
  recruitment: BriefcaseBusiness,
  organization: GitBranch,
};

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-status-okBg text-status-ok',
  done: 'bg-status-okBg text-status-ok',
  hold: 'bg-status-warnBg text-accent-700',
  inactive: 'bg-surface-sunken text-ink-muted',
  unknown: 'bg-surface-sunken text-ink-muted',
};

const STATUS_LABEL: Record<string, { ar: string; en: string }> = {
  active: { ar: 'نشط', en: 'Active' },
  done: { ar: 'مكتمل', en: 'Done' },
  hold: { ar: 'معلّق', en: 'On hold' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
  unknown: { ar: 'غير محدد', en: 'Unknown' },
};

export function HR() {
  const { lang } = useI18n();
  const { push } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<HRDashboardData | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<HRTab>('overview');
  const [uploading, setUploading] = useState<HRSource | null>(null);

  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const load = async () => {
    setError('');
    try {
      setData(await api.get<HRDashboardData>('/hr/dashboard'));
    } catch (requestError) {
      setError(errorMessage(requestError, lang));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!data?.permissions.selfOnly || data.employees.length !== 1) return;
    navigate(`/hr/employees/${data.employees[0].employeeCode}`, { replace: true });
  }, [data, navigate]);

  const upload = async (source: HRSource, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(source);
    try {
      const result = await api.upload<{ dataset: HRDatasetMeta }>(`/hr/imports/${source}`, file);
      push(l(`تم تحديث ${result.dataset.label.ar} بنجاح.`, `${result.dataset.label.en} updated.`));
      await load();
    } catch (requestError) {
      push(errorMessage(requestError, lang), 'bad');
    } finally {
      setUploading(null);
    }
  };

  if (!data && !error) return <HRLoading />;
  if (!data) {
    return (
      <div className="mx-auto max-w-xl py-20">
        <EmptyState
          icon={<AlertTriangle size={28} />}
          title={l('تعذّر فتح موديول الموارد البشرية', 'Could not open HR')}
          body={error}
          action={<button className="btn-primary" onClick={() => void load()}>{l('إعادة المحاولة', 'Try again')}</button>}
        />
      </div>
    );
  }

  const kpiSubjects: KPISubject[] = [
    ...data.employees.map((employee) => ({
      id: employee.employeeCode,
      name: employee.nameArabic || employee.nameEnglish || `#${employee.employeeCode}`,
      type: 'employee' as const,
    })),
    ...data.accounts.map((account) => ({ id: account.id, name: account.name, type: 'user' as const })),
  ];

  const readySources = data.datasets.filter((dataset) => dataset.importedAt).length;
  const latestDataset = data.datasets
    .filter((dataset) => dataset.importedAt)
    .sort((left, right) => String(right.importedAt).localeCompare(String(left.importedAt)))[0];
  const shownTabs = TABS.filter((item) => {
    // Someone who may only see themselves still gets the KPI desk: the endpoint
    // returns their own scorecards and nobody else's, and their own grade is
    // the half of this module they have the most reason to read.
    if (!data.permissions.canViewPeople && item.id !== 'overview' && item.id !== 'kpi') return false;
    if (!data.permissions.canViewPayroll && item.id === 'payroll') return false;
    if (!data.permissions.canManage && item.id === 'imports') return false;
    return true;
  });

  return (
    <div className="hr-suite mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 sm:py-8">
      {/* The page opens on the page itself, not on a dark slab laid over it:
          a kicker, the title, and the four figures as their own small
          sheets floating on the wash. */}
      <header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-semibold">
          <span className="hr-stat inline-flex items-center gap-1.5 px-2.5 py-1 text-brand-600">
            <Activity size={13} /><span className="ltr tracking-[0.14em]">People Operations</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink-faint">
            <Fingerprint size={13} />{l('سجل تشغيلي موحّد', 'Unified operating record')}
          </span>
          <span className="ms-auto text-ink-faint">
            {latestDataset?.importedAt
              ? l(`آخر تحديث ${formatDateTime(latestDataset.importedAt, lang)}`, `Updated ${formatDateTime(latestDataset.importedAt, lang)}`)
              : l(`${readySources} مصادر جاهزة`, `${readySources} sources ready`)}
          </span>
        </div>
        <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div className="min-w-0">
            <h1 className="max-w-3xl text-[28px] font-semibold leading-[1.18] tracking-tight text-navy sm:text-[38px] lg:text-[44px]">
              {l('غرفة عمليات الموارد البشرية', 'People operations room')}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-muted">
              {l('ملخص تنفيذي قابل للقرار، ثم التفاصيل والمصدر والتعديل في نفس المسار.', 'An executive decision layer, with detail, source, and editing in the same flow.')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:shrink-0">
            <HeadlineStat label={l('نشط', 'Active')} value={data.summary.active} />
            <HeadlineStat label={l('جدد هذا الشهر', 'New this month')} value={data.analytics?.workforce.newHires ?? 0} />
            <HeadlineStat label={l('شواغر', 'Open seats')} value={data.summary.openPositions} signal />
            <HeadlineStat label={l('مصادر', 'Sources')} value={`${readySources}/5`} />
          </div>
        </div>
      </header>

      <div className="hr-rail sticky top-[calc(var(--topbar-h)+var(--sat)+0.5rem)] z-20 mt-8 flex items-center gap-1 p-1.5">
        <nav className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label={l('أقسام الموارد البشرية', 'HR sections')}>
          {shownTabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={cx(
                  'relative inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold transition-all sm:px-4',
                  active
                    ? 'bg-navy text-white shadow-[0_6px_16px_-8px_rgba(11,37,69,0.7)]'
                    : 'text-ink-muted hover:bg-white/70 hover:text-navy'
                )}
              >
                <Icon size={16} className={cx('shrink-0', active ? 'text-white' : 'text-ink-faint')} />
                <span className="whitespace-nowrap">{l(item.ar, item.en)}</span>
              </button>
            );
          })}
        </nav>
        <button type="button" onClick={() => void load()} className="ms-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-ink-muted transition-colors hover:bg-white/70 hover:text-navy" aria-label={l('تحديث', 'Refresh')}>
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="mt-5 animate-fade-up" key={tab}>
        {tab === 'overview' && <Overview data={data} lang={lang} onOpen={setTab} />}
        {tab === 'people' && <PeopleDirectory data={data} lang={lang} />}
        {tab === 'payroll' && <PayrollDesk data={data} lang={lang} />}
        {tab === 'recruitment' && <RecruitmentDesk data={data} lang={lang} onChanged={load} />}
        {tab === 'kpi' && <KPIScorecards lang={lang} canManage={data.permissions.canManage} subjects={kpiSubjects} />}
        {tab === 'organization' && <OrganizationDesk data={data} lang={lang} />}
        {tab === 'imports' && (
          <ImportDesk data={data} lang={lang} uploading={uploading} onUpload={upload} />
        )}
      </div>
    </div>
  );
}

function HRLoading() {
  return (
    <div className="hr-suite mx-auto w-full max-w-[1540px] space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <div className="skeleton h-40 rounded-2xl" />
      <div className="skeleton h-14 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="skeleton h-[8.75rem] rounded-2xl" />)}</div>
      <div className="grid gap-3 xl:grid-cols-2">{Array.from({ length: 2 }, (_, index) => <div key={index} className="skeleton h-56 rounded-[20px]" />)}</div>
    </div>
  );
}

function HeadlineStat({ label, value, signal }: { label: string; value: string | number; signal?: boolean }) {
  return (
    <div className="hr-stat px-4 py-3 lg:min-w-[7.75rem]">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold leading-snug text-ink-muted">
        {signal && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />}
        {label}
      </div>
      <div className="hr-num mt-1.5 text-2xl font-semibold text-navy">{value}</div>
    </div>
  );
}

function TabSummary({ title, items, footer }: {
  title: string;
  items: Array<{ label: string; value: ReactNode; note?: string; featured?: boolean }>;
  footer?: string;
}) {
  return (
    <section>
      <h2 className="hr-eyebrow mb-2.5 px-0.5">{title}</h2>
      {/* Separate sheets with air between them. The old ruled grid shared
          hairlines like a spreadsheet, and left a visible empty cell
          whenever five items met a two- or three-column layout. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {items.map((item) => (
          <div key={item.label} className={cx('hr-stat relative min-h-[6rem] p-4', item.featured && 'ring-1 ring-brand-500/25')}>
            <div className="text-[11px] font-semibold leading-snug text-ink-muted">{item.label}</div>
            <div className={cx('hr-num mt-2 truncate font-semibold text-navy', item.featured ? 'text-[22px] sm:text-2xl' : 'text-xl sm:text-[22px]')} title={typeof item.value === 'string' ? item.value : undefined}>{item.value}</div>
            {item.note && <div className="mt-1 truncate text-[11px] text-ink-muted">{item.note}</div>}
          </div>
        ))}
      </div>
      {footer && <p className="mt-2.5 px-0.5 text-[11px] leading-6 text-ink-faint">{footer}</p>}
    </section>
  );
}

function Overview({ data, lang, onOpen }: { data: HRDashboardData; lang: 'ar' | 'en'; onOpen: (tab: HRTab) => void }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const reconciliation = data.reconciliation;
  const qualityIssues = reconciliation
    ? Object.values(reconciliation).reduce((sum, items) => sum + items.length, 0)
    : 0;
  const workforce = data.analytics?.workforce;
  const payroll = data.analytics?.payroll;
  const recruitment = data.analytics?.recruitment;
  const maxDepartment = workforce?.departments[0]?.employees || 1;
  const payrollMax = payroll?.departments[0]?.totalUsd || 1;

  if (data.permissions.selfOnly) {
    return (
      <div className="hr-panel p-6 sm:p-8">
        <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="text-xs font-bold text-brand-500">{l('ملفك الشخصي في HR', 'Your HR profile')}</p>
            <h2 className="mt-2 text-xl font-extrabold text-navy sm:text-2xl">{l('كل بياناتك الوظيفية في مكان واحد', 'All your employment data in one place')}</h2>
            <p className="mt-2 max-w-xl text-sm leading-7 text-ink-muted">
              {l('البيانات الشخصية والوظيفة والراتب والتأمين والمستندات لا يراها هنا إلا أنت وفريق HR المخوّل.', 'Personal, employment, payroll, insurance, and documents are visible only to you and authorised HR staff.')}
            </p>
          </div>
          {data.employees[0] ? (
            <Link className="btn-primary" to={`/hr/employees/${data.employees[0].employeeCode}`}>
              <IdCard size={18} /> {l('افتح ملفي', 'Open my profile')}
            </Link>
          ) : (
            <div className="rounded-xl bg-status-warnBg px-4 py-3 text-sm font-semibold text-accent-700">
              {l('حسابك لم يُربط بكود موظف بعد.', 'Your account is not linked to an employee code yet.')}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* One figure carries this screen, and it is not the same figure for
          everyone: payroll for whoever may read it, headcount for whoever
          may not. The other four are rows, not tiles — five equal boxes
          said nothing was more important than anything else. */}
      <section className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {payroll ? (
          <HeroMetric
            label={l('إجمالي الرواتب', 'Total payroll')}
            value={usd(payroll.totalUsd, lang)}
            note={l(`بسعر ${payroll.rate.sell} ج.م · ${payroll.rate.source} · ${payroll.rate.asOf}`, `at EGP ${payroll.rate.sell} · ${payroll.rate.source} · ${payroll.rate.asOf}`)}
            caption={l(`${payroll.employees} موظف على المسير`, `${payroll.employees} employees on payroll`)}
          />
        ) : (
          <HeroMetric
            label={l('القوة الفعلية', 'Active workforce')}
            value={String(data.summary.active)}
            note={l(`${workforce?.gender.female ?? 0} سيدة · ${workforce?.gender.male ?? 0} رجل`, `${workforce?.gender.female ?? 0} women · ${workforce?.gender.male ?? 0} men`)}
            caption={l('صلاحية الرواتب مطلوبة لعرض المسير', 'Payroll access required for the total')}
          />
        )}
        <div className="hr-panel divide-y divide-navy/[0.07] px-5">
          {payroll && (
            <QuietMetric label={l('القوة الفعلية', 'Active workforce')} value={data.summary.active} note={l(`${workforce?.gender.female ?? 0} سيدة · ${workforce?.gender.male ?? 0} رجل`, `${workforce?.gender.female ?? 0} women · ${workforce?.gender.male ?? 0} men`)} />
          )}
          {!payroll && (
            <QuietMetric label={l('إجمالي الرواتب', 'Total payroll')} value="••••" note={l('صلاحية الرواتب مطلوبة', 'Payroll access required')} />
          )}
          <QuietMetric label={l('تأمين اجتماعي', 'Socially insured')} value={data.summary.insured} note={l('التأمين الصحي بلا مصدر حاليًا', 'Health insurance source missing')} />
          <QuietMetric label={l('وظائف مفتوحة', 'Open seats')} value={recruitment?.openSeats ?? 0} note={l(`${recruitment?.overdue ?? 0} متأخرة`, `${recruitment?.overdue ?? 0} overdue`)} />
          <QuietMetric label={l('موظفون جدد', 'New hires')} value={workforce?.newHires ?? 0} note={formatMonth(workforce?.period, lang)} />
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]">
        <InsightPanel eyebrow={l('تركيبة القوة', 'Workforce composition')} title={l('الناس والأقسام', 'People and departments')} action={<button onClick={() => onOpen('people')}>{l('فتح الموظفين', 'Open people')}</button>}>
          <div className="grid gap-5 md:grid-cols-[12rem_1fr]">
            <GenderSplit female={workforce?.gender.female ?? 0} male={workforce?.gender.male ?? 0} lang={lang} />
            <div className="space-y-3">
              {(workforce?.departments ?? []).slice(0, 5).map((item) => <BarRow key={item.department} label={item.department} value={item.employees} max={maxDepartment} />)}
            </div>
          </div>
        </InsightPanel>

        <InsightPanel eyebrow={l('تكلفة التشغيل', 'Operating cost')} title={l('الرواتب حسب القسم', 'Payroll by department')} action={data.permissions.canViewPayroll ? <button onClick={() => onOpen('payroll')}>{l('فتح الرواتب', 'Open payroll')}</button> : null}>
          {payroll ? (
            <div className="space-y-3">
              {payroll.departments.slice(0, 5).map((item) => <BarRow key={item.department} label={item.department} value={usd(item.totalUsd, lang)} numericValue={item.totalUsd} max={payrollMax} accent />)}
              <p className="pt-1 text-[11px] leading-5 text-ink-muted">{l(`سعر بيع الدولار · ${payroll.rate.source} · ${payroll.rate.asOf}`, `USD sell rate · ${payroll.rate.source} · ${payroll.rate.asOf}`)}</p>
            </div>
          ) : <MissingData text={l('تفاصيل الرواتب محجوبة حسب الصلاحية.', 'Payroll details are permission-gated.')} />}
        </InsightPanel>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.35fr_.65fr]">
        <InsightPanel eyebrow={l('دورة التعيين', 'Hiring cycle')} title={l('تقدم الوظائف النشطة', 'Active recruitment progress')} action={<button onClick={() => onOpen('recruitment')}>{l('فتح التوظيف', 'Open recruitment')}</button>}>
          <RecruitmentFunnel analytics={recruitment} lang={lang} />
          <div className="mt-5 grid grid-cols-3 border-t border-navy/[0.07] pt-4 text-center">
            <InlineStat label={l('معدل الشغل', 'Fill rate')} value={`${recruitment?.fillRate ?? 0}%`} />
            <InlineStat label={l('متوسط المخطط', 'Planned average')} value={recruitment?.averagePlannedDays === null || recruitment?.averagePlannedDays === undefined ? '—' : `${recruitment.averagePlannedDays} ${l('يوم', 'days')}`} />
            <InlineStat label={l('قريب الاستحقاق', 'Due soon')} value={recruitment?.dueSoon ?? 0} />
          </div>
        </InsightPanel>

        <InsightPanel eyebrow={l('مراجعة البيانات', 'Data control')} title={l('طابور الإجراءات', 'Action queue')}>
          <div className="flex items-end justify-between gap-3 border-b border-navy/[0.07] pb-4">
            <div className="min-w-0"><div className="hr-num text-4xl font-bold leading-none text-navy">{qualityIssues}</div><p className="mt-1.5 text-xs leading-5 text-ink-muted">{l('فرق يحتاج قرارًا', 'differences need a decision')}</p></div>
            <span className={cx('shrink-0', qualityIssues ? 'text-accent-700' : 'text-status-ok')}>{qualityIssues ? <AlertTriangle size={22} /> : <BadgeCheck size={22} />}</span>
          </div>
          {reconciliation && <QualityMini reconciliation={reconciliation} lang={lang} />}
          {data.permissions.canManage && <button className="mt-4 w-full border-t border-navy/[0.07] pt-3 text-xs font-bold text-brand-500 hover:underline" onClick={() => onOpen('imports')}>{l('راجع المصادر والتحديثات', 'Review sources and updates')}</button>}
        </InsightPanel>
      </div>
    </div>
  );
}

function HeroMetric({ label, value, note, caption }: { label: string; value: string; note: string; caption: string }) {
  return (
    <article className="hr-hero-card flex flex-col justify-between p-6 sm:p-7">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-white/70">
        <CircleDollarSign size={15} className="shrink-0" />
        {label}
      </div>
      {/* clamp() rather than a breakpoint ladder: the string is a formatted
          currency total, so it has to fit the column it is given. */}
      <div className="hr-num mt-6 font-semibold leading-none text-white [font-size:clamp(2.25rem,5.5vw,3.5rem)]" title={value}>{value}</div>
      <p className="mt-3 text-[12px] leading-6 text-white/60">{note}</p>
      <p className="mt-5 border-t border-white/12 pt-3 text-[12px] text-white/50">{caption}</p>
    </article>
  );
}

function QuietMetric({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-4">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-navy">{label}</div>
        <p className="mt-0.5 truncate text-[11px] leading-5 text-ink-muted">{note}</p>
      </div>
      <div className="hr-num shrink-0 text-2xl font-semibold text-navy">{value}</div>
    </div>
  );
}

function InsightPanel({ eyebrow, title, action, children }: { eyebrow: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="hr-panel flex flex-col">
      <header className="hr-head">
        <div className="min-w-0">
          <p className="hr-eyebrow">{eyebrow}</p>
          <h2 className="hr-title mt-1 truncate">{title}</h2>
        </div>
        {action && <div className="shrink-0 text-xs font-semibold text-brand-600 [&_button:hover]:underline">{action}</div>}
      </header>
      <div className="flex-1 p-5">{children}</div>
    </section>
  );
}

function GenderSplit({ female, male, lang }: { female: number; male: number; lang: 'ar' | 'en' }) {
  const total = female + male;
  const femalePercent = total ? Math.round((female / total) * 100) : 0;
  return (
    <div className="flex flex-col justify-between rounded-xl border border-navy/[0.07] bg-surface-sunken/60 p-4 md:border-0 md:border-e md:bg-transparent md:p-0 md:pe-5">
      <div>
        <p className="text-[11px] font-bold text-ink-muted">{lang === 'en' ? 'Gender split' : 'توزيع النوع'}</p>
        <div className="hr-num mt-2 text-4xl font-semibold text-navy">{femalePercent}%</div>
        <p className="mt-0.5 text-[11px] leading-5 text-ink-muted">{lang === 'en' ? 'women in active workforce' : 'سيدات من القوة الفعلية'}</p>
      </div>
      <div className="mt-4 flex gap-4 text-xs font-semibold md:mt-5">
        <span className="flex items-center gap-1.5"><b className="text-base leading-none text-accent-500">♀</b><span className="hr-num">{female}</span></span>
        <span className="flex items-center gap-1.5"><b className="text-base leading-none text-brand-500">♂</b><span className="hr-num">{male}</span></span>
      </div>
    </div>
  );
}

function BarRow({ label, value, numericValue, max, accent }: { label: string; value: string | number; numericValue?: number; max: number; accent?: boolean }) {
  const width = Math.max(3, Math.min(100, ((numericValue ?? (Number(value) || 0)) / Math.max(1, max)) * 100));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[11.5px]">
        <span className="truncate font-semibold text-ink-muted">{label}</span>
        <b className="hr-num shrink-0 font-semibold text-navy">{value}</b>
      </div>
      <div className="hr-meter">
        <span data-tone={accent ? 'navy' : undefined} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function InlineStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-2 [&:not(:last-child)]:border-e [&:not(:last-child)]:border-navy/[0.07]">
      <div className="hr-num text-lg font-semibold text-navy">{value}</div>
      <div className="mt-0.5 text-[11px] leading-5 text-ink-muted">{label}</div>
    </div>
  );
}

function RecruitmentFunnel({ analytics, lang }: { analytics: HRRecruitmentAnalytics | undefined; lang: 'ar' | 'en' }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const total = Math.max(1, analytics?.funnel.total ?? 0);
  const stages = [
    [l('استلام المتطلبات', 'Requirements'), analytics?.funnel.requirements ?? 0],
    [l('النشر', 'Published'), analytics?.funnel.published ?? 0],
    [l('استلام مرشحين', 'Candidates received'), analytics?.funnel.candidates ?? 0],
    [l('تم قبول مرشح', 'Accepted'), analytics?.funnel.accepted ?? 0],
  ] as const;
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stages.map(([label, value], index) => {
        const percent = Math.round((value / total) * 100);
        return (
          <li key={label} className="hr-stat relative p-3.5">
            <div className="flex items-center justify-between">
              <span className="hr-num rounded-md bg-surface-sunken px-1.5 py-0.5 text-[10px] font-bold text-ink-faint">0{index + 1}</span>
              <span className="hr-num text-[11px] font-bold text-brand-500">{percent}%</span>
            </div>
            <div className="hr-num mt-2.5 text-2xl font-bold leading-none text-navy">{value}<span className="text-xs font-semibold text-ink-faint">/{total}</span></div>
            <div className="mt-1.5 min-h-8 text-[11.5px] font-semibold leading-5 text-ink-muted">{label}</div>
            <div className="hr-meter mt-2.5">
              <span style={{ width: `${percent}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function QualityMini({ reconciliation, lang }: { reconciliation: NonNullable<HRDashboardData['reconciliation']>; lang: 'ar' | 'en' }) {
  const rows = [
    ['activeWithoutPayroll', 'نشط بدون راتب', 'Active missing payroll'],
    ['insuranceWithoutMaster', 'تأمين بلا ملف', 'Insurance missing master'],
    ['unlinkedAccounts', 'حساب غير مربوط', 'Unlinked accounts'],
    ['unmatchedOrganizationPositions', 'منصب غير مطابق', 'Unmatched positions'],
  ] as const;
  return (
    <div className="mt-4 divide-y divide-navy/[0.06] border-y border-navy/[0.07]">
      {rows.map(([key, ar, en]) => (
        <div key={key} className="flex items-center justify-between gap-3 px-1 py-2.5 text-[11.5px]">
          <span className="font-semibold leading-5 text-ink-muted">{lang === 'en' ? en : ar}</span>
          <b className={cx('hr-num shrink-0', reconciliation[key].length ? 'text-status-bad' : 'text-brand-500')}>{reconciliation[key].length}</b>
        </div>
      ))}
    </div>
  );
}

function PeopleDirectory({ data, lang }: { data: HRDashboardData; lang: 'ar' | 'en' }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [department, setDepartment] = useState('all');
  const workforce = data.analytics?.workforce;
  const departments = useMemo(() => [...new Set(data.employees.map((employee) => employee.department || employee.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')), [data.employees]);
  const people = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.employees.filter((employee) => {
      const matchesStatus = status === 'all' || employee.status === status;
      const matchesDepartment = department === 'all' || employee.department === department || employee.sector === department;
      const haystack = `${employee.employeeCode} ${employee.nameArabic} ${employee.nameEnglish} ${employee.department} ${employee.title}`.toLowerCase();
      return matchesStatus && matchesDepartment && (!needle || haystack.includes(needle));
    });
  }, [data.employees, department, query, status]);

  return (
    <div className="space-y-8">
      <TabSummary title={l('ملخص الموظفين', 'People summary')} items={[
        { label: l('نشط', 'Active'), value: workforce?.active ?? data.summary.active },
        { label: l('سيدات / رجال', 'Women / men'), value: `${workforce?.gender.female ?? 0} / ${workforce?.gender.male ?? 0}` },
        { label: l('متوسط العمر', 'Average age'), value: workforce?.averageAge ? `${workforce.averageAge}` : '—', note: l('سنة', 'years') },
        { label: l('أكبر قسم', 'Largest department'), value: workforce?.largestDepartment?.department || '—', note: workforce?.largestDepartment ? `${workforce.largestDepartment.employees}` : '' },
        { label: l('جدد هذا الشهر', 'New this month'), value: workforce?.newHires ?? 0 },
      ]} />
      <section className="hr-panel-solid overflow-hidden">
        <div className="grid gap-3 border-b border-navy/[0.07] p-5 lg:grid-cols-[minmax(0,1fr)_15rem_auto] lg:items-center">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" size={16} />
            <input className="field ps-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l('الاسم، الكود أو المسمى الوظيفي…', 'Name, code, or job title…')} />
          </div>
          <select className="field" value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="all">{l('كل الأقسام', 'All departments')}</option>
            {departments.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <div className="hr-seg">
            {(['active', 'inactive', 'all'] as const).map((item) => (
              <button key={item} type="button" className="hr-seg-btn" aria-pressed={status === item} onClick={() => setStatus(item)}>
                {item === 'active' ? l('نشط', 'Active') : item === 'inactive' ? l('سابق', 'Former') : l('الكل', 'All')}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-start text-sm">
            <thead className="bg-navy/[0.035] text-[11px] font-semibold text-ink-muted"><tr><th className="px-5 py-3 text-start">{l('الموظف', 'Employee')}</th><th className="px-4 py-3 text-start">{l('الوظيفة', 'Role')}</th><th className="px-4 py-3 text-start">{l('القسم', 'Department')}</th><th className="px-4 py-3 text-start">{l('الربط', 'Coverage')}</th><th className="px-4 py-3 text-start">{l('الحالة', 'Status')}</th><th className="w-12" /></tr></thead>
            <tbody className="divide-y divide-navy/[0.06]">{people.map((employee) => <EmployeeRow key={employee.employeeCode} employee={employee} lang={lang} />)}</tbody>
          </table>
        </div>
        <div className="divide-y divide-navy/[0.06] md:hidden">{people.map((employee) => <EmployeeMobile key={employee.employeeCode} employee={employee} lang={lang} />)}</div>
        {!people.length && <EmptyState title={l('لا توجد نتائج', 'No matching employees')} body={l('جرّب كلمة بحث أو فلتر مختلف.', 'Try another search or filter.')} />}
      </section>
    </div>
  );
}

function EmployeeRow({ employee, lang }: { employee: HREmployeeSummary; lang: 'ar' | 'en' }) {
  const name = employee.nameArabic || employee.nameEnglish || `#${employee.employeeCode}`;
  return (
    <tr className="group transition-colors hover:bg-brand-50/50">
      <td className="px-5 py-3"><Link to={`/hr/employees/${employee.employeeCode}`} className="flex items-center gap-3"><Avatar name={name} size={36} color={employee.status === 'active' ? '#1D6FB8' : '#94A3B8'} /><span className="min-w-0"><span className="block font-semibold text-navy group-hover:text-brand-500">{name}</span><span className="ltr block truncate text-[11px] text-ink-muted">#{employee.employeeCode} · {employee.companyEmail}</span></span></Link></td>
      <td className="px-4 py-3"><div className="max-w-[18rem] truncate font-semibold" title={employee.title || undefined}>{employee.title || '—'}</div></td>
      <td className="px-4 py-3 text-xs text-ink-muted">{employee.department || employee.sector || '—'}</td>
      <td className="px-4 py-3"><div className="flex gap-1.5"><CoverageDot active={employee.hasPayroll} title={lang === 'en' ? 'Payroll' : 'راتب'} /><CoverageDot active={employee.hasInsurance} title={lang === 'en' ? 'Insurance' : 'تأمين'} /><CoverageDot active={Boolean(employee.linkedUserId)} title={lang === 'en' ? 'Qodo account' : 'حساب Qodo'} /></div></td>
      <td className="px-4 py-3"><StatusChip status={employee.status} lang={lang} /></td>
      <td className="px-4 py-3"><Link to={`/hr/employees/${employee.employeeCode}`} className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-brand-50 hover:text-brand-500" aria-label={lang === 'en' ? 'Open profile' : 'فتح الملف'}><ChevronRight className="rtl:rotate-180" size={17} /></Link></td>
    </tr>
  );
}

function EmployeeMobile({ employee, lang }: { employee: HREmployeeSummary; lang: 'ar' | 'en' }) {
  const name = employee.nameArabic || employee.nameEnglish || `#${employee.employeeCode}`;
  return (
    <Link to={`/hr/employees/${employee.employeeCode}`} className="flex items-center gap-3 p-4 active:bg-surface-sunken">
      <Avatar name={name} color={employee.status === 'active' ? '#1D6FB8' : '#94A3B8'} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-navy">{name}</div>
        <div className="mt-0.5 truncate text-xs text-ink-muted"><span className="ltr">#{employee.employeeCode}</span> · {employee.title}</div>
      </div>
      <StatusChip status={employee.status} lang={lang} />
    </Link>
  );
}

function CoverageDot({ active, title }: { active: boolean; title: string }) {
  return <span className={cx('h-2.5 w-2.5 rounded-full ring-2 ring-white', active ? 'bg-status-ok' : 'bg-slate-200')} title={`${title}: ${active ? '✓' : '—'}`} />;
}

function StatusChip({ status, lang }: { status: string; lang: 'ar' | 'en' }) {
  const meta = STATUS_LABEL[status] ?? STATUS_LABEL.unknown;
  return <span className={cx('chip whitespace-nowrap', STATUS_STYLE[status] ?? STATUS_STYLE.unknown)}>{meta[lang]}</span>;
}

function PayrollDesk({ data, lang }: { data: HRDashboardData; lang: 'ar' | 'en' }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const [order, setOrder] = useState<'high' | 'low'>('high');
  const analytics = data.analytics?.payroll;
  const employeeByCode = new Map(data.employees.map((employee) => [employee.employeeCode, employee]));
  const ranking = analytics ? (order === 'high' ? analytics.ranking : [...analytics.ranking].reverse()) : [];
  const maxDepartment = analytics?.departments[0]?.totalUsd || 1;
  if (!analytics) return <MissingData text={l('تحتاج صلاحية الرواتب لعرض الملخص.', 'Payroll permission is required.')} />;
  return (
    <div className="space-y-8">
      <TabSummary title={l('ملخص الرواتب', 'Payroll summary')} items={[
        { label: l('إجمالي المسير بالدولار', 'Total payroll in USD'), value: usd(analytics.totalUsd, lang), featured: true },
        { label: l('متوسط الموظف', 'Average per employee'), value: usd(analytics.averageUsd, lang) },
        { label: l('أعلى قسم تكلفة', 'Highest-cost department'), value: analytics.highestCostDepartment?.department || '—', note: analytics.highestCostDepartment ? usd(analytics.highestCostDepartment.totalUsd, lang) : '' },
        { label: l('أقل قسم تكلفة', 'Lowest-cost department'), value: analytics.lowestCostDepartment?.department || '—', note: analytics.lowestCostDepartment ? usd(analytics.lowestCostDepartment.totalUsd, lang) : '' },
        { label: l('نشط بدون راتب', 'Active missing payroll'), value: data.reconciliation?.activeWithoutPayroll.length ?? 0 },
      ]} footer={l(`التحويل على سعر بيع الدولار ${analytics.rate.sell} ج.م · ${analytics.rate.source} · ${analytics.rate.asOf}`, `Converted at USD sell rate EGP ${analytics.rate.sell} · ${analytics.rate.source} · ${analytics.rate.asOf}`)} />

      <div className="grid gap-3 xl:grid-cols-[.8fr_1.2fr]">
        <InsightPanel eyebrow={l('مقارنة الأقسام', 'Department comparison')} title={l('تكلفة الرواتب بالدولار', 'Payroll cost in USD')}>
          <div className="space-y-3">{analytics.departments.map((item) => <BarRow key={item.department} label={`${item.department} · ${item.employees}`} value={usd(item.totalUsd, lang)} numericValue={item.totalUsd} max={maxDepartment} accent />)}</div>
        </InsightPanel>
        <section className="hr-panel-solid overflow-hidden">
          <header className="hr-head">
            <div className="min-w-0">
              <p className="hr-eyebrow">{l('ترتيب الرواتب', 'Salary ranking')}</p>
              <h2 className="hr-title mt-1">{l('من الأعلى إلى الأقل', 'Highest and lowest')}</h2>
            </div>
            <div className="hr-seg">
              {(['high', 'low'] as const).map((item) => (
                <button key={item} type="button" aria-pressed={order === item} onClick={() => setOrder(item)} className="hr-seg-btn">
                  {item === 'high' ? l('الأعلى', 'Highest') : l('الأقل', 'Lowest')}
                </button>
              ))}
            </div>
          </header>
          <p className="border-b border-navy/[0.07] bg-surface-sunken/60 px-5 py-2 text-[11px] text-ink-muted lg:hidden">
            {l('اسحب الجدول أفقيًا لعرض EGP والتأمين.', 'Scroll the table sideways for EGP and insurance.')}
          </p>
          <div className="max-h-[620px] overflow-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="sticky top-0 z-10 bg-[#EEF3F9] text-[11px] font-semibold text-ink-muted">
                <tr>
                  <th className="px-5 py-3 text-start">{l('الموظف', 'Employee')}</th>
                  <th className="px-4 py-3 text-start">{l('القسم', 'Department')}</th>
                  <th className="px-4 py-3 text-end">USD</th>
                  <th className="px-4 py-3 text-end">EGP</th>
                  <th className="px-4 py-3 text-start">{l('التأمين', 'Insurance')}</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy/[0.06]">
                {ranking.map((row) => {
                  const employee = employeeByCode.get(row.employeeCode);
                  return (
                    <tr key={row.employeeCode} className="transition-colors hover:bg-brand-50/50">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-navy">{row.name}</div>
                        <div className="ltr text-[11px] text-ink-muted">#{row.employeeCode}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-muted">{row.department}</td>
                      {/* USD is the figure this desk is read for, so it carries the weight. */}
                      <td className="hr-num px-4 py-3 text-end text-[15px] font-semibold text-navy">{usd(row.totalUsd, lang)}</td>
                      <td className="hr-num px-4 py-3 text-end text-xs text-ink-muted">{money(row.totalEgp, lang)}</td>
                      <td className="px-4 py-3"><span className={cx('chip', employee?.hasInsurance ? 'bg-status-okBg text-status-ok' : 'bg-accent-50 text-accent-700')}>{employee?.hasInsurance ? l('مربوط', 'Linked') : l('غير موجود', 'Missing')}</span></td>
                      <td className="px-4"><Link to={`/hr/employees/${row.employeeCode}`} className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-brand-50 hover:text-brand-500" aria-label={l('فتح الملف', 'Open profile')}><ChevronRight className="rtl:rotate-180" size={17} /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function RecruitmentDesk({ data, lang, onChanged }: { data: HRDashboardData; lang: 'ar' | 'en'; onChanged: () => Promise<void> }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const { push } = useToast();
  const [filter, setFilter] = useState('active');
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [saving, setSaving] = useState('');
  const [editor, setEditor] = useState<HRRecruitmentRequest | null>(null);
  const [odoo, setOdoo] = useState<HROdooRecruitmentData | null>(null);
  const [odooLoading, setOdooLoading] = useState(true);
  const analytics = data.analytics?.recruitment;
  useEffect(() => {
    let live = true;
    api.get<HROdooRecruitmentData>('/hr/recruitment/odoo')
      .then((result) => { if (live) setOdoo(result); })
      .catch(() => { if (live) setOdoo(null); })
      .finally(() => { if (live) setOdooLoading(false); });
    return () => { live = false; };
  }, []);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.recruitment
      .filter((request) => {
        const haystack = `${request.role} ${request.department} ${request.location} ${request.assignedTo.join(' ')} ${request.interviewer}`.toLowerCase();
        return (filter === 'all' || request.status === filter)
          && (!needle || haystack.includes(needle))
          && (!fromDate || Boolean(request.activeDate && request.activeDate >= fromDate))
          && (!toDate || Boolean(request.dueDate && request.dueDate <= toDate));
      })
      .sort((left, right) => String(left.dueDate || '9999').localeCompare(String(right.dueDate || '9999')));
  }, [data.recruitment, filter, fromDate, query, toDate]);
  const updateStatus = async (request: HRRecruitmentRequest, status: string) => {
    setSaving(request.id);
    try {
      await api.patch(`/hr/recruitment/${encodeURIComponent(request.id)}`, { status });
      push(l('تم تحديث حالة الطلب.', 'Request status updated.'));
      await onChanged();
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally { setSaving(''); }
  };
  return (
    <div className="space-y-8">
      <TabSummary title={l('ملخص التوظيف', 'Recruitment summary')} items={[
        { label: l('طلبات نشطة', 'Active requests'), value: analytics?.active ?? 0 },
        { label: l('مقاعد مفتوحة', 'Open seats'), value: analytics?.openSeats ?? 0, featured: true },
        { label: l('معدل الشغل', 'Fill rate'), value: `${analytics?.fillRate ?? 0}%` },
        { label: l('متأخر', 'Overdue'), value: analytics?.overdue ?? 0 },
        { label: l('متوسط مدة التعيين', 'Average hiring cycle'), value: analytics?.averageActualDays === null || analytics?.averageActualDays === undefined ? '—' : analytics.averageActualDays, note: analytics?.averageActualDays ? l('يوم فعلي', 'actual days') : l('لا توجد تواريخ تعيين فعلية', 'No actual hire dates') },
      ]} />

      <InsightPanel eyebrow={l('مراحل الطلبات النشطة', 'Active request stages')} title={l('دورة التعيين من الشيت', 'Workbook recruitment funnel')}>
        <RecruitmentFunnel analytics={analytics} lang={lang} />
      </InsightPanel>

      <section className="hr-panel p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(15rem,1fr)_repeat(2,11rem)_auto] xl:items-end">
          <div className="relative sm:col-span-2 xl:col-span-1">
            <span className="mb-1 block text-[11px] font-bold text-ink-muted">{l('بحث', 'Search')}</span>
            <Search size={15} className="pointer-events-none absolute start-3 top-[2.15rem] text-ink-muted" />
            <input className="field ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l('الوظيفة، القسم، المسؤول أو المقابل…', 'Role, department, owner, or interviewer…')} />
          </div>
          <label><span className="mb-1 block text-[11px] font-bold text-ink-muted">{l('من تاريخ التفعيل', 'Active from')}</span><input className="field ltr" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label><span className="mb-1 block text-[11px] font-bold text-ink-muted">{l('حتى الاستحقاق', 'Due by')}</span><input className="field ltr" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
          <div className="hr-seg sm:col-span-2 xl:col-span-1">
            {['active', 'hold', 'done', 'all'].map((item) => (
              <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className="hr-seg-btn flex-1 xl:flex-none">
                {item === 'active' ? l('نشط', 'Active') : item === 'hold' ? l('معلق', 'Hold') : item === 'done' ? l('مكتمل', 'Done') : l('الكل', 'All')}
              </button>
            ))}
          </div>
        </div>
      </section>

      {!odooLoading && odoo?.configured && (
        <div className={cx('flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs leading-6', odoo.connected ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-accent-100 bg-accent-50 text-accent-700')}>
          <span><b>Odoo:</b> {odoo.connected ? l(`تم ربط ${odoo.summary.matched} من ${odoo.summary.total} وظيفة.`, `${odoo.summary.matched} of ${odoo.summary.total} roles linked.`) : l('تعذر قراءة وظائف Odoo الآن.', 'Odoo jobs are currently unavailable.')}</span>
          {odoo.connected && !odoo.applicantsAvailable && <span>{l('أعداد المرشحين تحتاج صلاحية Recruitment لحساب التكامل.', 'Candidate counts require Recruitment access for the integration account.')}</span>}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">{rows.map((request) => <RecruitmentRequestCard key={request.id} request={request} match={odoo?.matches[request.id]} lang={lang} canManage={data.permissions.canManage} saving={saving === request.id} onStatus={(status) => updateStatus(request, status)} onEdit={() => setEditor(request)} />)}</div>
      {!rows.length && <EmptyState title={l('لا توجد طلبات بهذه الحالة', 'No requests in this state')} />}
      {editor && <RecruitmentEditor request={editor} lang={lang} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await onChanged(); }} />}
    </div>
  );
}

function RecruitmentRequestCard({ request, match, lang, canManage, saving, onStatus, onEdit }: {
  request: HRRecruitmentRequest;
  match?: HROdooRecruitmentData['matches'][string];
  lang: 'ar' | 'en';
  canManage: boolean;
  saving: boolean;
  onStatus: (status: string) => void;
  onEdit: () => void;
}) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const remaining = Math.max(0, request.numberNeeded - request.accepted);
  const due = request.dueDate ? daysUntil(request.dueDate) : null;
  const overdue = request.status === 'active' && due !== null && due < 0 && remaining > 0;
  const stages = [
    [l('متطلبات', 'Requirements'), request.receivedRequirements === 'done'],
    [l('نشر', 'Published'), request.published === 'done'],
    [l('مرشحون', 'Candidates'), request.receivedCandidates === 'done'],
    [l('قبول', 'Accepted'), request.accepted > 0],
  ] as const;
  return (
    <article className={cx('hr-panel overflow-hidden', overdue && '!border-accent-500/45')}>
      {overdue && <div className="h-0.5 bg-accent-500" aria-hidden="true" />}
      <div className="flex items-start justify-between gap-4 border-b border-navy/[0.07] p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-navy">{request.role}</h2>
            <StatusChip status={request.status} lang={lang} />
            {overdue && <span className="chip bg-status-badBg text-[11px] text-status-bad">{l(`متأخر ${Math.abs(due ?? 0)} يوم`, `${Math.abs(due ?? 0)} days overdue`)}</span>}
          </div>
          <p className="mt-1.5 truncate text-xs leading-6 text-ink-muted">{request.department || '—'} · {request.location || '—'} · {request.vacancyReason || '—'}</p>
        </div>
        <div className={cx('shrink-0 border-s-2 ps-3 text-end', overdue ? 'border-accent-500' : 'border-navy/[0.09]')}>
          <b className="hr-num block text-2xl font-bold leading-none text-navy">{request.accepted}/{request.numberNeeded}</b>
          <small className="mt-1 block text-[11px] text-ink-muted">{remaining} {l('متبقي', 'remaining')}</small>
        </div>
      </div>
      <div className="p-5">
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <MiniFact label={l('المسؤول', 'Owner')} value={request.assignedTo.join('، ') || '—'} />
          <MiniFact label={l('بدء', 'Started')} value={formatDate(request.activeDate, lang)} />
          <MiniFact label={l('استحقاق', 'Due')} value={formatDate(request.dueDate, lang)} />
          <MiniFact label={l('مدة مستهدفة', 'Target cycle')} value={request.hiringPeriodDays ? `${request.hiringPeriodDays} ${l('يوم', 'days')}` : request.activeDate && request.dueDate ? `${Math.max(0, daysBetweenClient(request.activeDate, request.dueDate) ?? 0)} ${l('يوم', 'days')}` : '—'} />
        </div>
        {/* The four hiring stages, with the reached ones filled in Engosoft
            blue so the position in the cycle is readable at a glance. */}
        <ol className="mt-4 grid grid-cols-4 gap-2">
          {stages.map(([label, done], index) => (
            <li key={label} className={cx('rounded-xl px-2 py-2.5 text-center ring-1 transition-colors', done ? 'bg-navy/[0.05] ring-navy/10' : 'bg-white/60 ring-white/70')}>
              <span className={cx('mx-auto mb-1.5 grid h-5 w-5 place-items-center rounded-full border', done ? 'border-brand-500 bg-brand-500 text-white' : 'border-[#C8D5E3] text-transparent')}>{done && <Check size={11} />}</span>
              <span className={cx('block text-[10px] font-semibold leading-4', done ? 'text-navy' : 'text-ink-faint')}><span className="hr-num">0{index + 1}</span> · {label}</span>
            </li>
          ))}
        </ol>
        {request.feedback && <p className="mt-3 rounded-e-xl border-s-2 border-[#C8D5E3] bg-surface-sunken/70 px-3 py-2.5 text-xs leading-6 text-ink-muted">{request.feedback}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-navy/[0.07] pt-3">
          {match ? <a href={match.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-500 hover:underline"><ExternalLink size={14} />{l('فتح الوظيفة في Odoo', 'Open job in Odoo')}{match.applicantCount !== null && ` · ${match.applicantCount}`}</a> : <span className="text-[11px] text-ink-muted">{l('لا توجد مطابقة مؤكدة في Odoo', 'No confident Odoo match')}</span>}
          {canManage && <div className="ms-auto flex items-center gap-2"><button className="btn-quiet btn-sm !min-h-9 text-brand-500 hover:bg-brand-50 hover:text-brand-600" onClick={onEdit}><Pencil size={13} />{l('تعديل', 'Edit')}</button><select className="field !w-auto !py-1.5 text-xs" value={request.status} disabled={saving} onChange={(event) => onStatus(event.target.value)} aria-label={l('حالة الطلب', 'Request status')}><option value="active">Active</option><option value="hold">Hold</option><option value="done">Done</option></select>{saving && <Spinner size={15} />}</div>}
        </div>
      </div>
    </article>
  );
}

function RecruitmentEditor({ request, lang, onClose, onSaved }: { request: HRRecruitmentRequest; lang: 'ar' | 'en'; onClose: () => void; onSaved: () => Promise<void> }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const { push } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(() => ({
    role: request.role,
    numberNeeded: String(request.numberNeeded),
    accepted: String(request.accepted),
    department: request.department,
    vacancyReason: request.vacancyReason,
    status: request.status,
    priority: request.priority,
    seniority: request.seniority,
    location: request.location,
    assignedTo: request.assignedTo.join(', '),
    hiringPeriodDays: request.hiringPeriodDays === null ? '' : String(request.hiringPeriodDays),
    activeDate: request.activeDate || '',
    dueDate: request.dueDate || '',
    actualHiringDate: request.actualHiringDate || '',
    receivedRequirements: request.receivedRequirements,
    published: request.published,
    receivedCandidates: request.receivedCandidates,
    salaryRange: request.salaryRange,
    actualSalary: request.actualSalary,
    interviewer: request.interviewer,
    validation: request.validation,
    feedback: request.feedback,
  }));
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/hr/recruitment/${encodeURIComponent(request.id)}`, {
        ...form,
        numberNeeded: Number(form.numberNeeded || 0),
        accepted: Number(form.accepted || 0),
        hiringPeriodDays: form.hiringPeriodDays ? Number(form.hiringPeriodDays) : null,
        assignedTo: form.assignedTo.split(',').map((value) => value.trim()).filter(Boolean),
        activeDate: form.activeDate || null,
        dueDate: form.dueDate || null,
        actualHiringDate: form.actualHiringDate || null,
      });
      await onSaved();
      push(l('تم حفظ بيانات الوظيفة.', 'Recruitment request saved.'));
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally { setSaving(false); }
  };
  const stageOptions = (value: string) => <>{!['done', 'wait', 'hold'].includes(value) && <option value={value}>{value || '—'}</option>}<option value="done">Done</option><option value="wait">Wait</option><option value="hold">Hold</option></>;
  const input = (key: string, label: string, type = 'text') => <label><span className="label">{label}</span><input className="field" type={type} value={form[key]} onChange={(event) => set(key, event.target.value)} /></label>;
  return <Modal open onClose={onClose} title={l('تعديل طلب التوظيف', 'Edit recruitment request')} width="xl" footer={<><button className="btn-ghost" onClick={onClose}>{l('إلغاء', 'Cancel')}</button><button className="btn-primary" onClick={() => void save()} disabled={saving}>{saving ? <Spinner size={16} /> : <Check size={16} />}{l('حفظ', 'Save')}</button></>}><div className="grid max-h-[70dvh] gap-3 overflow-y-auto pe-1 sm:grid-cols-2 lg:grid-cols-3">{input('role', l('الوظيفة', 'Role'))}{input('department', l('القسم', 'Department'))}{input('location', l('الموقع', 'Location'))}{input('numberNeeded', l('العدد المطلوب', 'Needed'), 'number')}{input('accepted', l('تم قبوله', 'Accepted'), 'number')}<label><span className="label">{l('الحالة', 'Status')}</span><select className="field" value={form.status} onChange={(event) => set('status', event.target.value)}><option value="active">Active</option><option value="hold">Hold</option><option value="done">Done</option></select></label>{input('activeDate', l('تاريخ التفعيل', 'Active date'), 'date')}{input('dueDate', l('تاريخ الاستحقاق', 'Due date'), 'date')}{input('actualHiringDate', l('تاريخ التعيين الفعلي', 'Actual hire date'), 'date')}{input('hiringPeriodDays', l('مدة التعيين بالأيام', 'Hiring period days'), 'number')}{input('assignedTo', l('المسؤولون بفاصلة', 'Owners, comma separated'))}{input('interviewer', l('المقابل', 'Interviewer'))}{input('priority', l('الأولوية', 'Priority'))}{input('seniority', l('المستوى', 'Seniority'))}{input('vacancyReason', l('سبب الشاغر', 'Vacancy reason'))}{input('salaryRange', l('نطاق الراتب', 'Salary range'))}{input('actualSalary', l('الراتب الفعلي', 'Actual salary'))}{input('validation', l('الاعتماد', 'Validation'))}<label><span className="label">{l('استلام المتطلبات', 'Requirements')}</span><select className="field" value={form.receivedRequirements} onChange={(event) => set('receivedRequirements', event.target.value)}>{stageOptions(form.receivedRequirements)}</select></label><label><span className="label">{l('النشر', 'Published')}</span><select className="field" value={form.published} onChange={(event) => set('published', event.target.value)}>{stageOptions(form.published)}</select></label><label><span className="label">{l('استلام المرشحين', 'Candidates received')}</span><select className="field" value={form.receivedCandidates} onChange={(event) => set('receivedCandidates', event.target.value)}>{stageOptions(form.receivedCandidates)}</select></label><label className="sm:col-span-2 lg:col-span-3"><span className="label">{l('الملاحظات', 'Feedback')}</span><textarea className="field min-h-24" value={form.feedback} onChange={(event) => set('feedback', event.target.value)} /></label></div></Modal>;
}

function OrganizationDesk({ data, lang }: { data: HRDashboardData; lang: 'ar' | 'en' }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const [query, setQuery] = useState('');
  const analytics = data.analytics?.organization;
  const needle = query.trim().toLowerCase();
  const positions = data.organization.filter((position) => !needle || `${position.title} ${position.employeeName} ${position.departmentCode}`.toLowerCase().includes(needle));
  const ids = new Set(positions.map((position) => position.id));
  const roots = positions.filter((position) => !position.managerPositionId || !ids.has(position.managerPositionId));
  const children = new Map<string, HROrganizationPosition[]>();
  positions.forEach((position) => {
    if (!position.managerPositionId) return;
    children.set(position.managerPositionId, [...(children.get(position.managerPositionId) ?? []), position]);
  });
  return (
    <div className="space-y-8">
      <TabSummary title={l('ملخص الهيكل', 'Organization summary')} items={[
        { label: l('إجمالي المناصب', 'Total positions'), value: analytics?.total ?? data.summary.organizationPositions },
        { label: l('مرتبط بموظف', 'Matched to employee'), value: analytics?.matched ?? 0, featured: true },
        { label: l('شواغر', 'Vacant'), value: analytics?.vacant ?? data.summary.organizationVacancies },
        { label: l('يحتاج مطابقة', 'Needs matching'), value: analytics?.unmatched ?? 0 },
        { label: l('أقسام', 'Departments'), value: analytics?.departments ?? 0 },
      ]} />
      <section className="hr-panel-solid overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-navy/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="hr-eyebrow">{l('خطوط الإدارة', 'Reporting lines')}</p>
            <h2 className="hr-title mt-1">{l('خريطة المسؤولية', 'Accountability map')}</h2>
          </div>
          <div className="relative sm:w-80">
            <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input className="field ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l('ابحث في الهيكل…', 'Search structure…')} aria-label={l('ابحث في الهيكل', 'Search structure')} />
          </div>
        </div>
        {/* Legend first — three states, three colours, stated once. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-navy/[0.07] bg-surface-sunken/60 px-4 py-2.5 text-[11px] font-semibold text-ink-muted">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />{l('مرتبط بموظف', 'Matched')}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent-500" />{l('شاغر', 'Vacant')}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-status-bad" />{l('يحتاج مطابقة', 'Needs matching')}</span>
        </div>
        <div className="max-h-[68dvh] overflow-auto bg-[linear-gradient(#EAF0F7_1px,transparent_1px),linear-gradient(90deg,#EAF0F7_1px,transparent_1px)] bg-[size:24px_24px] p-4 sm:p-6">{roots.map((root) => <OrgNode key={root.id} node={root} children={children} lang={lang} depth={0} />)}</div>
      </section>
    </div>
  );
}

function OrgNode({ node, children, lang, depth }: { node: HROrganizationPosition; children: Map<string, HROrganizationPosition[]>; lang: 'ar' | 'en'; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const branch = children.get(node.id) ?? [];
  return (
    <div className={cx(depth > 0 && 'ms-4 border-s border-[#DCE6F1] ps-3 sm:ms-8 sm:ps-4')}>
      <div className="hr-stat mb-2 flex items-center gap-2 p-2.5 sm:p-3">
        <button
          type="button"
          className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors', branch.length ? 'bg-brand-50 text-brand-500 hover:bg-brand-100' : 'text-transparent')}
          onClick={() => branch.length && setOpen((value) => !value)}
          aria-expanded={branch.length ? open : undefined}
          aria-label={branch.length ? (lang === 'en' ? 'Toggle reports' : 'طي أو فتح المرؤوسين') : undefined}
        >
          {branch.length ? <ChevronDown size={15} className={cx('transition-transform', !open && '-rotate-90 rtl:rotate-90')} /> : null}
        </button>
        <span className={cx('h-8 w-1 shrink-0 rounded-full', node.matchState === 'matched' ? 'bg-brand-500' : node.matchState === 'vacant' ? 'bg-accent-500' : 'bg-status-bad')} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-navy" title={node.title}>{node.title}</div>
          <div className="truncate text-[11px] leading-5 text-ink-muted">{node.employeeName || (lang === 'en' ? 'Vacant position' : 'منصب شاغر')} · {node.departmentCode}</div>
        </div>
        {node.employeeCode && <Link className="ltr shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-brand-500 hover:bg-brand-50 hover:underline" to={`/hr/employees/${node.employeeCode}`}>#{node.employeeCode}</Link>}
      </div>
      {open && branch.map((child) => <OrgNode key={child.id} node={child} children={children} lang={lang} depth={depth + 1} />)}
    </div>
  );
}

function ImportDesk({ data, lang, uploading, onUpload }: { data: HRDashboardData; lang: 'ar' | 'en'; uploading: HRSource | null; onUpload: (source: HRSource, event: ChangeEvent<HTMLInputElement>) => void }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const quality = data.reconciliation;
  const ready = data.datasets.filter((dataset) => dataset.importedAt).length;
  const warnings = data.datasets.reduce((sum, dataset) => sum + dataset.warnings.length, 0);
  const qualityIssues = quality ? Object.values(quality).reduce((sum, items) => sum + items.length, 0) : 0;
  const latest = [...data.datasets].filter((dataset) => dataset.importedAt).sort((left, right) => String(right.importedAt).localeCompare(String(left.importedAt)))[0];
  return (
    <div className="space-y-8">
      <TabSummary title={l('ملخص تحديث البيانات', 'Data sync summary')} items={[
        { label: l('مصادر جاهزة', 'Ready sources'), value: `${ready}/${data.datasets.length}`, featured: true },
        { label: l('تحذيرات الاستيراد', 'Import warnings'), value: warnings },
        { label: l('فروق المطابقة', 'Reconciliation gaps'), value: qualityIssues },
        { label: l('آخر مصدر', 'Latest source'), value: latest ? HR_SOURCE_LABELS[latest.source][lang] : '—', note: latest ? formatDateTime(latest.importedAt, lang) : '' },
        { label: l('بوت الرواتب', 'Payroll bot'), value: data.telegram?.enabled ? l('متصل', 'Connected') : l('يحتاج إعداد', 'Needs setup') },
      ]} />
      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-3 sm:grid-cols-2">
          {data.datasets.map((dataset) => <ImportCard key={dataset.source} dataset={dataset} lang={lang} busy={uploading === dataset.source} disabled={Boolean(uploading)} onUpload={(event) => onUpload(dataset.source, event)} />)}
        </div>
        <aside className="space-y-3">
          <div className="overflow-hidden rounded-[20px] bg-navy p-5 text-white shadow-[0_24px_50px_-30px_rgba(11,37,69,0.85)]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/80"><Bot size={22} /></span>
              <span className={cx('chip', data.telegram?.enabled ? 'bg-white/15 text-white' : 'bg-white/10 text-white/60')}>{data.telegram?.enabled ? l('متصل', 'Connected') : l('يحتاج إعداد', 'Needs setup')}</span>
            </div>
            <h2 className="mt-4 font-extrabold">{l('قناة Telegram للرواتب', 'Telegram payroll channel')}</h2>
            <p className="mt-2 text-xs leading-6 text-white/70">{l('البوت يقبل نفس ملفات Excel، يتحقق من الشات والسر، ثم يشغّل نفس مسار المطابقة المستخدم داخل الداشبورد.', 'The bot accepts the same Excel files, verifies chat and secret, then uses the exact dashboard reconciliation path.')}</p>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[.06] p-3 text-[11px] leading-6 text-white/75"><code className="ltr block font-semibold text-accent-400">POST /api/hr/telegram</code><span>{l('Secret + Chat allowlist + .xlsx فقط', 'Secret + chat allowlist + .xlsx only')}</span></div>
          </div>
          {quality && <div className="hr-panel p-5"><div className="flex items-center gap-2"><ListFilter size={18} className="text-accent-500" /><h2 className="hr-title">{l('طابور المراجعة', 'Review queue')}</h2></div><QualityMini reconciliation={quality} lang={lang} /></div>}
        </aside>
      </section>
      <div className="rounded-xl border border-navy/[0.09] bg-surface-sunken/80 px-4 py-3 text-xs leading-6 text-ink-muted"><b>{l('قاعدة الاستيراد:', 'Import rule:')}</b> {l('كود الموظف هو المفتاح. الاسم لا يدمج سجلين تلقائيًا، واستبدال شيت لا يحذف تاريخ الاستيراد أو رابط حساب Qodo.', 'Employee code is the key. Names never auto-merge records, and replacing a sheet does not remove import history or Qodo account links.')}</div>
    </div>
  );
}

function ImportCard({ dataset, lang, busy, disabled, onUpload }: { dataset: HRDatasetMeta; lang: 'ar' | 'en'; busy: boolean; disabled: boolean; onUpload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const Icon = SOURCE_ICONS[dataset.source];
  const meta = HR_SOURCE_LABELS[dataset.source];
  const ready = Boolean(dataset.importedAt);
  return (
    <article className={cx('hr-panel relative flex flex-col overflow-hidden p-5', ready && 'ring-1 ring-brand-500/25')}>
      <div className="flex items-start justify-between gap-3">
        <span className={cx(ready ? 'text-brand-600' : 'text-ink-faint')}><Icon size={20} /></span>
        <span className={cx('chip', ready ? 'bg-status-okBg text-status-ok' : 'bg-surface-sunken text-ink-faint')}>{ready ? (lang === 'en' ? 'Ready' : 'متصل') : (lang === 'en' ? 'Missing' : 'ناقص')}</span>
      </div>
      <h2 className="mt-4 font-extrabold text-navy">{meta[lang]}</h2>
      <p className="mt-1 text-xs leading-6 text-ink-muted">{lang === 'en' ? meta.hintEn : meta.hintAr}</p>
      {ready && (
        <div className="mt-3 rounded-xl border border-navy/[0.07] bg-surface-sunken/70 p-3">
          <div className="truncate text-[11px] font-bold text-ink" title={dataset.fileName}>{dataset.fileName}</div>
          <div className="mt-1 text-[11px] text-ink-muted">{formatDateTime(dataset.importedAt, lang)} · {dataset.origin === 'telegram' ? 'Telegram' : 'Dashboard'}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(dataset.summary ?? {}).slice(0, 3).map(([key, value]) => <span key={key} className="ltr rounded-md bg-white px-2 py-1 text-[10px] text-ink-muted">{key}: <b className="hr-num">{Number(value).toLocaleString()}</b></span>)}</div>
        </div>
      )}
      <label className={cx('btn-ghost btn-sm mt-4 w-full cursor-pointer self-end', disabled && 'pointer-events-none opacity-50')}><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onUpload} />{busy ? <Spinner size={16} /> : <UploadCloud size={16} />}{busy ? (lang === 'en' ? 'Analysing…' : 'جارٍ التحليل…') : ready ? (lang === 'en' ? 'Replace workbook' : 'استبدال الشيت') : (lang === 'en' ? 'Upload workbook' : 'رفع الشيت')}</label>
    </article>
  );
}

export function HREmployee() {
  const { employeeCode = '' } = useParams();
  const { lang } = useI18n();
  const { push } = useToast();
  const [employee, setEmployee] = useState<HREmployeeProfile | null>(null);
  const [dashboard, setDashboard] = useState<HRDashboardData | null>(null);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<'master' | 'payroll' | 'insurance' | 'bank' | null>(null);
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const load = async () => {
    try {
      const [profile, meta] = await Promise.all([
        api.get<{ employee: HREmployeeProfile }>(`/hr/employees/${employeeCode}`),
        api.get<HRDashboardData>('/hr/dashboard'),
      ]);
      setEmployee(profile.employee);
      setDashboard(meta);
      setError('');
    } catch (requestError) {
      setError(errorMessage(requestError, lang));
    }
  };
  useEffect(() => { void load(); }, [employeeCode]);
  if (!employee && !error) return <HRLoading />;
  if (!employee) return <EmptyState title={l('الملف غير متاح', 'Profile unavailable')} body={error} action={<Link className="btn-ghost" to="/hr">{l('رجوع إلى HR', 'Back to HR')}</Link>} />;
  const name = employee.nameArabic || employee.nameEnglish || `#${employee.employeeCode}`;
  const canManage = Boolean(dashboard?.permissions.canManage);
  const canPayroll = Boolean(employee.payroll || dashboard?.permissions.canViewPayroll);
  return (
    <div className="hr-suite mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 sm:py-8">
      <Link to="/hr" className="mb-4 inline-flex items-center gap-2 rounded-lg text-xs font-bold text-ink-muted transition-colors hover:text-navy">{lang === 'en' ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}{l('العودة إلى الموارد البشرية', 'Back to HR')}</Link>
      <header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-ink-faint">
          <span>{l('سجل الموظف الموحّد', 'Unified employee record')}</span>
          <span className="ltr ms-auto tracking-[0.12em]">EMP-{employee.employeeCode}</span>
        </div>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={name} color="#1D6FB8" size={64} className="shrink-0 shadow-[0_10px_24px_-12px_rgba(11,37,69,0.55)] ring-4 ring-white/70" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><StatusChip status={employee.status} lang={lang} /></div>
              <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-navy sm:text-[32px]">{name}</h1>
              <p className="mt-1 truncate text-sm leading-6 text-ink-muted">{employee.title || '—'} · {employee.department || employee.sector || '—'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">{canManage && <button className="btn-navy btn-sm" onClick={() => setEditor('master')}><Pencil size={16} />{l('تعديل الملف', 'Edit profile')}</button>}</div>
        </div>
      </header>

      <section className="mt-8 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,.65fr)]">
        <div className="space-y-3">
          <ProfileSection icon={BriefcaseBusiness} title={l('البيانات الوظيفية', 'Employment')} action={canManage ? <EditButton onClick={() => setEditor('master')} lang={lang} /> : null}>
            <FactGrid items={[
              [l('المسمى الوظيفي', 'Job title'), employee.title], [l('القسم', 'Department'), employee.department],
              [l('القطاع', 'Sector'), employee.sector], [l('المدير المباشر', 'Direct manager'), employee.directManager],
              [l('تاريخ التعيين', 'Hiring date'), formatDate(employee.hiringDate, lang)], [l('نوع العمل', 'Work type'), employee.workType],
              [l('الوردية', 'Shift'), employee.shiftStart || employee.shiftEnd ? `${employee.shiftStart} — ${employee.shiftEnd}` : '—'],
              [l('ساعات أسبوعية', 'Weekly hours'), employee.weeklyHours ? String(employee.weeklyHours) : '—'],
            ]} />
          </ProfileSection>
          <ProfileSection icon={IdCard} title={l('الهوية والتواصل', 'Identity & contact')}>
            <FactGrid items={[
              [l('الإيميل الوظيفي', 'Company email'), employee.companyEmail], [l('الإيميل الشخصي', 'Personal email'), employee.personalEmail],
              [l('الموبايل', 'Mobile'), employee.mobile], [l('الرقم القومي', 'National ID'), employee.nationalId],
              [l('تاريخ الميلاد', 'Birth date'), formatDate(employee.birthDate, lang)], [l('النوع', 'Gender'), employee.gender],
              [l('العنوان', 'Address'), employee.address], [l('الحالة الاجتماعية', 'Marital status'), employee.maritalStatus],
            ]} />
          </ProfileSection>
          {canPayroll && <ProfileSection icon={Banknote} title={l('الراتب الحالي', 'Current payroll')} action={canManage && dashboard?.permissions.canViewPayroll ? <EditButton onClick={() => setEditor('payroll')} lang={lang} /> : null}>
            {employee.payroll ? <div className="grid gap-3 sm:grid-cols-3"><MoneyBlock label={l('الأساسي', 'Base')} value={employee.payroll.baseSalary} lang={lang} /><MoneyBlock label="KPI" value={employee.payroll.kpiAmount} lang={lang} /><MoneyBlock label={l('الإجمالي', 'Total')} value={employee.payroll.totalSalary} lang={lang} primary /></div> : <MissingData text={l('لا يوجد سجل راتب مرتبط بهذا الكود.', 'No payroll row is linked to this code.')} />}
          </ProfileSection>}
          {canPayroll && <ProfileSection icon={ShieldCheck} title={l('التأمينات والضرائب', 'Insurance & tax')} action={canManage && dashboard?.permissions.canViewPayroll ? <EditButton onClick={() => setEditor('insurance')} lang={lang} /> : null}>
            {employee.insurance ? <FactGrid items={[
              [l('الرقم التأميني', 'Insurance number'), String(employee.insurance.insuranceNumber || '—')],
              [l('الحالة', 'Status'), String(employee.insurance.status || '—')],
              [l('أجر الاشتراك', 'Contribution salary'), money(employee.insurance.subscriptionSalary as number, lang)],
              [l('حصة الموظف', 'Employee share'), money(employee.insurance.employeeShare as number, lang)],
              [l('حصة الشركة', 'Employer share'), money(employee.insurance.employerShare as number, lang)],
              [l('الضريبة الشهرية', 'Monthly tax'), money(employee.insurance.monthlyTax as number, lang)],
            ]} /> : <MissingData text={l('لا يوجد سجل تأمين مرتبط بهذا الكود.', 'No insurance row is linked to this code.')} />}
          </ProfileSection>}
        </div>

        <aside className="space-y-3">
          <ProfileSection icon={FileCheck2} title={l('اكتمال المستندات', 'Document readiness')}>
            <DocumentChecklist documents={employee.documents} lang={lang} />
          </ProfileSection>
          <ProfileSection icon={Landmark} title={l('الحساب البنكي', 'Banking')} action={canManage && dashboard?.permissions.canViewPayroll ? <EditButton onClick={() => setEditor('bank')} lang={lang} /> : null}>
            <FactGrid compact items={[[l('البنك', 'Bank'), employee.bankName], [l('الحالة', 'Status'), employee.bankStatus], [l('رقم الحساب', 'Account'), employee.bankAccount]]} />
          </ProfileSection>
          <ProfileSection icon={Link2} title={l('ربط حساب Qodo', 'Qodo account link')}>
            {dashboard?.permissions.canManage ? <AccountLink employee={employee} dashboard={dashboard} lang={lang} onSaved={load} /> : <div className="text-sm text-ink-muted">{employee.linkedUserId ? l('حسابك مربوط بهذا الملف.', 'Your account is linked to this profile.') : l('الملف غير مربوط بحساب دخول.', 'No sign-in account is linked.')}</div>}
          </ProfileSection>
          <ProfileSection icon={Database} title={l('مصادر الملف', 'Profile sources')}>
            <div className="grid grid-cols-2 gap-2">{Object.entries(employee.sources).map(([source, active]) => <div key={source} className={cx('rounded-lg border px-3 py-2 text-xs font-bold', active ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-navy/[0.09] bg-surface-sunken text-ink-faint')}>{active ? '✓' : '—'} {source}</div>)}</div>
          </ProfileSection>
        </aside>
      </section>
      <EmployeeEditor open={Boolean(editor)} section={editor} employee={employee} lang={lang} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await load(); push(l('تم حفظ بيانات الموظف.', 'Employee record saved.')); }} />
    </div>
  );
}

function ProfileSection({ icon: Icon, title, action, children }: { icon: typeof UsersRound; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="hr-panel overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-navy/[0.07] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-brand-600"><Icon size={17} /></span>
          <h2 className="hr-title truncate">{title}</h2>
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function EditButton({ onClick, lang }: { onClick: () => void; lang: 'ar' | 'en' }) { return <button className="btn-quiet btn-sm" onClick={onClick}><Pencil size={14} />{lang === 'en' ? 'Edit' : 'تعديل'}</button>; }

function FactGrid({ items, compact = false }: { items: Array<[string, string | number | null | undefined]>; compact?: boolean }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-4', !compact && 'sm:grid-cols-2')}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[11px] font-bold leading-5 text-ink-faint">{label}</dt>
          <dd className="mt-1 break-words text-sm font-semibold leading-6 text-ink">{value === null || value === undefined || value === '' ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MoneyBlock({ label, value, lang, primary }: { label: string; value: number | null; lang: 'ar' | 'en'; primary?: boolean }) {
  return (
    <div className={cx('hr-stat relative p-4', primary && 'ring-1 ring-brand-500/25')}>
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className={cx('hr-num mt-2 font-semibold text-navy', primary ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl')}>{money(value, lang)}</div>
    </div>
  );
}
function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/55 p-3 ring-1 ring-white/70">
      <div className="text-[11px] font-semibold text-ink-muted">{label}</div>
      <div className="mt-1 truncate font-semibold text-navy" title={value}>{value}</div>
    </div>
  );
}
function MissingData({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-[#C8D5E3] bg-surface-sunken/70 p-4 text-sm leading-6 text-ink-muted">{text}</div>;
}

function DocumentChecklist({ documents, lang }: { documents: Record<string, boolean | number | string | null>; lang: 'ar' | 'en' }) {
  const ignored = new Set(['completionRate', 'collectionStatus']);
  const rows = Object.entries(documents).filter(([key]) => !ignored.has(key));
  const done = rows.filter(([, value]) => Boolean(value)).length;
  const rate = typeof documents.completionRate === 'number' ? Math.round(documents.completionRate * 100) : coverage(done, rows.length);
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <span className="text-xs font-bold text-ink-muted">{lang === 'en' ? 'Ready' : 'مكتمل'}</span>
        <b className="hr-num text-2xl font-semibold text-navy">{rate}%</b>
      </div>
      <div className="hr-meter mt-2.5">
        <span className="transition-[width] duration-500" style={{ width: `${Math.min(100, rate)}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {rows.map(([key, value]) => (
          <div key={key} className={cx('flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold', value ? 'bg-status-okBg text-status-ok' : 'bg-surface-sunken text-ink-faint')}>
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border">{value ? <Check size={10} /> : null}</span>
            <span className="truncate" title={key}>{key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountLink({ employee, dashboard, lang, onSaved }: { employee: HREmployeeProfile; dashboard: HRDashboardData; lang: 'ar' | 'en'; onSaved: () => Promise<void> }) {
  const { push } = useToast();
  const [value, setValue] = useState(employee.linkedUserId ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await api.put(`/hr/employees/${employee.employeeCode}/link`, { userId: value || null }); await onSaved(); push(lang === 'en' ? 'Account link saved.' : 'تم حفظ ربط الحساب.'); } catch (error) { push(errorMessage(error, lang), 'bad'); } finally { setSaving(false); } };
  return <div className="space-y-2"><select className="field" value={value} onChange={(event) => setValue(event.target.value)}><option value="">— {lang === 'en' ? 'No account' : 'بدون حساب'} —</option>{dashboard.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.email}</option>)}</select><button className="btn-ghost btn-sm w-full" onClick={() => void save()} disabled={saving}>{saving ? <Spinner size={15} /> : <Link2 size={15} />}{lang === 'en' ? 'Save link' : 'حفظ الربط'}</button></div>;
}

function EmployeeEditor({ open, section, employee, lang, onClose, onSaved }: { open: boolean; section: 'master' | 'payroll' | 'insurance' | 'bank' | null; employee: HREmployeeProfile; lang: 'ar' | 'en'; onClose: () => void; onSaved: () => Promise<void> }) {
  const { push } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  useEffect(() => {
    if (!section || !open) return;
    const source: Record<string, unknown> = section === 'payroll'
      ? (employee.payroll ?? {}) as unknown as Record<string, unknown>
      : section === 'insurance'
        ? employee.insurance ?? {}
        : employee as unknown as Record<string, unknown>;
    const keys = section === 'master' ? ['nameArabic', 'nameEnglish', 'title', 'department', 'directManager', 'workType', 'companyEmail', 'mobile'] : section === 'payroll' ? ['baseSalary', 'kpiAmount', 'totalSalary'] : section === 'insurance' ? ['insuredSalary', 'subscriptionSalary', 'employeeShare', 'employerShare', 'monthlyTax'] : ['bankName', 'bankStatus', 'bankAccount'];
    setForm(Object.fromEntries(keys.map((key) => [key, String(source[key] ?? '')])));
  }, [employee, open, section]);
  if (!section) return null;
  const numeric = new Set(['baseSalary', 'kpiAmount', 'totalSalary', 'insuredSalary', 'subscriptionSalary', 'employeeShare', 'employerShare', 'monthlyTax']);
  const label: Record<string, { ar: string; en: string }> = { nameArabic: { ar: 'الاسم بالعربي', en: 'Arabic name' }, nameEnglish: { ar: 'الاسم بالإنجليزي', en: 'English name' }, title: { ar: 'المسمى الوظيفي', en: 'Job title' }, department: { ar: 'القسم', en: 'Department' }, directManager: { ar: 'المدير المباشر', en: 'Direct manager' }, workType: { ar: 'نوع العمل', en: 'Work type' }, companyEmail: { ar: 'الإيميل الوظيفي', en: 'Company email' }, mobile: { ar: 'الموبايل', en: 'Mobile' }, baseSalary: { ar: 'المرتب الأساسي', en: 'Base salary' }, kpiAmount: { ar: 'قيمة KPI', en: 'KPI amount' }, totalSalary: { ar: 'الإجمالي', en: 'Total salary' }, insuredSalary: { ar: 'الراتب التأميني', en: 'Insured salary' }, subscriptionSalary: { ar: 'أجر الاشتراك', en: 'Contribution salary' }, employeeShare: { ar: 'حصة الموظف', en: 'Employee share' }, employerShare: { ar: 'حصة الشركة', en: 'Employer share' }, monthlyTax: { ar: 'الضريبة الشهرية', en: 'Monthly tax' }, bankName: { ar: 'اسم البنك', en: 'Bank name' }, bankStatus: { ar: 'حالة الحساب', en: 'Account status' }, bankAccount: { ar: 'رقم الحساب', en: 'Account number' } };
  const save = async () => { setSaving(true); try { const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, numeric.has(key) ? (value === '' ? null : Number(value)) : value.trim()])); await api.patch(`/hr/employees/${employee.employeeCode}/${section}`, payload); await onSaved(); } catch (error) { push(errorMessage(error, lang), 'bad'); } finally { setSaving(false); } };
  return <Modal open={open} onClose={onClose} title={l('تعديل بيانات الموظف', 'Edit employee record')} width="lg" footer={<><button className="btn-ghost" onClick={onClose}>{l('إلغاء', 'Cancel')}</button><button className="btn-primary" onClick={() => void save()} disabled={saving}>{saving ? <Spinner size={16} /> : <Check size={16} />}{l('حفظ التعديل', 'Save changes')}</button></>}><div className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-xs leading-6 text-brand-800">{l('التعديل يُحفظ في نفس مصدر الشيت ويظهر في الملف الموحّد فورًا. رفع شيت أحدث سيستبدل قيم هذا المصدر.', 'The edit is saved in the same source and appears immediately. A newer workbook will replace values from that source.')}</div><div className="grid gap-3 sm:grid-cols-2">{Object.keys(form).map((key) => <label key={key}><span className="label">{label[key]?.[lang] ?? key}</span><input className="field" type={numeric.has(key) ? 'number' : 'text'} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div></Modal>;
}

function coverage(part: number, total: number) { return total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0; }

/**
 * Arabic keeps its own month and currency names, but takes Latin digits.
 *
 * `ar-EG` alone renders Arabic-Indic numerals, which makes a salary column
 * hard to scan and impossible to line up against the English view of the
 * same table. `-u-nu-latn` changes the numeral system only — the values,
 * the rounding, and the currency are untouched.
 */
const NUM_LOCALE = { ar: 'ar-EG-u-nu-latn', en: 'en-US' } as const;
const DATE_LOCALE = { ar: 'ar-EG-u-nu-latn', en: 'en-GB' } as const;

function usd(value: number | null | undefined, lang: 'ar' | 'en') { if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'; return new Intl.NumberFormat(NUM_LOCALE[lang], { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value)); }
function money(value: number | null | undefined, lang: 'ar' | 'en') { if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'; return new Intl.NumberFormat(NUM_LOCALE[lang], { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(Number(value)); }
function formatMonth(value: string | null | undefined, lang: 'ar' | 'en') { if (!value) return '—'; const date = new Date(`${value}-01T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(DATE_LOCALE[lang], { month: 'long', year: 'numeric' }).format(date); }
function daysBetweenClient(from: string, to: string) { const start = Date.parse(`${from}T12:00:00Z`); const end = Date.parse(`${to}T12:00:00Z`); return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86_400_000) : null; }
function daysUntil(value: string) { return daysBetweenClient(new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }), value); }
function formatDate(value: string | null | undefined, lang: 'ar' | 'en') { if (!value) return '—'; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: 'medium' }).format(date); }
function formatDateTime(value: string | null | undefined, lang: 'ar' | 'en') { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
