/**
 * /hr/personnel — the work that used to live in e-mail threads: onboarding a
 * new hire, leave, clearance, salary increases, documents, insurance and plain
 * employee requests. Every list opens a case in the same drawer (`?case=`),
 * which is also where a notification lands.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CalendarRange, ClipboardList, Cloud, FileClock, Hourglass, Inbox, KeyRound, ListChecks, Plane, Plus, Search, Sun, Thermometer, UserPlus, UsersRound } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { hrApi, useHRQuery } from '../api';
import { date, normaliseSearch, num, useHRText } from '../format';
import { PERSONNEL_STATUS_LABEL, PERSONNEL_TYPE_LABEL } from '../labels';
import { useHR } from '../shell/HRContext';
import { PERSONNEL_NAV } from '../shell/nav';
import { SubNavLayout } from '../shell/SubNav';
import type { Localised, PersonnelCase, PersonnelType, TimeOffView } from '../types';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge, Card, Metric, PageHeader, PersonAvatar, SectionTitle } from '../ui/primitives';
import { PillTabs } from '../ui/PillTabs';
import { LeaveRow, LeaveTypeChip, OutTodayStrip, personName } from '../ui/timeOff';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../ui/states';
import { CASE_STATUS_TONE, CaseDrawer } from './CaseDrawer';
import { NewCaseDialog } from './NewCaseDialog';
import { REQUEST_TYPES, checklistProgress, formPending, isOpenCase, sectionFor, type PersonnelList } from './model';

export function PersonnelLayout() {
  return <SubNavLayout items={PERSONNEL_NAV} label={{ ar: 'أقسام شئون العاملين', en: 'Personnel sections' }} layoutId="personnel-tab" />;
}

/** The page title and the one action every Personnel page offers. */
function PersonnelHeader({ title, description, newType }: { title: Localised; description: Localised; newType: PersonnelType }) {
  const { t, pick } = useHRText();
  const { access } = useHR();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow={t('شئون العاملين', 'Personnel')}
        title={pick(title)}
        description={pick(description)}
        actions={access?.personnelManage ? <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={16} />{t('طلب جديد', 'New case')}</button> : null}
      />
      {creating && (
        <NewCaseDialog
          initialType={newType}
          payroll={Boolean(access?.payroll)}
          peopleAccess={Boolean(access?.people)}
          onClose={() => setCreating(false)}
          onCreated={(item) => {
            setCreating(false);
            navigate(`/hr/personnel/${sectionFor(item.type)}?case=${encodeURIComponent(item.id)}`);
          }}
        />
      )}
    </>
  );
}

function caseName(item: PersonnelCase, t: (ar: string, en: string) => string) {
  return item.candidate?.name || item.title || item.jobTitle || t('بدون عنوان', 'Untitled');
}

function useCaseParam() {
  const [params, setParams] = useSearchParams();
  const open = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('case', id);
    setParams(next);
  };
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('case');
    setParams(next, { replace: true });
  };
  return { caseId: params.get('case'), open, close };
}

const STATUS_FILTERS: Array<{ id: string; label: Localised; test: (item: PersonnelCase) => boolean }> = [
  { id: 'open', label: { ar: 'مفتوحة', en: 'Open' }, test: isOpenCase },
  { id: 'done', label: { ar: 'منتهية', en: 'Done' }, test: (item) => item.status === 'done' },
  { id: 'cancelled', label: { ar: 'ملغاة', en: 'Cancelled' }, test: (item) => item.status === 'cancelled' },
  { id: 'all', label: { ar: 'الكل', en: 'All' }, test: () => true },
];

