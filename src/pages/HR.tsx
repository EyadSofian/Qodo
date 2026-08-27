import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
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
  Sparkles,
  UploadCloud,
  UsersRound,
  WalletCards,
  X,
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
  type HRRecruitmentRequest,
  type HRSource,
} from '../lib/hr';

type HRTab = 'overview' | 'people' | 'payroll' | 'recruitment' | 'kpi' | 'organization' | 'imports';

const TABS: Array<{ id: HRTab; ar: string; en: string; icon: typeof UsersRound }> = [
  { id: 'overview', ar: 'نظرة عامة', en: 'Overview', icon: Sparkles },
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
  hold: 'bg-status-warnBg text-accent-600',
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
    <div className="mx-auto w-full max-w-[1500px] pb-12">
      <section className="relative isolate overflow-hidden rounded-[28px] bg-[#0B2545] px-5 py-6 text-white shadow-panel sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden="true">
          <div className="absolute -end-24 -top-32 h-80 w-80 rounded-full border-[42px] border-[#4A8FCB]/20" />
          <div className="absolute -bottom-36 start-1/3 h-64 w-64 rounded-full bg-[#F5821F]/15 blur-3xl" />
          <div className="absolute inset-y-0 start-0 w-1/2 bg-[linear-gradient(115deg,rgba(255,255,255,.06),transparent_70%)]" />
        </div>
        <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-bold tracking-[0.12em] text-brand-100 backdrop-blur">
              <Fingerprint size={14} />
              {l('ملف واحد لكل موظف', 'ONE FILE PER EMPLOYEE')}
            </div>
            <h1 className="max-w-3xl text-2xl font-extrabold leading-tight sm:text-4xl">
              {l('كل بيانات الموظفين في مكان واحد', 'All your people data in one place')}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/70 sm:text-[15px]">
              {l(
                'البيانات الوظيفية والرواتب والتأمينات والتوظيف والهيكل، كلها مربوطة بكود الموظف. وكل تحديث تعرف مصدره وتاريخه.',
                'Records, payroll, insurance, recruitment and the org chart are all linked to the employee code — and every update shows where it came from and when.'
              )}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <HeroMetric label={l('موظف نشط', 'Active people')} value={data.summary.active} />
            <HeroMetric label={l('على كشف الرواتب', 'On payroll')} value={data.summary.payroll} />
            <HeroMetric label={l('مصادر متصلة', 'Sources ready')} value={readySources} suffix="/5" />
            <HeroMetric label={l('شواغر مفتوحة', 'Open seats')} value={data.summary.openPositions} accent />
          </div>
        </div>
      </section>

      <nav className="no-scrollbar -mx-1 mt-5 flex gap-2 overflow-x-auto px-1 pb-2" aria-label={l('أقسام الموارد البشرية', 'HR sections')}>
        {shownTabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cx(
                'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-bold transition-all',
                tab === item.id
                  ? 'border-[#1D6FB8] bg-[#1D6FB8] text-white shadow-md'
                  : 'border-surface-line bg-white/80 text-ink-muted hover:-translate-y-0.5 hover:border-brand-300 hover:text-[#1D6FB8]'
              )}
            >
              <Icon size={16} />
              {l(item.ar, item.en)}
            </button>
          );
        })}
        <button type="button" onClick={() => void load()} className="btn-ghost btn-sm ms-auto shrink-0" aria-label={l('تحديث', 'Refresh')}>
          <RefreshCw size={15} />
        </button>
      </nav>

      <div className="mt-3 animate-fade-up" key={tab}>
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
    <div className="space-y-5">
      <div className="skeleton h-64 rounded-[28px]" />
      <div className="flex gap-2">{Array.from({ length: 5 }, (_, index) => <div key={index} className="skeleton h-11 w-32" />)}</div>
      <div className="grid gap-4 lg:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="skeleton h-52" />)}</div>
    </div>
  );
}

function HeroMetric({ label, value, suffix, accent }: { label: string; value: number; suffix?: string; accent?: boolean }) {
  return (
    <div className={cx('rounded-2xl border px-4 py-3 backdrop-blur', accent ? 'border-[#F5821F]/40 bg-[#F5821F]/15' : 'border-white/10 bg-white/[.07]')}>
      <div className="text-[11px] font-semibold text-white/60">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}<span className="text-sm text-white/50">{suffix}</span></div>
    </div>
  );
}

