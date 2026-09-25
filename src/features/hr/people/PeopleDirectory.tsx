/**
 * /hr/people — everybody, findable. Photo, name, code, title, department,
 * location and status on every row; filters in the URL so HR Home's figures
 * can open a pre-filtered list; and the workforce analysis (age, gender,
 * department strength) above it.
 */

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, Cloud, LayoutGrid, MapPin, Rows3, Search, X } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { hrApi, useHRQuery } from '../api';
import { date, normaliseSearch, num, useHRText } from '../format';
import type { EmployeeSummary, PeopleData } from '../types';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge, Card, HeroStat, PageHeader, PersonAvatar, SectionTitle } from '../ui/primitives';
import { labelColor } from '../ui/theme';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../ui/states';

export function displayName(employee: Pick<EmployeeSummary, 'nameArabic' | 'nameEnglish' | 'employeeCode'>, lang: 'ar' | 'en') {
  return (lang === 'en' ? employee.nameEnglish || employee.nameArabic : employee.nameArabic || employee.nameEnglish) || `#${employee.employeeCode}`;
}

function StatusPill({ status }: { status: string }) {
  const { t } = useHRText();
  if (status === 'active') return <Badge tone="success">{t('نشط', 'Active')}</Badge>;
  if (status === 'inactive') return <Badge tone="neutral">{t('غير نشط', 'Inactive')}</Badge>;
  return <Badge tone="neutral">{t('غير محدد', 'Unknown')}</Badge>;
}