/** A filterable list of cases of some types, with the case drawer. */
function CaseBoard({ types, emptyTitle, emptyBody }: { types: PersonnelType[]; emptyTitle: string; emptyBody?: string }) {
  const { t, lang, pick } = useHRText();
  const [params, setParams] = useSearchParams();
  const { caseId, open, close } = useCaseParam();
  const { data, error, loading, reload } = useHRQuery<PersonnelList>(hrApi.personnel());
  const status = STATUS_FILTERS.find((entry) => entry.id === params.get('status')) ?? STATUS_FILTERS[0];
  const type = params.get('type') ?? '';
  const q = params.get('q') ?? '';
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // Callers pass the types inline; the joined key keeps the memo stable across renders.
  const typeKey = types.join(',');
  const inScope = useMemo(() => {
    const wanted = new Set(typeKey.split(','));
    return (data?.cases ?? []).filter((item) => wanted.has(item.type));
  }, [data, typeKey]);
  const rows = useMemo(() => {
    const needle = normaliseSearch(q);
    return inScope
      .filter(status.test)
      .filter((item) => !type || item.type === type)
      .filter((item) => !needle || normaliseSearch(`${item.title} ${item.candidate?.name ?? ''} ${item.employeeCode ?? ''} ${item.jobTitle} ${item.department}`).includes(needle));
  }, [inScope, status, type, q]);
  const typesPresent = types.filter((entry) => inScope.some((item) => item.type === entry));

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={1} />;

  const columns: Array<Column<PersonnelCase>> = [
    {
      key: 'case',
      header: t('الطلب', 'Case'),
      sort: (item) => caseName(item, t),
      cell: (item) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-navy">{caseName(item, t)}</p>
          <p className="truncate text-[11.5px] text-[#5A6C82]">{[pick(PERSONNEL_TYPE_LABEL[item.type]), item.employeeCode ? `#${item.employeeCode}` : null, item.recruitmentReference].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { key: 'job', header: t('الوظيفة والقسم', 'Job & department'), sort: (item) => item.department, cell: (item) => <span className="text-[12.5px] text-navy">{[item.jobTitle, item.department].filter(Boolean).join(' · ') || '—'}</span> },
    {
      key: 'progress',
      header: t('التنفيذ', 'Progress'),
      sort: (item) => {
        const progress = checklistProgress(item);
        return progress.total ? progress.done / progress.total : null;
      },
      cell: (item) => {
        const progress = checklistProgress(item);
        if (!progress.total) return formPending(item) ? <Badge tone="warning">{t('بانتظار النموذج', 'Awaiting form')}</Badge> : <span className="text-ink-faint">—</span>;
        return (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><span className={cx('block h-full rounded-full', progress.done === progress.total ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${(progress.done / progress.total) * 100}%` }} /></span>
            <span className="text-[12px] font-semibold tabular-nums text-navy">{progress.done}/{progress.total}</span>
          </span>
        );
      },
    },
    { key: 'status', header: t('الحالة', 'Status'), sort: (item) => item.status, cell: (item) => <Badge tone={CASE_STATUS_TONE[item.status]} dot>{pick(PERSONNEL_STATUS_LABEL[item.status])}</Badge> },
    { key: 'updated', header: t('آخر تحديث', 'Updated'), sort: (item) => item.updatedAt, cell: (item) => <span className="whitespace-nowrap text-[12px] text-[#5A6C82]">{date(item.updatedAt, lang)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-[#E6ECF3] bg-white p-1" role="group" aria-label={t('الحالة', 'Status')}>
          {STATUS_FILTERS.map((entry) => {
            const count = inScope.filter(entry.test).length;
            return (
              <button key={entry.id} type="button" aria-pressed={status.id === entry.id} onClick={() => set('status', entry.id === 'open' ? '' : entry.id)} className={cx('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors', status.id === entry.id ? 'bg-navy text-white' : 'text-[#5A6C82] hover:bg-[#F6F8FB] hover:text-navy')}>
                {pick(entry.label)}
                <span className={cx('rounded-full px-1.5 text-[11px] tabular-nums', status.id === entry.id ? 'bg-white/20' : 'bg-[#F1F5FA] text-ink-faint')}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {typesPresent.length > 1 && (
            <select className="field !py-2 sm:w-48" value={type} onChange={(event) => set('type', event.target.value)} aria-label={t('نوع الطلب', 'Case type')}>
              <option value="">{t('كل الأنواع', 'All types')}</option>
              {typesPresent.map((entry) => <option key={entry} value={entry}>{pick(PERSONNEL_TYPE_LABEL[entry])}</option>)}
            </select>
          )}
          <div className="relative sm:w-64">
            <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
            <input className="field !py-2 ps-9" value={q} onChange={(event) => set('q', event.target.value)} placeholder={t('اسم، كود، وظيفة…', 'Name, code, job…')} aria-label={t('بحث', 'Search')} />
          </div>
        </div>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        onRowClick={(item) => open(item.id)}
        initialSort={{ key: 'updated', direction: 'desc' }}
        caption={t('طلبات شئون العاملين', 'Personnel cases')}
        empty={<EmptyBlock icon={<ClipboardList size={24} />} title={inScope.length ? t('لا توجد طلبات تطابق الفلاتر', 'No cases match these filters') : emptyTitle} body={inScope.length ? undefined : emptyBody} />}
      />
      <CaseDrawer caseId={caseId} onClose={close} />
    </div>
  );
}

export function PersonnelOverview() {
  const { t, lang, pick } = useHRText();
  const { caseId, open, close } = useCaseParam();
  const { data, error, loading, reload } = useHRQuery<PersonnelList>(hrApi.personnel());
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton />;
  const cases = data?.cases ?? [];
  const openCases = cases.filter(isOpenCase);
  const count = (types: PersonnelType[]) => openCases.filter((item) => types.includes(item.type)).length;
  const awaitingForm = openCases.filter((item) => item.type === 'onboarding' && formPending(item)).length;
  const myItems = openCases.reduce((sum, item) => sum + item.checklist.filter((entry) => !entry.done && item.canTick[entry.id]).length, 0);
  const oldest = [...openCases].sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt))).slice(0, 8);

  return (
    <div className="space-y-6">
      <PersonnelHeader
        title={{ ar: 'شئون العاملين', en: 'Personnel' }}
        description={{ ar: 'كل طلب له قائمة تنفيذ وصاحب لكل بند — شئون العاملين أو المدير المباشر أو IT — حتى يظهر دور من الآن.', en: 'Every case has a checklist and an owner for each item — Personnel, the manager or IT — so whose move it is shows at a glance.' }}
        newType="general"
      />
      <div className="hr-stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric icon={UserPlus} label={t('تهيئة مفتوحة', 'Open onboarding')} value={num(count(['onboarding']), lang)} to="/hr/personnel/onboarding" tone="info" />
        <Metric icon={FileClock} label={t('بانتظار نموذج الموظف', 'Awaiting new-hire form')} value={num(awaitingForm, lang)} to="/hr/personnel/onboarding" tone={awaitingForm ? 'warning' : 'neutral'} />
        <Metric icon={Plane} label={t('طلبات إجازة مفتوحة', 'Open leave requests')} value={num(count(['leave']), lang)} to="/hr/personnel/leave" tone="info" />
        <Metric icon={KeyRound} label={t('إخلاء طرف مفتوح', 'Open clearance')} value={num(count(['clearance']), lang)} to="/hr/personnel/clearance" tone="warning" />
        <Metric icon={Inbox} label={t('طلبات موظفين مفتوحة', 'Open employee requests')} value={num(count(REQUEST_TYPES), lang)} to="/hr/personnel/requests" tone="info" />
        <Metric icon={ListChecks} label={t('بنود دورك فيها', 'Items waiting on you')} value={num(myItems, lang)} tone={myItems ? 'warning' : 'neutral'} />
      </div>
      <Card>
        <SectionTitle title={t('الأقدم بلا تحديث', 'Longest without an update')} hint={t('الطلبات المفتوحة مرتبة من الأقدم تحديثاً.', 'Open cases, least recently updated first.')} />
        {oldest.length ? (
          <ul className="divide-y divide-[#EEF2F7]">
            {oldest.map((item) => {
              const progress = checklistProgress(item);
              return (
                <li key={item.id}>
                  <button type="button" onClick={() => open(item.id)} className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-start hover:bg-[#F7FAFD]">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-navy">{caseName(item, t)}</span>
                      <span className="block truncate text-[11.5px] text-[#5A6C82]">{pick(PERSONNEL_TYPE_LABEL[item.type])} · {t('آخر تحديث', 'Updated')} {date(item.updatedAt, lang)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {progress.total > 0 && <span className="text-[12px] font-semibold tabular-nums text-[#5A6C82]">{progress.done}/{progress.total}</span>}
                      <Badge tone={CASE_STATUS_TONE[item.status]} dot>{pick(PERSONNEL_STATUS_LABEL[item.status])}</Badge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <EmptyBlock icon={<ClipboardList size={24} />} title={t('لا توجد طلبات مفتوحة', 'No open cases')} body={t('كل الطلبات منتهية. أي وظيفة تكتمل في التوظيف تفتح تهيئة هنا تلقائياً.', 'Everything is closed. A job completed in Recruitment opens onboarding here automatically.')} />}
      </Card>
      <CaseDrawer caseId={caseId} onClose={close} />
    </div>
  );
}

export function PersonnelRequests() {
  const { t } = useHRText();
  return (
    <div className="space-y-6">
      <PersonnelHeader
        title={{ ar: 'طلبات الموظفين', en: 'Employee requests' }}
        description={{ ar: 'طلبات عامة ومستندات ناقصة، وزيادات الرواتب وعمليات التأمينات لمن لديه صلاحية الرواتب.', en: 'General requests and missing documents, plus salary increases and insurance operations for payroll holders.' }}
        newType="general"
      />
      <CaseBoard types={REQUEST_TYPES} emptyTitle={t('لا توجد طلبات موظفين', 'No employee requests')} emptyBody={t('افتح طلباً لأي عمل يخص موظفاً — مستند ناقص أو خطاب أو تعديل بيانات.', 'Open a case for any work about an employee — a missing document, a letter, a data change.')} />
    </div>
  );
}

export function PersonnelOnboarding() {
  const { t } = useHRText();
  return (
    <div className="space-y-6">
      <PersonnelHeader
        title={{ ar: 'تهيئة الموظفين الجدد', en: 'Onboarding' }}
        description={{ ar: 'تُفتح تلقائياً لكل مقبول عند اكتمال وظيفة في التوظيف، ويُبلَّغ شئون العاملين والمدير وIT. أرسل للموظف الجديد رابط نموذج البيانات الآمن من داخل الطلب.', en: 'Opened automatically for every accepted hire when a recruitment job completes; Personnel, the manager and IT are told. Send the new hire the secure form link from inside the case.' }}
        newType="onboarding"
      />
      <div className="flex flex-wrap gap-2 text-[12px] text-[#5A6C82]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 ring-1 ring-[#E6ECF3]"><UserPlus size={14} className="text-brand-600" aria-hidden="true" />{t('تسليم من التوظيف', 'Handover from recruitment')}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 ring-1 ring-[#E6ECF3]"><KeyRound size={14} className="text-brand-600" aria-hidden="true" />{t('رابط نموذج لمرة واحدة، 14 يوماً', 'One-time form link, 14 days')}</span>
      </div>
      <CaseBoard types={['onboarding']} emptyTitle={t('لا توجد تهيئة', 'No onboarding yet')} emptyBody={t('عندما تكتمل وظيفة في التوظيف تُفتح هنا تهيئة لكل موظف مقبول.', 'When a recruitment job completes, an onboarding case opens here for every accepted hire.')} />
    </div>
  );
}

export function PersonnelClearance() {
  const { t } = useHRText();
  return (
    <div className="space-y-6">
      <PersonnelHeader
        title={{ ar: 'إخلاء الطرف', en: 'Clearance' }}
        description={{ ar: 'استلام العهد وإغلاق الحسابات والتسوية النهائية لمن يغادر — كل بند عند صاحبه.', en: 'Handing back equipment, closing accounts and the final settlement for someone leaving — each item with its owner.' }}
        newType="clearance"
      />
      <CaseBoard types={['clearance']} emptyTitle={t('لا يوجد إخلاء طرف', 'No clearance cases')} emptyBody={t('افتح طلب إخلاء طرف عند استلام استقالة أو إنهاء خدمة.', 'Open a clearance case when a resignation or termination is received.')} />
    </div>
  );
}

interface LeaveData {
  balances: Array<{ employeeCode: string; employeeName: string; title: string; status: string; teamLeader: string; supervisor: string; annualEntitlement: number | null; annualUsed: number | null; annualRemaining: number | null; sickRemaining: number | null; availableNow: number | null }>;
  analytics: null | { year: number; employees: number; activeEmployees: number; records: number; annualDays: number; sickDays: number; negativeBalances: number };
  source: { fileName: string | null; importedAt: string | null } | null;
  selfOnly: boolean;
  odoo?: TimeOffView;
}

const ODOO_FILTERS: Array<{ id: 'all' | 'pending' | 'validate' | 'refuse'; label: Localised }> = [
  { id: 'all', label: { ar: 'الكل', en: 'All' } },
  { id: 'pending', label: { ar: 'بانتظار الموافقة', en: 'Awaiting approval' } },
  { id: 'validate', label: { ar: 'معتمدة', en: 'Approved' } },
  { id: 'refuse', label: { ar: 'مرفوضة', en: 'Refused' } },
];

/** Live time off from Odoo: who is out today, what waits for approval, every request and allocation. */
function OdooTimeOffPanel({ odoo }: { odoo: TimeOffView }) {
  const { t, lang } = useHRText();
  const [filter, setFilter] = useState<(typeof ODOO_FILTERS)[number]['id']>('all');
  const requests = (odoo.requests ?? []).filter((leave) => filter === 'all' || (filter === 'pending' ? ['confirm', 'validate1'].includes(leave.state) : leave.state === filter));
  const allocations = odoo.allocations ?? [];
  return (
    <div className="space-y-5">
      <div className="hr-stagger grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric icon={CalendarClock} tone="critical" label={t('في إجازة اليوم', 'On leave today')} value={num(odoo.onLeaveToday?.length ?? 0, lang)} />
        <Metric icon={Plane} tone="info" label={t('من المنزل / مأمورية اليوم', 'Home or mission today')} value={num(odoo.awayToday?.length ?? 0, lang)} />
        <Metric icon={Hourglass} tone={odoo.pending ? 'warning' : 'neutral'} label={t('بانتظار الموافقة', 'Awaiting approval')} value={num(odoo.pending ?? 0, lang)} onClick={() => setFilter('pending')} />
        <Metric icon={CalendarRange} tone="success" label={t('إجازات الأسبوع القادم', 'Leave in the next week')} value={num(odoo.upcoming?.length ?? 0, lang)} />
      </div>
      <Card>
        <SectionTitle title={t('خارج المكتب اليوم', 'Out of the office today')} hint={t('مباشر من Odoo.', 'Live from Odoo.')} />
        <OutTodayStrip absent={odoo.onLeaveToday ?? []} away={odoo.awayToday ?? []} empty={t('لا توجد إجازات معتمدة لليوم في Odoo.', 'Odoo has no approved leave for today.')} />
      </Card>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <SectionTitle title={t(`طلبات الإجازة في Odoo — ${odoo.year ?? ''}`, `Time-off requests in Odoo — ${odoo.year ?? ''}`)} hint={t('النوع والتاريخ والحالة كما في Odoo؛ الموافقة تتم من Odoo نفسه.', 'Type, dates and state as Odoo has them; approval happens in Odoo itself.')} />
          <PillTabs value={filter} onChange={setFilter} options={ODOO_FILTERS.map((entry) => ({ id: entry.id, label: lang === 'en' ? entry.label.en : entry.label.ar }))} label={t('حالة الطلب', 'Request state')} layoutId="odoo-leave-filter" className="mb-3" />
          {requests.length ? <ul className="-mx-2.5 divide-y divide-slate-200/50">{requests.map((leave) => <li key={leave.id}><LeaveRow leave={leave} /></li>)}</ul> : <EmptyBlock icon={<Cloud size={24} />} title={t('لا توجد طلبات بهذه الحالة', 'No requests in this state')} />}
        </Card>
        <Card>
          <SectionTitle title={t('أرصدة Odoo', 'Odoo allocations')} hint={t('المخصص والمستخدم لكل نوع إجازة.', 'Allocated and taken per leave type.')} />
          {allocations.length ? (
            <ul className="space-y-2.5">
              {allocations.map((allocation) => (
                <li key={allocation.id} className="rounded-2xl bg-white/70 p-3 ring-1 ring-white/80">
                  <div className="flex items-center gap-2.5">
                    <PersonAvatar name={personName(allocation.employee, lang)} photoUrl={allocation.employee.photoUrl} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-navy">{personName(allocation.employee, lang)}</p>
                      <LeaveTypeChip type={allocation.type} />
                    </div>
                    <span className="text-end text-[12.5px] font-bold tabular-nums text-navy">{num(allocation.remaining, lang, 1)}<span className="block text-[11px] font-semibold text-slate-400">{t(`من ${num(allocation.days, 'ar', 1)}`, `of ${num(allocation.days, 'en', 1)}`)}</span></span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/70"><span className="block h-full rounded-full bg-[linear-gradient(90deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))]" style={{ width: `${allocation.days ? Math.min(100, (allocation.taken / allocation.days) * 100) : 0}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <EmptyBlock icon={<Cloud size={24} />} title={t('لا توجد أرصدة في Odoo', 'No allocations in Odoo')} />}
        </Card>
      </div>
    </div>
  );
}

export function PersonnelLeave() {
  const { t, lang } = useHRText();
  const [params, setParams] = useSearchParams();
  const negativeOnly = params.get('negative') === '1';
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useHRQuery<LeaveData>(hrApi.leave);
  const rows = useMemo(() => {
    const needle = normaliseSearch(q);
    return (data?.balances ?? [])
      .filter((row) => !negativeOnly || Number(row.availableNow) < 0)
      .filter((row) => !needle || normaliseSearch(`${row.employeeCode} ${row.employeeName} ${row.title}`).includes(needle))
      .map((row) => ({ ...row, id: row.employeeCode }));
  }, [data, negativeOnly, q]);
  const toggleNegative = () => {
    const next = new URLSearchParams(params);
    if (negativeOnly) next.delete('negative');
    else next.set('negative', '1');
    setParams(next, { replace: true });
  };
  const figure = (value: number | null) => <span className={cx('font-semibold tabular-nums', Number(value) < 0 ? 'text-red-700' : 'text-navy')}>{value === null || value === undefined ? '—' : num(value, lang, 1)}</span>;
  const columns: Array<Column<(typeof rows)[number]>> = [
    { key: 'name', header: t('الموظف', 'Employee'), sort: (row) => row.employeeName, cell: (row) => <Link to={`/hr/people/${encodeURIComponent(row.employeeCode)}`} onClick={(event) => event.stopPropagation()} className="min-w-0"><span className="hr-bidi block truncate font-semibold text-navy hover:text-brand-700">{row.employeeName || `#${row.employeeCode}`}</span><span className="block truncate text-[11.5px] text-[#5A6C82]">#{row.employeeCode} · {row.title || '—'}</span></Link> },
    { key: 'available', header: t('المتاح الآن', 'Available now'), align: 'end', sort: (row) => row.availableNow, cell: (row) => figure(row.availableNow) },
    { key: 'entitlement', header: t('الاستحقاق السنوي', 'Annual entitlement'), align: 'end', sort: (row) => row.annualEntitlement, cell: (row) => figure(row.annualEntitlement) },
    { key: 'used', header: t('سنوي مستخدم', 'Annual used'), align: 'end', sort: (row) => row.annualUsed, cell: (row) => figure(row.annualUsed) },
    { key: 'sick', header: t('مرضي متبقٍ', 'Sick remaining'), align: 'end', sort: (row) => row.sickRemaining, cell: (row) => figure(row.sickRemaining) },
  ];

  return (
    <div className="space-y-6">
      <PersonnelHeader
        title={{ ar: 'الإجازات', en: 'Leave' }}
        description={{ ar: 'إجازات Odoo مباشرة — من خارج المكتب اليوم وما ينتظر الموافقة — مع أرصدة ملف الإجازات المعتمد.', en: 'Odoo time off, live — who is out today and what waits for approval — beside the approved leave workbook balances.' }}
        newType="leave"
      />
      {error && !data ? <ErrorBlock error={error} onRetry={reload} /> : loading && !data ? <PageSkeleton rows={1} /> : data ? (
        <>
          {data.odoo?.connected && <OdooTimeOffPanel odoo={data.odoo} />}
          {data.analytics && (
            <div className="hr-stagger grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric icon={UsersRound} label={t('موظفون بأرصدة', 'Employees with balances')} value={num(data.analytics.activeEmployees, lang)} hint={t(`من ${num(data.analytics.employees, lang)} في الملف`, `of ${num(data.analytics.employees, lang)} in the file`)} />
              <Metric icon={Sun} tone="info" label={t(`أيام سنوية ${data.analytics.year}`, `Annual days ${data.analytics.year}`)} value={num(data.analytics.annualDays, lang, 1)} />
              <Metric icon={Thermometer} tone="warning" label={t(`أيام مرضية ${data.analytics.year}`, `Sick days ${data.analytics.year}`)} value={num(data.analytics.sickDays, lang, 1)} />
              <Metric icon={AlertTriangle} label={t('أرصدة سالبة', 'Negative balances')} value={num(data.analytics.negativeBalances, lang)} tone={data.analytics.negativeBalances ? 'critical' : 'neutral'} onClick={toggleNegative} hint={negativeOnly ? t('معروضة الآن — اضغط للكل', 'Showing — click for all') : undefined} />
            </div>
          )}
          <Card>
            <SectionTitle
              title={t('الأرصدة من ملف الإجازات', 'Balances from the leave workbook')}
              hint={data.source?.importedAt ? t(`من ${data.source.fileName ?? 'ملف الإجازات'} · ${date(data.source.importedAt, lang)}`, `From ${data.source.fileName ?? 'the leave workbook'} · ${date(data.source.importedAt, lang)}`) : t('لم يُرفع ملف الإجازات بعد — ارفعه من إعدادات HR.', 'No leave workbook yet — upload it from HR Settings.')}
              action={
                <div className="flex items-center gap-2">
                  {negativeOnly && <button type="button" className="chip bg-red-50 text-red-700" onClick={toggleNegative}>{t('السالبة فقط ✕', 'Negative only ✕')}</button>}
                  {!data.selfOnly && <input className="field !w-44 !py-1.5 !text-[12.5px]" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('بحث…', 'Search…')} aria-label={t('بحث في الأرصدة', 'Search balances')} />}
                </div>
              }
            />
            <DataTable rows={rows} columns={columns} initialSort={negativeOnly ? { key: 'available', direction: 'asc' } : null} caption={t('أرصدة الإجازات', 'Leave balances')} empty={<EmptyBlock title={negativeOnly ? t('لا توجد أرصدة سالبة', 'No negative balances') : t('لا توجد أرصدة', 'No balances')} />} />
          </Card>
        </>
      ) : null}
      <section>
        <SectionTitle title={t('طلبات الإجازة', 'Leave requests')} />
        <CaseBoard types={['leave']} emptyTitle={t('لا توجد طلبات إجازة', 'No leave requests')} emptyBody={t('افتح طلب إجازة لمتابعة الموافقة والتسجيل.', 'Open a leave case to follow its approval and recording.')} />
      </section>
    </div>
  );
}

export default PersonnelLayout;