function Overview({ data, lang, onOpen }: { data: HRDashboardData; lang: 'ar' | 'en'; onOpen: (tab: HRTab) => void }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const reconciliation = data.reconciliation;
  const qualityIssues = reconciliation
    ? Object.values(reconciliation).reduce((sum, items) => sum + items.length, 0)
    : 0;
  const activeRecruitment = data.recruitment.filter((request) => request.status === 'active').slice(0, 4);
  const missingSources = data.datasets.filter((dataset) => !dataset.importedAt);

  if (data.permissions.selfOnly) {
    return (
      <div className="card overflow-hidden p-6 sm:p-8">
        <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-bold text-[#1D6FB8]">{l('ملفك الشخصي في HR', 'Your HR profile')}</p>
            <h2 className="mt-2 text-2xl font-extrabold">{l('كل بياناتك الوظيفية في مكان واحد', 'All your employment data in one place')}</h2>
            <p className="mt-2 max-w-xl text-sm leading-7 text-ink-muted">
              {l('البيانات الشخصية والوظيفة والراتب والتأمين والمستندات لا يراها هنا إلا أنت وفريق HR المخوّل.', 'Personal, employment, payroll, insurance, and documents are visible only to you and authorised HR staff.')}
            </p>
          </div>
          {data.employees[0] ? (
            <Link className="btn-primary" to={`/hr/employees/${data.employees[0].employeeCode}`}>
              <IdCard size={18} /> {l('افتح ملفي', 'Open my profile')}
            </Link>
          ) : (
            <div className="rounded-xl bg-status-warnBg px-4 py-3 text-sm font-semibold text-accent-600">
              {l('حسابك لم يُربط بكود موظف بعد.', 'Your account is not linked to an employee code yet.')}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,.55fr)]">
      <div className="space-y-4">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard icon={UsersRound} label={l('إجمالي السجل', 'Employee records')} value={data.summary.employees} hint={l(`${data.summary.active} نشط`, `${data.summary.active} active`)} tone="brand" />
          <MetricCard icon={CircleDollarSign} label={l('تغطية الرواتب', 'Payroll coverage')} value={coverage(data.summary.payroll, data.summary.active)} suffix="%" hint={l(`${data.summary.payroll} موظف`, `${data.summary.payroll} people`)} tone="navy" />
          <MetricCard icon={ShieldCheck} label={l('مؤمّن عليهم', 'Insured people')} value={data.summary.insured} hint={l(`من ${data.summary.insuranceRecords} سجل تأمين`, `from ${data.summary.insuranceRecords} insurance rows`)} tone="orange" />
          <MetricCard icon={BriefcaseBusiness} label={l('احتياج التوظيف', 'Hiring demand')} value={data.summary.openPositions} hint={l(`${data.summary.openRecruitmentRequests} طلب نشط`, `${data.summary.openRecruitmentRequests} active requests`)} tone="slate" />
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-surface-line px-5 py-4">
            <div>
              <h2 className="font-extrabold">{l('نبض التوظيف', 'Recruitment pulse')}</h2>
              <p className="mt-0.5 text-xs text-ink-faint">{l('الطلبات النشطة الأقرب للقرار', 'Active requests closest to a decision')}</p>
            </div>
            <button className="text-xs font-bold text-brand-500 hover:underline" onClick={() => onOpen('recruitment')}>{l('كل الطلبات', 'All requests')}</button>
          </div>
          {activeRecruitment.length ? (
            <div className="grid gap-px bg-surface-line sm:grid-cols-2">
              {activeRecruitment.map((request) => (
                <div key={request.id} className="bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><h3 className="font-bold">{request.role}</h3><p className="mt-1 text-xs text-ink-muted">{request.department || request.location}</p></div>
                    <span className="chip bg-status-warnBg text-accent-600">{Math.max(0, request.numberNeeded - request.accepted)} {l('مطلوب', 'open')}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-[#1D6FB8]" style={{ width: `${coverage(request.accepted, request.numberNeeded)}%` }} /></div>
                </div>
              ))}
            </div>
          ) : <EmptyState title={l('لا توجد طلبات توظيف نشطة', 'No active recruitment requests')} />}
        </section>
      </div>

      <aside className="space-y-4">
        <section className={cx('card border-s-4 p-5', qualityIssues ? 'border-s-accent-500' : 'border-s-status-ok')}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-ink-faint">{l('جودة الربط', 'Reconciliation')}</div>
              <div className="mt-1 text-3xl font-black tabular-nums">{qualityIssues}</div>
            </div>
            {qualityIssues ? <AlertTriangle className="text-accent-500" /> : <BadgeCheck className="text-status-ok" />}
          </div>
          <p className="mt-2 text-xs leading-6 text-ink-muted">
            {qualityIssues ? l('فروق تحتاج مراجعة؛ لا يتم إسقاطها أو دمجها تلقائيًا.', 'Differences need review; nothing is silently dropped or merged.') : l('كل المفاتيح والروابط متسقة.', 'All keys and links are consistent.')}
          </p>
          {reconciliation && <QualityMini reconciliation={reconciliation} lang={lang} />}
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2"><Database size={18} className="text-[#1D6FB8]" /><h2 className="font-extrabold">{l('حالة المصادر', 'Source health')}</h2></div>
          <div className="mt-4 space-y-3">
            {data.datasets.map((dataset) => (
              <div key={dataset.source} className="flex items-center gap-3">
                <span className={cx('grid h-8 w-8 place-items-center rounded-lg', dataset.importedAt ? 'bg-brand-50 text-[#1D6FB8]' : 'bg-surface-sunken text-ink-faint')}>
                  {dataset.importedAt ? <Check size={15} /> : <X size={15} />}
                </span>
                <div className="min-w-0 flex-1"><div className="truncate text-xs font-bold">{dataset.label[lang]}</div><div className="truncate text-[11px] text-ink-faint">{dataset.importedAt ? formatDateTime(dataset.importedAt, lang) : l('لم يُرفع بعد', 'Not uploaded')}</div></div>
              </div>
            ))}
          </div>
          {missingSources.length > 0 && <button className="btn-ghost btn-sm mt-4 w-full" onClick={() => onOpen('imports')}><UploadCloud size={15} />{l('أكمل المصادر', 'Complete sources')}</button>}
        </section>
      </aside>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, suffix, hint, tone }: { icon: typeof UsersRound; label: string; value: number; suffix?: string; hint: string; tone: 'brand' | 'navy' | 'orange' | 'slate' }) {
  const tones = { brand: 'bg-brand-50 text-brand-500', navy: 'bg-navy/10 text-navy', orange: 'bg-accent-50 text-accent-600', slate: 'bg-surface-sunken text-ink-muted' };
  return (
    <article className="card p-4 transition-transform hover:-translate-y-0.5">
      <div className={cx('grid h-9 w-9 place-items-center rounded-xl', tones[tone])}><Icon size={18} /></div>
      <div className="mt-4 text-3xl font-black tabular-nums">{value}<span className="ms-0.5 text-base text-ink-faint">{suffix}</span></div>
      <div className="mt-1 text-xs font-bold">{label}</div>
      <div className="mt-0.5 text-[11px] text-ink-faint">{hint}</div>
    </article>
  );
}

function QualityMini({ reconciliation, lang }: { reconciliation: NonNullable<HRDashboardData['reconciliation']>; lang: 'ar' | 'en' }) {
  const rows = [
    ['activeWithoutPayroll', 'نشط بدون راتب', 'Active missing payroll'],
    ['insuranceWithoutMaster', 'تأمين بلا ملف', 'Insurance missing master'],
    ['unlinkedAccounts', 'حساب غير مربوط', 'Unlinked accounts'],
    ['unmatchedOrganizationPositions', 'منصب غير مطابق', 'Unmatched positions'],
  ] as const;
  return <div className="mt-4 space-y-2">{rows.map(([key, ar, en]) => <div key={key} className="flex items-center justify-between rounded-lg bg-surface-sunken px-3 py-2 text-[11px]"><span className="font-semibold text-ink-muted">{lang === 'en' ? en : ar}</span><b className={reconciliation[key].length ? 'text-accent-600' : 'text-status-ok'}>{reconciliation[key].length}</b></div>)}</div>;
}

function PeopleDirectory({ data, lang }: { data: HRDashboardData; lang: 'ar' | 'en' }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const people = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.employees.filter((employee) => {
      const matchesStatus = status === 'all' || employee.status === status;
      const haystack = `${employee.employeeCode} ${employee.nameArabic} ${employee.nameEnglish} ${employee.department} ${employee.title}`.toLowerCase();
      return matchesStatus && (!needle || haystack.includes(needle));
    });
  }, [data.employees, query, status]);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-surface-line p-4 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" size={16} /><input className="field ps-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l('ابحث بالاسم، الكود، القسم أو الوظيفة…', 'Search name, code, department, or role…')} /></div>
        <div className="flex gap-1 rounded-xl bg-surface-sunken p-1">{(['active', 'inactive', 'all'] as const).map((item) => <button key={item} className={cx('rounded-lg px-3 py-2 text-xs font-bold', status === item ? 'bg-white text-[#1D6FB8] shadow-sm' : 'text-ink-muted')} onClick={() => setStatus(item)}>{item === 'active' ? l('نشط', 'Active') : item === 'inactive' ? l('سابق', 'Former') : l('الكل', 'All')}</button>)}</div>
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-start text-sm">
          <thead className="bg-[#F8FAFC] text-[11px] font-bold text-ink-faint"><tr><th className="px-5 py-3 text-start">{l('الموظف', 'Employee')}</th><th className="px-4 py-3 text-start">{l('الوظيفة', 'Role')}</th><th className="px-4 py-3 text-start">{l('القسم', 'Department')}</th><th className="px-4 py-3 text-start">{l('الربط', 'Coverage')}</th><th className="px-4 py-3 text-start">{l('الحالة', 'Status')}</th><th className="w-12" /></tr></thead>
          <tbody className="divide-y divide-surface-line">{people.map((employee) => <EmployeeRow key={employee.employeeCode} employee={employee} lang={lang} />)}</tbody>
        </table>
      </div>
      <div className="divide-y divide-surface-line md:hidden">{people.map((employee) => <EmployeeMobile key={employee.employeeCode} employee={employee} lang={lang} />)}</div>
      {!people.length && <EmptyState title={l('لا توجد نتائج', 'No matching employees')} body={l('جرّب كلمة بحث أو حالة مختلفة.', 'Try another search or status.')} />}
    </section>
  );
}

