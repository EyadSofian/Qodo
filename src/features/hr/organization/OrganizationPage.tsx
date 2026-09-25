/**
 * /hr/organization — reporting lines, departments, every vacancy (the
 * structure's empty boxes and Qodo's open job requests) and the office plan.
 * The office plan is open to everyone signed in, as it was before HR V2, so
 * somebody without HR rights lands straight on it.
 */

import { Suspense, lazy, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Armchair, ChevronDown, Cloud, Network, Search, UserCheck, UsersRound, UserX } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { hrApi, useHRQuery } from '../api';
import { normaliseSearch, num, useHRText } from '../format';
import { STATUS_LABEL } from '../labels';
import { useHR } from '../shell/HRContext';
import type { OrgPosition, OrganizationData, RequestStatus } from '../types';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge, Card, HeroStat, Metric, PageHeader, PriorityBadge, SectionTitle } from '../ui/primitives';
import { PillTabs } from '../ui/PillTabs';
import { OdooDepartments, OdooPeopleChart } from './OdooChart';
import { EmptyBlock, ErrorBlock, PageSkeleton, Skeleton } from '../ui/states';

const OfficesPlan = lazy(() => import('../../../pages/Offices').then((module) => ({ default: function OfficesPlan() { return <module.Offices embedded />; } })));

const MATCH_BAR: Record<OrgPosition['matchState'], string> = { matched: 'bg-brand-500', vacant: 'bg-amber-500', unmatched: 'bg-red-500' };

function OrgNode({ node, branches, depth, forceOpen }: { node: OrgPosition; branches: Map<string, OrgPosition[]>; depth: number; forceOpen: boolean }) {
  const { t } = useHRText();
  const [open, setOpen] = useState(depth < 2);
  const children = branches.get(node.id) ?? [];
  const expanded = forceOpen || open;
  return (
    <li className={cx(depth > 0 && 'ms-4 border-s border-[#DCE6F1] ps-3 sm:ms-7 sm:ps-4')}>
      <div className="mb-2 flex items-center gap-2 rounded-xl border border-[#E6ECF3] bg-white p-2.5 shadow-[0_1px_2px_rgba(11,37,69,0.04)]">
        <button
          type="button"
          className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors', children.length ? 'bg-brand-50 text-brand-600 hover:bg-brand-100' : 'invisible')}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={children.length ? expanded : undefined}
          aria-label={children.length ? t(`المرؤوسون (${children.length})`, `Reports (${children.length})`) : undefined}
          tabIndex={children.length ? 0 : -1}
        >
          <ChevronDown size={15} className={cx('transition-transform duration-200', !expanded && '-rotate-90 rtl:rotate-90')} aria-hidden="true" />
        </button>
        <span className={cx('h-8 w-1 shrink-0 rounded-full', MATCH_BAR[node.matchState])} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-navy" title={node.title}>{node.title}</p>
          <p className="truncate text-[11.5px] text-[#5A6C82]">
            {node.employeeCode ? <Link className="font-semibold text-brand-700 hover:underline" to={`/hr/people/${encodeURIComponent(node.employeeCode)}`}>{node.employeeName}</Link> : node.matchState === 'vacant' ? t('منصب شاغر', 'Vacant position') : node.employeeName || t('يحتاج مطابقة', 'Needs matching')}
            {node.departmentCode ? ` · ${node.departmentCode}` : ''}
          </p>
        </div>
        {children.length > 0 && <span className="shrink-0 rounded-full bg-[#F1F5FA] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#5A6C82]">{children.length}</span>}
      </div>
      {expanded && children.length > 0 && (
        <ul>{children.map((child) => <OrgNode key={child.id} node={child} branches={branches} depth={depth + 1} forceOpen={forceOpen} />)}</ul>
      )}
    </li>
  );
}