export function PeopleDirectory() {
  const { t, lang } = useHRText();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useHRQuery<PeopleData>(hrApi.people);
  const status = params.get('status') ?? 'active';
  const department = params.get('department') ?? '';
  const location = params.get('location') ?? '';
  const q = params.get('q') ?? '';
  const title = params.get('title') ?? '';
  const view = params.get('view') === 'table' ? 'table' : 'cards';
  const hiredThisMonth = params.get('hired') === 'month';
  const incompleteDocs = params.get('documents') === 'incomplete';
  const source = params.get('source') === 'odoo' ? 'odoo' : params.get('source') === 'hr' ? 'hr' : '';
  const onLeaveOnly = params.get('leave') === 'today';

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const options = useMemo(() => {
    const employees = data?.employees ?? [];
    return {
      departments: [...new Set(employees.map((employee) => employee.department || employee.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')),
      locations: [...new Set(employees.map((employee) => employee.location).filter(Boolean) as string[])].sort(),
    };
  }, [data]);

  const rows = useMemo(() => {
    const needle = normaliseSearch(q);
    const titleNeedle = normaliseSearch(title);
    const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }).slice(0, 7);
    return (data?.employees ?? [])
      .filter((employee) => status === 'all' || employee.status === status)
      .filter((employee) => !department || (employee.department || employee.sector) === department)
      .filter((employee) => !location || employee.location === location)
      .filter((employee) => !needle || normaliseSearch(`${employee.employeeCode} ${employee.nameArabic} ${employee.nameEnglish} ${employee.companyEmail}`).includes(needle))
      .filter((employee) => !titleNeedle || normaliseSearch(employee.title).includes(titleNeedle))
      .filter((employee) => !hiredThisMonth || String(employee.hiringDate ?? '').startsWith(month))
      .filter((employee) => !incompleteDocs || (typeof employee.documentCompletionRate === 'number' && employee.documentCompletionRate < 1))
      .filter((employee) => !source || (employee.source ?? 'hr') === source)
      .filter((employee) => !onLeaveOnly || Boolean(employee.onLeave))
      .map((employee) => ({ ...employee, id: employee.employeeCode }));
  }, [data, status, department, location, q, title, hiredThisMonth, incompleteDocs, source, onLeaveOnly]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton />;
  if (!data) return null;

  const analytics = data.analytics;
  const bands = analytics ? [
    [t('أقل من 25', 'Under 25'), analytics.ageBands.under25],
    ['25–34', analytics.ageBands.from25To34],
    ['35–44', analytics.ageBands.from35To44],
    [t('45 فأكثر', '45+'), analytics.ageBands.over45],
  ] as Array<[string, number]> : [];
  const maxBand = Math.max(1, ...bands.map(([, value]) => value));
  const maxDepartment = Math.max(1, ...(analytics?.departments ?? []).map((item) => item.employees));
  const genderTotal = analytics ? Math.max(1, analytics.gender.male + analytics.gender.female) : 1;
  const chips = [
    hiredThisMonth && { key: 'hired', label: t('معينون هذا الشهر', 'Hired this month') },
    incompleteDocs && { key: 'documents', label: t('مستندات ناقصة', 'Incomplete documents') },
    department && { key: 'department', label: department },
    location && { key: 'location', label: location },
    source === 'odoo' && { key: 'source', label: t('في Odoo فقط', 'Odoo only') },
    source === 'hr' && { key: 'source', label: t('في ملف HR', 'In the HR file') },
    onLeaveOnly && { key: 'leave', label: t('في إجازة اليوم', 'On leave today') },
  ].filter(Boolean) as Array<{ key: string; label: string }>;
  const faces = (data.employees ?? []).filter((employee) => employee.photoUrl && employee.status === 'active').slice(0, 8).map((employee) => ({ name: displayName(employee, lang), photoUrl: employee.photoUrl }));
  const odooInfo = data.odoo;

  const columns: Array<Column<EmployeeSummary & { id: string }>> = [
    {
      key: 'name',
      header: t('الموظف', 'Employee'),
      sort: (row) => displayName(row, lang),
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-3">
          <PersonAvatar name={displayName(row, lang)} photoUrl={row.photoUrl} size={34} />
          <span className="min-w-0">
            <span className="block truncate font-bold text-navy">{displayName(row, lang)}</span>
            <span className="block font-mono text-[11px] text-ink-faint">#{row.employeeCode}</span>
          </span>
        </span>
      ),
    },
    { key: 'title', header: t('المسمى الوظيفي', 'Job title'), sort: (row) => row.title, cell: (row) => <span className="line-clamp-2 text-[12.5px]">{row.title || '—'}</span> },
    { key: 'department', header: t('القسم', 'Department'), sort: (row) => row.department || row.sector, cell: (row) => <span className="text-[12.5px] text-[#5A6C82]">{row.department || row.sector || '—'}</span> },
    { key: 'location', header: t('الموقع', 'Location'), sort: (row) => row.location ?? '', cell: (row) => <span className="text-[12.5px] text-[#5A6C82]">{row.location || '—'}</span>, hideOnCard: true },
    { key: 'hired', header: t('التعيين', 'Hired'), sort: (row) => row.hiringDate ?? '', cell: (row) => <span className="whitespace-nowrap text-[12px] text-ink-faint">{date(row.hiringDate, lang)}</span>, hideOnCard: true },
    { key: 'status', header: t('الحالة', 'Status'), sort: (row) => row.status, cell: (row) => <StatusPill status={row.status} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('الموارد البشرية', 'Human resources')}
        title={t('الموظفون', 'People')}
        description={t('ملف HR هو السجل، وOdoo يضيف المسمى والقسم والمدير والصورة والإجازة اليوم — والربط بكود الموظف.', 'The HR file is the record; Odoo adds the job, department, manager, photo and today\'s leave — joined on the employee code.')}
        faces={faces}
        stats={odooInfo?.connected ? (
          <>
            <HeroStat value={num(rows.length, lang)} label={t('معروض', 'shown')} />
            {odooInfo.onLeaveToday ? <HeroStat value={num(odooInfo.onLeaveToday, lang)} label={t('في إجازة اليوم', 'on leave today')} to="/hr/people?leave=today" /> : null}
            {odooInfo.odooOnly ? <HeroStat value={num(odooInfo.odooOnly, lang)} label={t('في Odoo فقط', 'Odoo only')} to="/hr/people?source=odoo" /> : null}
          </>
        ) : undefined}
      />

      {analytics && (
        <div className="hr-stagger grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <SectionTitle title={t('الأعمار', 'Age')} hint={analytics.averageAge ? t(`المتوسط ${analytics.averageAge} سنة`, `Average ${analytics.averageAge} years`) : undefined} />
            <ul className="space-y-2">
              {bands.map(([label, value]) => (
                <li key={label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-[12.5px]">
                  <span className="text-slate-500">{label}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-slate-200/70"><span className="block h-full rounded-full bg-[linear-gradient(90deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] transition-[width] duration-700" style={{ width: `${(value / maxBand) * 100}%` }} /></span>
                  <b className="tabular-nums text-navy">{num(value, lang)}</b>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <SectionTitle title={t('رجال / سيدات', 'Men / women')} hint={t('الموظفون النشطون', 'Active employees')} />
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-200/70">
              <span className="bg-gradient-to-r from-blue-600 to-indigo-600" style={{ width: `${(analytics.gender.male / genderTotal) * 100}%` }} />
              <span className="bg-gradient-to-r from-pink-500 to-rose-500" style={{ width: `${(analytics.gender.female / genderTotal) * 100}%` }} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 py-2.5 ring-1 ring-blue-100"><dt className="text-[11.5px] font-semibold text-blue-700">{t('رجال', 'Men')}</dt><dd className="text-[22px] font-extrabold tabular-nums text-navy">{num(analytics.gender.male, lang)}</dd></div>
              <div className="rounded-2xl bg-gradient-to-br from-pink-50 to-rose-50 py-2.5 ring-1 ring-pink-100"><dt className="text-[11.5px] font-semibold text-pink-700">{t('سيدات', 'Women')}</dt><dd className="text-[22px] font-extrabold tabular-nums text-navy">{num(analytics.gender.female, lang)}</dd></div>
            </dl>
          </Card>
          <Card>
            <SectionTitle title={t('قوة الأقسام', 'Department strength')} />
            <ul className="space-y-2">
              {analytics.departments.slice(0, 6).map((item) => (
                <li key={item.department}>
                  <button type="button" onClick={() => set('department', item.department)} className="block w-full text-start">
                    <span className="flex items-center justify-between gap-2 text-[12.5px]"><span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `rgb(${labelColor(item.department)})` }} aria-hidden="true" /><span className="truncate text-slate-600">{item.department}</span></span><b className="tabular-nums text-navy">{num(item.employees, lang)}</b></span>
                    <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-200/70"><span className="block h-full rounded-full" style={{ width: `${(item.employees / maxDepartment) * 100}%`, backgroundImage: `linear-gradient(90deg, rgb(${labelColor(item.department)}), rgb(${labelColor(item.department)} / 0.55))` }} /></span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <Card padded={false} className="p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
            <input className="field !py-2 ps-9" value={q} onChange={(event) => set('q', event.target.value)} placeholder={t('الاسم أو كود الموظف…', 'Name or employee code…')} aria-label={t('بحث', 'Search')} />
          </div>
          <input className="field !py-2" value={title} onChange={(event) => set('title', event.target.value)} placeholder={t('المسمى الوظيفي…', 'Job title…')} aria-label={t('المسمى الوظيفي', 'Job title')} />
          <select className="field !py-2" value={department} onChange={(event) => set('department', event.target.value)} aria-label={t('القسم', 'Department')}>
            <option value="">{t('كل الأقسام', 'All departments')}</option>
            {options.departments.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select className="field !py-2" value={location} onChange={(event) => set('location', event.target.value)} aria-label={t('الموقع', 'Location')}>
            <option value="">{t('كل المواقع', 'All locations')}</option>
            {options.locations.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <div className="flex gap-1 rounded-2xl border border-white/80 bg-white/60 p-1" role="group" aria-label={t('الحالة', 'Status')}>
            {([['active', t('نشط', 'Active')], ['inactive', t('سابق', 'Inactive')], ['all', t('الكل', 'All')]] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={status === value} onClick={() => set('status', value === 'active' ? '' : value)} className={cx('flex-1 rounded-xl px-2.5 py-1.5 text-[12px] font-semibold transition-colors', status === value ? 'bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] text-white shadow-[0_8px_18px_-10px_rgb(var(--hr-a1)/0.9)]' : 'text-slate-600 hover:bg-white')}>{label}</button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {odooInfo?.connected && !onLeaveOnly && odooInfo.onLeaveToday ? <button type="button" onClick={() => set('leave', 'today')} className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11.5px] font-semibold text-rose-700 hover:bg-rose-100"><CalendarClock size={12} aria-hidden="true" />{t('في إجازة اليوم', 'On leave today')}</button> : null}
          {odooInfo?.connected && !source && odooInfo.odooOnly ? <button type="button" onClick={() => set('source', 'odoo')} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11.5px] font-semibold text-violet-700 hover:bg-violet-100"><Cloud size={12} aria-hidden="true" />{t('في Odoo فقط', 'Odoo only')}</button> : null}
          {chips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => set(chip.key, '')} className="inline-flex items-center gap-1 rounded-full bg-[rgb(var(--hr-a1)/0.12)] px-2.5 py-1 text-[11.5px] font-semibold text-[rgb(var(--hr-a1))] hover:bg-[rgb(var(--hr-a1)/0.2)]">{chip.label}<X size={12} aria-hidden="true" /></button>
          ))}
          <span className="text-[12px] text-slate-500">{t(`${num(rows.length, lang)} موظف`, `${num(rows.length, lang)} people`)}</span>
          <span className="ms-auto flex rounded-xl border border-white/80 bg-white/60 p-0.5">
            <button type="button" aria-pressed={view === 'cards'} onClick={() => set('view', '')} className={cx('grid h-8 w-9 place-items-center rounded-lg transition-colors', view === 'cards' ? 'bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] text-white' : 'text-slate-500 hover:bg-white')} aria-label={t('بطاقات', 'Cards')}><LayoutGrid size={14} /></button>
            <button type="button" aria-pressed={view === 'table'} onClick={() => set('view', 'table')} className={cx('grid h-8 w-9 place-items-center rounded-lg transition-colors', view === 'table' ? 'bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] text-white' : 'text-slate-500 hover:bg-white')} aria-label={t('جدول', 'Table')}><Rows3 size={14} /></button>
          </span>
        </div>
      </Card>

      {view === 'table' ? (
        <DataTable rows={rows} columns={columns} rowHref={(row) => `/hr/people/${encodeURIComponent(row.employeeCode)}`} caption={t('الموظفون', 'People')} empty={<EmptyBlock title={t('لا يوجد موظف يطابق الفلاتر', 'No one matches these filters')} />} />
      ) : rows.length ? (
        <ul className="hr-stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map((employee) => {
            const name = displayName(employee, lang);
            const departmentName = employee.department || employee.sector || '';
            const color = labelColor(departmentName || name);
            return (
              <li key={employee.employeeCode}>
                <Link to={`/hr/people/${encodeURIComponent(employee.employeeCode)}`} className="hr-glass hr-lift group relative flex h-full flex-col overflow-hidden rounded-3xl">
                  {/* A band in the department's colour, the face sitting on its edge. */}
                  <span className="relative block h-16 overflow-hidden" style={{ backgroundImage: `linear-gradient(135deg, rgb(${color}), rgb(${color} / 0.55))` }} aria-hidden="true">
                    <span className="absolute -end-6 -top-8 h-24 w-24 rounded-full bg-white/15" />
                    <span className="absolute end-10 top-6 h-10 w-10 rounded-full border-[6px] border-white/15" />
                  </span>
                  <span className="relative -mt-9 flex items-end justify-between gap-2 px-4">
                    <PersonAvatar name={name} photoUrl={employee.photoUrl} size={64} ring className="transition-transform duration-300 group-hover:scale-105" />
                    <span className="mb-1 flex flex-wrap justify-end gap-1">
                      {employee.onLeave && <span className="inline-flex items-center gap-1 rounded-full bg-rose-500 px-2 py-0.5 text-[10.5px] font-bold text-white shadow"><CalendarClock size={10} aria-hidden="true" />{employee.onLeave.away ? t('خارج المكتب', 'Away') : t('في إجازة', 'On leave')}</span>}
                      {employee.source === 'odoo' && <span className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-[10.5px] font-bold text-white shadow"><Cloud size={10} aria-hidden="true" />Odoo</span>}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col px-4 pb-4 pt-2.5">
                    <span className="hr-bidi block truncate text-[15px] font-bold text-navy" title={name}>{name}</span>
                    <span className="hr-bidi block truncate text-[12.5px] text-slate-500" title={employee.title}>{employee.title || '—'}</span>
                    <span className="mt-3 flex flex-wrap items-center gap-1.5">
                      {departmentName && <span className="hr-bidi max-w-full truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: `rgb(${color})`, backgroundColor: `rgb(${color} / 0.1)` }}>{departmentName}</span>}
                      {employee.location && <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200"><MapPin size={10} aria-hidden="true" />{employee.location}</span>}
                    </span>
                    <span className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11.5px] text-slate-400">
                      <span className="font-mono">#{employee.employeeCode}</span>
                      <StatusPill status={employee.status} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : <EmptyBlock title={t('لا يوجد موظف يطابق الفلاتر', 'No one matches these filters')} />}
    </div>
  );
}

export default PeopleDirectory;