function EmployeeRow({ employee, lang }: { employee: HREmployeeSummary; lang: 'ar' | 'en' }) {
  const name = employee.nameArabic || employee.nameEnglish || `#${employee.employeeCode}`;
  return (
    <tr className="group hover:bg-brand-50/30">
      <td className="px-5 py-3.5"><Link to={`/hr/employees/${employee.employeeCode}`} className="flex items-center gap-3"><Avatar name={name} size={36} color={employee.status === 'active' ? '#1D6FB8' : '#94A3B8'} /><span><span className="block font-bold group-hover:text-[#1D6FB8]">{name}</span><span className="ltr block text-[11px] text-ink-faint">#{employee.employeeCode} · {employee.companyEmail}</span></span></Link></td>
      <td className="px-4 py-3.5"><div className="max-w-[18rem] truncate font-semibold">{employee.title || '—'}</div></td>
      <td className="px-4 py-3.5 text-xs text-ink-muted">{employee.department || employee.sector || '—'}</td>
      <td className="px-4 py-3.5"><div className="flex gap-1.5"><CoverageDot active={employee.hasPayroll} title={lang === 'en' ? 'Payroll' : 'راتب'} /><CoverageDot active={employee.hasInsurance} title={lang === 'en' ? 'Insurance' : 'تأمين'} /><CoverageDot active={Boolean(employee.linkedUserId)} title={lang === 'en' ? 'Qodo account' : 'حساب Qodo'} /></div></td>
      <td className="px-4 py-3.5"><StatusChip status={employee.status} lang={lang} /></td>
      <td className="px-4 py-3.5"><Link to={`/hr/employees/${employee.employeeCode}`} className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint hover:bg-white hover:text-[#1D6FB8]"><ChevronRight className="rtl:rotate-180" size={17} /></Link></td>
    </tr>
  );
}

function EmployeeMobile({ employee, lang }: { employee: HREmployeeSummary; lang: 'ar' | 'en' }) {
  const name = employee.nameArabic || employee.nameEnglish || `#${employee.employeeCode}`;
  return <Link to={`/hr/employees/${employee.employeeCode}`} className="flex items-center gap-3 p-4 active:bg-surface-sunken"><Avatar name={name} color={employee.status === 'active' ? '#1D6FB8' : '#94A3B8'} /><div className="min-w-0 flex-1"><div className="truncate font-bold">{name}</div><div className="mt-0.5 truncate text-xs text-ink-muted">#{employee.employeeCode} · {employee.title}</div></div><StatusChip status={employee.status} lang={lang} /></Link>;
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
  const rows = data.employees.filter((employee) => employee.hasPayroll);
  const total = rows.reduce((sum, employee) => sum + Number(employee.totalSalary || 0), 0);
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3"><MetricCard icon={Banknote} label={l('إجمالي المسير', 'Payroll total')} value={total} hint="EGP" tone="brand" /><MetricCard icon={UsersRound} label={l('عدد الموظفين', 'People paid')} value={rows.length} hint={l('في آخر ملف مرفوع', 'latest uploaded sheet')} tone="navy" /><MetricCard icon={AlertTriangle} label={l('نشط غير موجود', 'Active missing')} value={data.reconciliation?.activeWithoutPayroll.length ?? 0} hint={l('يحتاج مراجعة', 'needs review')} tone="orange" /></section>
      <section className="card overflow-hidden">
        <div className="border-b border-surface-line px-5 py-4"><h2 className="font-extrabold">{l('مسير الرواتب الحالي', 'Current payroll register')}</h2><p className="mt-1 text-xs text-ink-faint">{l('الأرقام الحساسة لا تظهر إلا لصاحبها أو لحامل صلاحية الرواتب.', 'Sensitive figures are visible only to the employee or payroll-authorised staff.')}</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-surface-sunken text-[11px] text-ink-faint"><tr><th className="px-5 py-3 text-start">{l('الموظف', 'Employee')}</th><th className="px-4 py-3 text-start">{l('القسم', 'Department')}</th><th className="px-4 py-3 text-end">{l('الإجمالي', 'Total')}</th><th className="px-4 py-3 text-start">{l('التأمين', 'Insurance')}</th><th className="w-12" /></tr></thead><tbody className="divide-y divide-surface-line">{rows.map((employee) => <tr key={employee.employeeCode} className="hover:bg-brand-50/30"><td className="px-5 py-3"><div className="font-bold">{employee.nameArabic || employee.nameEnglish}</div><div className="text-[11px] text-ink-faint">#{employee.employeeCode}</div></td><td className="px-4 py-3 text-xs text-ink-muted">{employee.department}</td><td className="px-4 py-3 text-end font-black tabular-nums text-[#1D6FB8]">{money(employee.totalSalary, lang)}</td><td className="px-4 py-3"><span className={cx('chip', employee.hasInsurance ? 'bg-status-okBg text-status-ok' : 'bg-status-warnBg text-accent-600')}>{employee.hasInsurance ? l('مربوط', 'Linked') : l('غير موجود', 'Missing')}</span></td><td className="px-4"><Link to={`/hr/employees/${employee.employeeCode}`}><ChevronRight className="rtl:rotate-180" size={17} /></Link></td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

function RecruitmentDesk({ data, lang, onChanged }: { data: HRDashboardData; lang: 'ar' | 'en'; onChanged: () => Promise<void> }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const { push } = useToast();
  const [filter, setFilter] = useState('active');
  const [saving, setSaving] = useState('');
  const rows = data.recruitment.filter((request) => filter === 'all' || request.status === filter);
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">{['active', 'hold', 'done', 'all'].map((item) => <button key={item} onClick={() => setFilter(item)} className={cx('rounded-xl px-3.5 py-2 text-xs font-bold', filter === item ? 'bg-[#1D6FB8] text-white' : 'border border-surface-line bg-white text-ink-muted')}>{item === 'active' ? l('نشط', 'Active') : item === 'hold' ? l('معلّق', 'On hold') : item === 'done' ? l('مكتمل', 'Done') : l('الكل', 'All')}</button>)}</div>
      <div className="grid gap-3 lg:grid-cols-2">{rows.map((request) => (
        <article key={request.id} className="card overflow-hidden p-5">
          <div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-extrabold">{request.role}</h2><StatusChip status={request.status} lang={lang} /></div><p className="mt-1 text-xs text-ink-muted">{request.department || '—'} · {request.location || '—'} · {request.vacancyReason || '—'}</p></div><span className="rounded-xl bg-surface-sunken px-3 py-2 text-center"><b className="block text-xl tabular-nums">{request.accepted}/{request.numberNeeded}</b><small className="text-[10px] text-ink-faint">{l('تعيين', 'hired')}</small></span></div>
          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3"><MiniFact label={l('المسؤول', 'Owner')} value={request.assignedTo.join('، ') || '—'} /><MiniFact label={l('الموعد', 'Due')} value={formatDate(request.dueDate, lang)} /><MiniFact label={l('نطاق الراتب', 'Salary range')} value={request.salaryRange || '—'} /></div>
          {request.feedback && <p className="mt-3 rounded-xl bg-[#F8FAFC] px-3 py-2 text-xs leading-6 text-ink-muted">{request.feedback}</p>}
          {data.permissions.canManage && <div className="mt-4 flex items-center gap-2 border-t border-surface-line pt-3"><span className="text-[11px] font-bold text-ink-faint">{l('تغيير الحالة', 'Change status')}</span><select className="field !w-auto !py-1.5 text-xs" value={request.status} disabled={saving === request.id} onChange={(event) => void updateStatus(request, event.target.value)}><option value="active">Active</option><option value="hold">Hold</option><option value="done">Done</option></select>{saving === request.id && <Spinner size={15} />}</div>}
        </article>
      ))}</div>
      {!rows.length && <EmptyState title={l('لا توجد طلبات بهذه الحالة', 'No requests in this state')} />}
    </div>
  );
}

function OrganizationDesk({ data, lang }: { data: HRDashboardData; lang: 'ar' | 'en' }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const [query, setQuery] = useState('');
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
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-surface-line p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-extrabold">{l('خريطة المسؤولية', 'Accountability map')}</h2><p className="mt-1 text-xs text-ink-faint">{l(`${data.summary.organizationPositions} منصب · ${data.summary.organizationVacancies} شاغر`, `${data.summary.organizationPositions} positions · ${data.summary.organizationVacancies} vacant`)}</p></div><div className="relative sm:w-80"><Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" /><input className="field ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l('ابحث في الهيكل…', 'Search structure…')} /></div></div>
      <div className="max-h-[68dvh] overflow-auto bg-[linear-gradient(#f8fafc_1px,transparent_1px),linear-gradient(90deg,#f8fafc_1px,transparent_1px)] bg-[size:24px_24px] p-4 sm:p-6">{roots.map((root) => <OrgNode key={root.id} node={root} children={children} lang={lang} depth={0} />)}</div>
    </section>
  );
}

function OrgNode({ node, children, lang, depth }: { node: HROrganizationPosition; children: Map<string, HROrganizationPosition[]>; lang: 'ar' | 'en'; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const branch = children.get(node.id) ?? [];
  return <div className={cx(depth > 0 && 'ms-5 border-s border-brand-200 ps-4 sm:ms-8')}><div className="mb-2 flex items-center gap-2 rounded-xl border border-surface-line bg-white p-3 shadow-sm"><button className={cx('grid h-7 w-7 place-items-center rounded-lg', branch.length ? 'bg-brand-50 text-[#1D6FB8]' : 'text-transparent')} onClick={() => branch.length && setOpen((value) => !value)}>{branch.length && <ChevronDown size={15} className={cx(!open && '-rotate-90 rtl:rotate-90')} />}</button><span className={cx('h-8 w-1 rounded-full', node.matchState === 'matched' ? 'bg-status-ok' : node.matchState === 'vacant' ? 'bg-accent-400' : 'bg-status-bad')} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{node.title}</div><div className="truncate text-[11px] text-ink-muted">{node.employeeName || (lang === 'en' ? 'Vacant position' : 'منصب شاغر')} · {node.departmentCode}</div></div>{node.employeeCode && <Link className="text-[11px] font-bold text-[#1D6FB8] hover:underline" to={`/hr/employees/${node.employeeCode}`}>#{node.employeeCode}</Link>}</div>{open && branch.map((child) => <OrgNode key={child.id} node={child} children={children} lang={lang} depth={depth + 1} />)}</div>;
}

function ImportDesk({ data, lang, uploading, onUpload }: { data: HRDashboardData; lang: 'ar' | 'en'; uploading: HRSource | null; onUpload: (source: HRSource, event: ChangeEvent<HTMLInputElement>) => void }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const quality = data.reconciliation;
  return (
    <div className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-3 sm:grid-cols-2">
          {data.datasets.map((dataset) => <ImportCard key={dataset.source} dataset={dataset} lang={lang} busy={uploading === dataset.source} disabled={Boolean(uploading)} onUpload={(event) => onUpload(dataset.source, event)} />)}
        </div>
        <aside className="space-y-4">
          <div className="card overflow-hidden bg-[#0B2545] p-5 text-white">
            <div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><Bot size={21} /></span><span className={cx('chip', data.telegram?.enabled ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/10 text-white/60')}>{data.telegram?.enabled ? l('متصل', 'Connected') : l('يحتاج إعداد', 'Needs setup')}</span></div>
            <h2 className="mt-4 font-extrabold">{l('قناة Telegram للرواتب', 'Telegram payroll channel')}</h2>
            <p className="mt-2 text-xs leading-6 text-white/65">{l('البوت يقبل نفس ملفات Excel، يتحقق من الشات والسر، ثم يشغّل نفس مسار المطابقة المستخدم داخل الداشبورد.', 'The bot accepts the same Excel files, verifies chat and secret, then uses the exact dashboard reconciliation path.')}</p>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[.06] p-3 text-[11px] leading-6 text-white/70"><code className="ltr block">POST /api/hr/telegram</code><span>{l('Secret + Chat allowlist + .xlsx فقط', 'Secret + chat allowlist + .xlsx only')}</span></div>
          </div>
          {quality && <div className="card p-5"><div className="flex items-center gap-2"><ListFilter size={18} className="text-accent-500" /><h2 className="font-extrabold">{l('طابور المراجعة', 'Review queue')}</h2></div><QualityMini reconciliation={quality} lang={lang} /></div>}
        </aside>
      </section>
      <div className="rounded-2xl border border-brand-100 bg-brand-50/70 px-4 py-3 text-xs leading-6 text-brand-800"><b>{l('قاعدة الاستيراد:', 'Import rule:')}</b> {l('كود الموظف هو المفتاح. الاسم لا يدمج سجلين تلقائيًا، واستبدال شيت لا يحذف تاريخ الاستيراد أو رابط حساب Qodo.', 'Employee code is the key. Names never auto-merge records, and replacing a sheet does not remove import history or Qodo account links.')}</div>
    </div>
  );
}

function ImportCard({ dataset, lang, busy, disabled, onUpload }: { dataset: HRDatasetMeta; lang: 'ar' | 'en'; busy: boolean; disabled: boolean; onUpload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const Icon = SOURCE_ICONS[dataset.source];
  const meta = HR_SOURCE_LABELS[dataset.source];
  const ready = Boolean(dataset.importedAt);
  return (
    <article className={cx('card relative overflow-hidden p-5', ready && 'border-brand-200')}>
      <div className={cx('absolute inset-x-0 top-0 h-1', ready ? 'bg-[#1D6FB8]' : 'bg-slate-200')} />
      <div className="flex items-start justify-between gap-3"><span className={cx('grid h-11 w-11 place-items-center rounded-2xl', ready ? 'bg-brand-50 text-[#1D6FB8]' : 'bg-surface-sunken text-ink-faint')}><Icon size={21} /></span><span className={cx('chip', ready ? 'bg-status-okBg text-status-ok' : 'bg-surface-sunken text-ink-faint')}>{ready ? (lang === 'en' ? 'Ready' : 'متصل') : (lang === 'en' ? 'Missing' : 'ناقص')}</span></div>
      <h2 className="mt-4 font-extrabold">{meta[lang]}</h2><p className="mt-1 text-xs leading-6 text-ink-muted">{lang === 'en' ? meta.hintEn : meta.hintAr}</p>
      {ready && <div className="mt-3 rounded-xl bg-[#F8FAFC] p-3"><div className="truncate text-[11px] font-bold text-ink">{dataset.fileName}</div><div className="mt-1 text-[10px] text-ink-faint">{formatDateTime(dataset.importedAt, lang)} · {dataset.origin === 'telegram' ? 'Telegram' : 'Dashboard'}</div><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(dataset.summary ?? {}).slice(0, 3).map(([key, value]) => <span key={key} className="rounded-md bg-white px-2 py-1 text-[10px] text-ink-muted">{key}: <b>{Number(value).toLocaleString()}</b></span>)}</div></div>}
      <label className={cx('btn-ghost btn-sm mt-4 w-full cursor-pointer', disabled && 'pointer-events-none opacity-50')}><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onUpload} />{busy ? <Spinner size={16} /> : <UploadCloud size={16} />}{busy ? (lang === 'en' ? 'Analysing…' : 'جارٍ التحليل…') : ready ? (lang === 'en' ? 'Replace workbook' : 'استبدال الشيت') : (lang === 'en' ? 'Upload workbook' : 'رفع الشيت')}</label>
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
    <div className="mx-auto max-w-[1320px] pb-12">
      <Link to="/hr" className="mb-4 inline-flex items-center gap-2 text-xs font-bold text-ink-muted hover:text-[#1D6FB8]">{lang === 'en' ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}{l('العودة إلى الموارد البشرية', 'Back to HR')}</Link>
      <section className="relative overflow-hidden rounded-[28px] bg-[#0B2545] p-6 text-white shadow-panel sm:p-8">
        <div className="absolute -end-16 -top-24 h-72 w-72 rounded-full border-[38px] border-brand-300/10" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-center gap-4"><Avatar name={name} color="#4A8FCB" size={72} className="ring-4 ring-white/10" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-white/10 px-2 py-1 font-mono text-xs text-brand-100">EMP-{employee.employeeCode}</span><StatusChip status={employee.status} lang={lang} /></div><h1 className="mt-2 truncate text-2xl font-black sm:text-3xl">{name}</h1><p className="mt-1 truncate text-sm text-white/65">{employee.title || '—'} · {employee.department || employee.sector || '—'}</p></div></div>
          <div className="flex flex-wrap gap-2">{canManage && <button className="btn !border-white/15 !bg-white/10 text-white hover:!bg-white/20" onClick={() => setEditor('master')}><Pencil size={16} />{l('تعديل الملف', 'Edit profile')}</button>}</div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,.65fr)]">
        <div className="space-y-4">
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

        <aside className="space-y-4">
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
            <div className="grid grid-cols-2 gap-2">{Object.entries(employee.sources).map(([source, active]) => <div key={source} className={cx('rounded-xl border px-3 py-2 text-xs font-bold', active ? 'border-brand-200 bg-brand-50 text-[#1D6FB8]' : 'border-surface-line bg-surface-sunken text-ink-faint')}>{active ? '✓' : '—'} {source}</div>)}</div>
          </ProfileSection>
        </aside>
      </section>
      <EmployeeEditor open={Boolean(editor)} section={editor} employee={employee} lang={lang} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await load(); push(l('تم حفظ بيانات الموظف.', 'Employee record saved.')); }} />
    </div>
  );
}