function Chart({ data }: { data: OrganizationData }) {
  const { t } = useHRText();
  const [q, setQ] = useState('');
  const [state, setState] = useState<'' | OrgPosition['matchState']>('');
  const { roots, branches } = useMemo(() => {
    const needle = normaliseSearch(q);
    const shown = data.positions.filter((position) => (!needle || normaliseSearch(`${position.title} ${position.employeeName} ${position.departmentCode} ${position.employeeCode ?? ''}`).includes(needle)) && (!state || position.matchState === state));
    const ids = new Set(shown.map((position) => position.id));
    const map = new Map<string, OrgPosition[]>();
    for (const position of shown) {
      if (!position.managerPositionId || !ids.has(position.managerPositionId)) continue;
      map.set(position.managerPositionId, [...(map.get(position.managerPositionId) ?? []), position]);
    }
    return { roots: shown.filter((position) => !position.managerPositionId || !ids.has(position.managerPositionId)), branches: map };
  }, [data, q, state]);
  const filtering = Boolean(q || state);
  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 border-b border-[#EEF2F7] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] font-semibold text-[#5A6C82]">
          {([['matched', t('مرتبط بموظف', 'Matched')], ['vacant', t('شاغر', 'Vacant')], ['unmatched', t('يحتاج مطابقة', 'Needs matching')]] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={state === key} onClick={() => setState(state === key ? '' : key)} className={cx('flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors', state === key ? 'bg-navy text-white' : 'hover:bg-[#F6F8FB]')}>
              <span className={cx('h-2.5 w-2.5 rounded-sm', MATCH_BAR[key])} aria-hidden="true" />{label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input className="field !py-2 ps-9" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('منصب، اسم، قسم…', 'Position, name, department…')} aria-label={t('بحث في الهيكل', 'Search the structure')} />
        </div>
      </div>
      <div className="max-h-[70dvh] overflow-auto p-4 sm:p-5">
        {roots.length ? <ul>{roots.map((root) => <OrgNode key={root.id} node={root} branches={branches} depth={0} forceOpen={filtering} />)}</ul> : <EmptyBlock title={data.positions.length ? t('لا توجد مناصب مطابقة', 'No matching positions') : t('لم يُرفع ملف الهيكل بعد', 'No organization workbook yet')} body={data.positions.length ? undefined : t('ارفعه من إعدادات HR ← تحديث البيانات.', 'Upload it from HR Settings → Imports.')} />}
      </div>
    </Card>
  );
}

function Departments({ data }: { data: OrganizationData }) {
  const { t, lang } = useHRText();
  if (!data.departments.length) return <EmptyBlock title={t('لا توجد أقسام', 'No departments')} />;
  const max = Math.max(1, ...data.departments.map((entry) => entry.employees));
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {data.departments.map((entry) => (
        <Card key={entry.name} className="flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="hr-bidi truncate text-[14px] font-bold text-navy">{entry.name}</h3>
              {entry.sector && entry.sector !== entry.name && <p className="truncate text-[11.5px] text-[#5A6C82]">{entry.sector}</p>}
            </div>
            <Link to={`/hr/people?department=${encodeURIComponent(entry.name)}`} className="shrink-0 text-end">
              <span className="block text-[22px] font-bold leading-7 tabular-nums text-navy hover:text-brand-700">{num(entry.employees, lang)}</span>
              <span className="block text-[11px] text-[#5A6C82]">{t('موظف', 'people')}</span>
            </Link>
          </div>
          <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(entry.employees / max) * 100}%` }} /></span>
          <div className="mt-3 flex-1">
            <p className="text-[11.5px] font-semibold text-[#5A6C82]">{t('المديرون المباشرون', 'Direct managers')}</p>
            {entry.managers.length ? (
              <ul className="mt-1 space-y-0.5">{entry.managers.map((manager) => <li key={manager.name} className="flex justify-between gap-2 text-[12.5px]"><span className="hr-bidi truncate text-navy">{manager.name}</span><span className="shrink-0 tabular-nums text-ink-faint">{num(manager.count, lang)}</span></li>)}</ul>
            ) : <p className="mt-1 text-[12px] text-ink-faint">—</p>}
          </div>
          {entry.openJobs > 0 && (
            <Link to={`/hr/organization?view=vacancies&department=${encodeURIComponent(entry.name)}`} className="mt-3 flex items-center justify-between rounded-lg bg-brand-50 px-2.5 py-1.5 text-[12px] font-semibold text-brand-800 hover:bg-brand-100">
              <span>{t(`${num(entry.openJobs, 'ar')} طلب توظيف مفتوح`, `${num(entry.openJobs, 'en')} open job requests`)}</span>
              <span className="tabular-nums">{t(`${num(entry.openSeats, 'ar')} مقعد`, `${num(entry.openSeats, 'en')} seats`)}</span>
            </Link>
          )}
        </Card>
      ))}
    </div>
  );
}

/** Department names are typed by hand on requests, so they match loosely — the same rule the server counts open seats with. */
function sameDepartment(left: string, right: string) {
  const a = normaliseSearch(left).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const b = normaliseSearch(right).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return Boolean(a && b) && (a === b || (b.length > 2 && a.includes(b)) || (a.length > 2 && b.includes(a)));
}

function Vacancies({ data }: { data: OrganizationData }) {
  const { t, pick } = useHRText();
  const [params, setParams] = useSearchParams();
  const [source, setSource] = useState<'' | 'structure' | 'recruitment'>('');
  const department = params.get('department') ?? '';
  const rows = data.vacancies.filter((entry) => (!source || entry.source === source) && (!department || sameDepartment(entry.department, department)));
  const clearDepartment = () => {
    const next = new URLSearchParams(params);
    next.delete('department');
    setParams(next, { replace: true });
  };
  const columns: Array<Column<OrganizationData['vacancies'][number]>> = [
    { key: 'title', header: t('المنصب', 'Position'), sort: (row) => row.title, cell: (row) => (row.source === 'recruitment' ? <Link to={`/hr/recruitment/requests/${encodeURIComponent(row.id)}`} className="font-semibold text-navy hover:text-brand-700 hover:underline">{row.title || '—'}</Link> : <span className="font-semibold text-navy">{row.title || '—'}</span>) },
    { key: 'department', header: t('القسم', 'Department'), sort: (row) => row.department, cell: (row) => <span className="text-[12.5px] text-[#5A6C82]">{row.department || '—'}</span> },
    { key: 'source', header: t('المصدر', 'Source'), sort: (row) => row.source, cell: (row) => (row.source === 'recruitment' ? <Badge tone="info">{t('طلب توظيف', 'Job request')}</Badge> : <Badge tone="neutral">{t('الهيكل', 'Structure')}</Badge>) },
    { key: 'status', header: t('الحالة', 'Status'), cell: (row) => (row.source === 'recruitment' ? <span className="flex flex-wrap items-center gap-1.5"><PriorityBadge priority={row.priority ?? null} /><span className="text-[12px] text-[#5A6C82]">{STATUS_LABEL[row.status as RequestStatus] ? pick(STATUS_LABEL[row.status as RequestStatus]) : row.status}</span></span> : <span className="text-[12px] text-amber-700">{t('شاغر في الهيكل', 'Vacant in the structure')}</span>) },
    { key: 'seats', header: t('المقاعد', 'Seats'), align: 'end', sort: (row) => row.openSeats ?? 1, cell: (row) => <span className="font-semibold tabular-nums text-navy">{row.openSeats ?? 1}</span> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl border border-[#E6ECF3] bg-white p-1" role="group" aria-label={t('المصدر', 'Source')}>
          {([['', t('الكل', 'All')], ['recruitment', t('طلبات التوظيف', 'Job requests')], ['structure', t('شواغر الهيكل', 'Structure vacancies')]] as const).map(([id, label]) => (
            <button key={id || 'all'} type="button" aria-pressed={source === id} onClick={() => setSource(id)} className={cx('rounded-lg px-3 py-1.5 text-[12.5px] font-semibold', source === id ? 'bg-navy text-white' : 'text-[#5A6C82] hover:bg-[#F6F8FB]')}>{label}</button>
          ))}
        </div>
        {department && <button type="button" className="chip bg-brand-50 text-brand-700" onClick={clearDepartment}>{department} ✕</button>}
      </div>
      <DataTable rows={rows} columns={columns} caption={t('الشواغر', 'Vacancies')} empty={<EmptyBlock title={t('لا توجد شواغر', 'No vacancies')} />} />
    </div>
  );
}

function OfficesView() {
  return (
    <Suspense fallback={<div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-96" /></div>}>
      <OfficesPlan />
    </Suspense>
  );
}

export function OrganizationPage() {
  const { t, lang } = useHRText();
  const { access } = useHR();
  const [params, setParams] = useSearchParams();
  const canSeeStructure = Boolean(access?.people);
  const requested = params.get('view') ?? '';
  const { data, error, loading, reload } = useHRQuery<OrganizationData>(canSeeStructure && requested !== 'offices' ? hrApi.organization : null);
  const odoo = data?.odoo.connected ? data.odoo : null;
  // Live Odoo reporting lines by default once Odoo answers; the workbook structure stays a tab.
  const known = ['chart', 'departments', 'vacancies', 'offices', ...(odoo ? ['odoo', 'odoo-departments'] : [])];
  const view = !canSeeStructure ? 'offices' : known.includes(requested) ? requested : odoo ? 'odoo' : 'chart';

  if (access && !canSeeStructure) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow={t('الهيكل التنظيمي', 'Organization')} title={t('المكاتب والمقاعد', 'Offices & seats')} description={t('ابحث عن مكان جلوس أي زميل.', 'Find where any colleague sits.')} />
        <OfficesView />
      </div>
    );
  }

  const views = [
    ...(odoo ? [{ id: 'odoo', label: t('الهيكل من Odoo', 'Odoo chart'), icon: <Cloud size={14} aria-hidden="true" /> }, { id: 'odoo-departments', label: t('أقسام Odoo', 'Odoo departments'), icon: <Cloud size={14} aria-hidden="true" /> }] : []),
    { id: 'chart', label: t('ملف الهيكل', 'Structure file') },
    { id: 'departments', label: t('الأقسام', 'Departments') },
    { id: 'vacancies', label: t('الشواغر', 'Vacancies') },
    { id: 'offices', label: t('المكاتب', 'Offices') },
  ];
  const openSeats = data?.vacancies.reduce((sum, entry) => sum + (entry.openSeats ?? 1), 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('الهيكل التنظيمي', 'Organization')}
        title={t('الهيكل والشواغر', 'Structure & vacancies')}
        description={t('من يدير من — مباشرة من Odoo — وقوة كل قسم، وكل منصب شاغر وطلب توظيف مفتوح، ومكان جلوس كل شخص.', 'Who reports to whom — live from Odoo — each department\'s strength, every empty position and open job request, and where everybody sits.')}
        faces={odoo ? odoo.people.filter((person) => person.hasPhoto).slice(0, 8).map((person) => ({ name: person.nameArabic || person.nameEnglish, photoUrl: person.photoUrl })) : undefined}
        stats={odoo ? (
          <>
            <HeroStat value={num(odoo.people.length, lang)} label={t('موظف نشط في Odoo', 'active in Odoo')} />
            <HeroStat value={num(odoo.departments.length, lang)} label={t('قسم', 'departments')} />
          </>
        ) : undefined}
      />
      {data && !['offices', 'odoo', 'odoo-departments'].includes(view) && (
        <div className="hr-stagger grid grid-cols-2 gap-3 md:grid-cols-5">
          <Metric icon={Network} label={t('المناصب', 'Positions')} value={num(data.analytics.total, lang)} onClick={() => setParams({ view: 'chart' }, { replace: true })} />
          <Metric icon={UserCheck} label={t('مرتبط بموظف', 'Matched')} value={num(data.analytics.matched, lang)} tone="info" />
          <Metric icon={UserX} label={t('شاغر في الهيكل', 'Vacant in the structure')} value={num(data.analytics.vacant, lang)} tone={data.analytics.vacant ? 'warning' : 'neutral'} onClick={() => setParams({ view: 'vacancies' }, { replace: true })} />
          <Metric icon={AlertTriangle} label={t('يحتاج مطابقة', 'Needs matching')} value={num(data.analytics.unmatched, lang)} tone={data.analytics.unmatched ? 'critical' : 'neutral'} to="/hr/settings?section=reconciliation" />
          <Metric icon={Armchair} label={t('مقاعد مفتوحة', 'Open seats')} value={num(openSeats, lang)} tone={openSeats ? 'success' : 'neutral'} onClick={() => setParams({ view: 'vacancies' }, { replace: true })} />
        </div>
      )}
      <PillTabs value={view} onChange={(next) => setParams({ view: next }, { replace: true })} options={views} label={t('عروض الهيكل', 'Organization views')} layoutId="organization-view" />
      {view === 'offices' ? <OfficesView /> : error && !data ? <ErrorBlock error={error} onRetry={reload} /> : loading && !data ? <PageSkeleton rows={1} /> : data ? (
        view === 'odoo' && odoo ? <OdooPeopleChart odoo={odoo} /> : view === 'odoo-departments' && odoo ? <OdooDepartments odoo={odoo} /> : view === 'departments' ? <Departments data={data} /> : view === 'vacancies' ? <Vacancies data={data} /> : (
          <>
            <Chart data={data} />
            <Card>
              <SectionTitle title={<span className="flex items-center gap-2"><UsersRound size={16} className="text-brand-600" aria-hidden="true" />{t('التوزيع حسب النوع', 'By gender')}</span>} hint={t('الموظفون النشطون في قاعدة الموظفين.', 'Active employees in the employee database.')} />
              <div className="flex flex-wrap gap-4 text-[13px]">
                <span><b className="tabular-nums text-navy">{num(data.genders.male, lang)}</b> <span className="text-[#5A6C82]">{t('ذكور', 'male')}</span></span>
                <span><b className="tabular-nums text-navy">{num(data.genders.female, lang)}</b> <span className="text-[#5A6C82]">{t('إناث', 'female')}</span></span>
                {data.genders.unspecified > 0 && <span><b className="tabular-nums text-navy">{num(data.genders.unspecified, lang)}</b> <span className="text-[#5A6C82]">{t('غير محدد', 'unspecified')}</span></span>}
              </div>
            </Card>
          </>
        )
      ) : null}
    </div>
  );
}

export default OrganizationPage;