function ProfileSection({ icon: Icon, title, action, children }: { icon: typeof UsersRound; title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="card overflow-hidden"><header className="flex items-center justify-between gap-3 border-b border-surface-line px-5 py-4"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-[#1D6FB8]"><Icon size={16} /></span><h2 className="font-extrabold">{title}</h2></div>{action}</header><div className="p-5">{children}</div></section>;
}

function EditButton({ onClick, lang }: { onClick: () => void; lang: 'ar' | 'en' }) { return <button className="btn-quiet btn-sm" onClick={onClick}><Pencil size={14} />{lang === 'en' ? 'Edit' : 'تعديل'}</button>; }

function FactGrid({ items, compact = false }: { items: Array<[string, string | number | null | undefined]>; compact?: boolean }) {
  return <dl className={cx('grid gap-x-6 gap-y-4', !compact && 'sm:grid-cols-2')}>{items.map(([label, value]) => <div key={label}><dt className="text-[11px] font-bold text-ink-faint">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-ink">{value === null || value === undefined || value === '' ? '—' : value}</dd></div>)}</dl>;
}

function MoneyBlock({ label, value, lang, primary }: { label: string; value: number | null; lang: 'ar' | 'en'; primary?: boolean }) { return <div className={cx('rounded-2xl border p-4', primary ? 'border-brand-200 bg-brand-50' : 'border-surface-line bg-[#F8FAFC]')}><div className="text-[11px] font-bold text-ink-faint">{label}</div><div className={cx('mt-2 text-xl font-black tabular-nums', primary && 'text-[#1D6FB8]')}>{money(value, lang)}</div></div>; }
function MiniFact({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-[#F8FAFC] p-3"><div className="text-[10px] font-bold text-ink-faint">{label}</div><div className="mt-1 truncate font-semibold">{value}</div></div>; }
function MissingData({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-surface-line bg-surface-sunken p-4 text-sm text-ink-muted">{text}</div>; }

function DocumentChecklist({ documents, lang }: { documents: Record<string, boolean | number | string | null>; lang: 'ar' | 'en' }) {
  const ignored = new Set(['completionRate', 'collectionStatus']);
  const rows = Object.entries(documents).filter(([key]) => !ignored.has(key));
  const done = rows.filter(([, value]) => Boolean(value)).length;
  const rate = typeof documents.completionRate === 'number' ? Math.round(documents.completionRate * 100) : coverage(done, rows.length);
  return <div><div className="flex items-end justify-between"><span className="text-xs font-bold text-ink-muted">{lang === 'en' ? 'Ready' : 'مكتمل'}</span><b className="text-2xl text-[#1D6FB8]">{rate}%</b></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-[#1D6FB8]" style={{ width: `${Math.min(100, rate)}%` }} /></div><div className="mt-4 grid grid-cols-2 gap-2">{rows.map(([key, value]) => <div key={key} className={cx('flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold', value ? 'bg-status-okBg text-status-ok' : 'bg-surface-sunken text-ink-faint')}><span className="grid h-4 w-4 place-items-center rounded-full border">{value && <Check size={10} />}</span>{key}</div>)}</div></div>;
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
  return <Modal open={open} onClose={onClose} title={l('تعديل بيانات الموظف', 'Edit employee record')} width="lg" footer={<><button className="btn-ghost" onClick={onClose}>{l('إلغاء', 'Cancel')}</button><button className="btn-primary" onClick={() => void save()} disabled={saving}>{saving ? <Spinner size={16} /> : <Check size={16} />}{l('حفظ التعديل', 'Save changes')}</button></>}><div className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-xs leading-6 text-brand-800">{l('التعديل يُحفظ في نفس مصدر الشيت ويظهر في الملف الموحّد فورًا. رفع شيت أحدث سيستبدل قيم هذا المصدر.', 'The edit is saved in the same source and appears immediately. A newer workbook will replace values from that source.')}</div><div className="grid gap-4 sm:grid-cols-2">{Object.keys(form).map((key) => <label key={key}><span className="label">{label[key]?.[lang] ?? key}</span><input className="field" type={numeric.has(key) ? 'number' : 'text'} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div></Modal>;
}

function coverage(part: number, total: number) { return total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0; }
function money(value: number | null | undefined, lang: 'ar' | 'en') { if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'; return new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(Number(value)); }
function formatDate(value: string | null | undefined, lang: 'ar' | 'en') { if (!value) return '—'; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-EG', { dateStyle: 'medium' }).format(date); }
function formatDateTime(value: string | null | undefined, lang: 'ar' | 'en') { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
