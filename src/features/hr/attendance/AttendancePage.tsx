/**
 * /hr/attendance — the fingerprint devices, inside HR.
 *
 * Everything the ZKTeco attendance dashboard shows, in Qodo's HR frame and
 * joined to HR: who is in, late, absent or on leave today, every employee's
 * rate and days, departments, trends against the previous period, and the
 * devices themselves. Absent people with approved Odoo leave are listed as
 * on leave, not absent. Each person opens their HR profile's attendance tab.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, AlarmClock, Building2, CalendarClock, ChevronDown, ExternalLink, Fingerprint, LogIn, RefreshCw, Search, Server, TimerOff, TrendingUp, UserCheck, UserX, UsersRound } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { hrApi, invalidateHR, useHRQuery } from '../api';
import { date as formatDate, dateTime, normaliseSearch, num, pct, useHRText } from '../format';
import { useHR } from '../shell/HRContext';
import { Card, HeroStat, Metric, PageHeader, PersonAvatar, SectionTitle } from '../ui/primitives';
import { PillTabs } from '../ui/PillTabs';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../ui/states';
import { DayStrip, FigureTile, Legend, RangePicker, RateBar, StatusPill } from './components';
import {
  STATUS,
  TODAY_ORDER,
  WEEKDAY,
  clock,
  clockOf,
  clockText,
  displayName,
  hoursText,
  minutesText,
  presetRange,
  profileLink,
  rangeQuery,
  statusColor,
  type AttendanceDepartments,
  type AttendanceEmployees,
  type AttendanceOverview,
  type DateRange,
  type DayStatus,
  type EmployeeSummary,
  type LeaderRow,
  type SnapshotRow,
} from './model';

type Tab = 'today' | 'employees' | 'departments' | 'trends' | 'devices';
const TABS: Tab[] = ['today', 'employees', 'departments', 'trends', 'devices'];

export function AttendancePage() {
  const { t, lang } = useHRText();
  const { access } = useHR();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'today';
  const [range, setRange] = useState<DateRange>(() => presetRange('last30'));
  const query = rangeQuery(range);
  const overview = useHRQuery<AttendanceOverview>(access?.attendance ? `${hrApi.attendance.overview}?${query}` : null, { refreshMs: 60_000 });
  const setTab = (next: Tab) => {
    const copy = new URLSearchParams(params);
    if (next === 'today') copy.delete('tab');
    else copy.set('tab', next);
    setParams(copy, { replace: true });
  };

  if (access && !access.attendance) {
    return (
      <EmptyBlock
        icon={<Fingerprint size={24} />}
        title={access.attendanceConnected ? t('الحضور والانصراف خارج صلاحياتك', 'Attendance is outside your access') : t('جهاز البصمة غير مربوط بعد', 'The fingerprint service is not connected yet')}
        body={access.attendanceConnected ? t('يراه من يملك صلاحية عرض الموظفين أو شئون العاملين. حضورك أنت في ملفك الشخصي.', 'People with the People or Personnel view see it. Your own attendance is on your profile.') : t('اضبط المتغير ATTENDANCE_API_URL على عنوان خدمة الحضور في Railway.', 'Set ATTENDANCE_API_URL to the attendance service address on Railway.')}
      />
    );
  }
  if (overview.error && !overview.data) return <ErrorBlock error={overview.error} onRetry={overview.reload} />;
  if (!overview.data) return <PageSkeleton rows={2} />;
  const data = overview.data;
  if (!data.connected) return <EmptyBlock icon={<Fingerprint size={24} />} title={t('جهاز البصمة غير مربوط بعد', 'The fingerprint service is not connected yet')} />;

  const people = data.snapshot.people;
  const count = (status: DayStatus) => people[status]?.length ?? 0;
  const here = count('ontime') + count('present') + count('late') + count('in') + count('incomplete') + count('excused');
  const snapshotIsToday = data.range.snapshot === data.range.today;
  const refresh = () => {
    invalidateHR('/hr/attendance');
    void overview.reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<><Fingerprint size={13} aria-hidden="true" />{t('أجهزة البصمة ZKTeco', 'ZKTeco fingerprint devices')}</>}
        title={t('الحضور والانصراف', 'Attendance')}
        description={t(
          `من أجهزة البصمة، مربوطة بملف الموظفين وإجازات Odoo. آخر بصمة وصلت ${data.range.data_until ? dateTime(data.range.data_until, lang) : '—'}.`,
          `From the fingerprint devices, joined to the HR file and Odoo time off. Last punch received ${data.range.data_until ? dateTime(data.range.data_until, lang) : '—'}.`,
        )}
        actions={
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={refresh} disabled={overview.loading}><RefreshCw size={15} className={cx(overview.loading && 'animate-spin')} />{t('تحديث', 'Refresh')}</button>
            {access?.attendanceDashboard ? <a className="btn-ghost btn-sm" href={access.attendanceDashboard} target="_blank" rel="noreferrer"><ExternalLink size={15} />{t('إعدادات البصمة', 'Fingerprint settings')}</a> : null}
          </>
        }
        stats={
          <>
            {snapshotIsToday && data.snapshot.in_office !== null && <HeroStat label={t('داخل الآن', 'In now')} value={num(data.snapshot.in_office, lang)} />}
            <HeroStat label={t('حضروا', 'Came in')} value={num(here, lang)} />
            <HeroStat label={t('متأخر', 'Late')} value={num(count('late'), lang)} />
            <HeroStat label={t('غائب', 'Absent')} value={num(count('absent'), lang)} />
            <HeroStat label={t('في إجازة', 'On leave')} value={num(count('leave') + count('away'), lang)} />
            {count('pending') > 0 && <HeroStat label={t('لم يحضر بعد', 'Not in yet')} value={num(count('pending'), lang)} />}
          </>
        }
      />

      {data.range.unsynced_days > 0 && (
        <p className="hr-glass flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[12.5px] leading-6 text-amber-800">
          <TimerOff size={16} className="mt-1 shrink-0" aria-hidden="true" />
          {t(`آخر مزامنة من الأجهزة كانت ${formatDate(data.range.today, lang)}؛ الأيام بعدها لم تصل بعد ولا تُحسب غياباً.`, `The devices last synced on ${formatDate(data.range.today, lang)}; later days have not arrived yet and are never counted as absence.`)}
        </p>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PillTabs
          value={tab}
          onChange={setTab}
          label={t('أقسام الحضور', 'Attendance sections')}
          layoutId="attendance-tabs"
          options={[
            { id: 'today', label: snapshotIsToday ? t('اليوم', 'Today') : t('آخر يوم', 'Last day'), icon: <CalendarClock size={15} aria-hidden="true" /> },
            { id: 'employees', label: t('الموظفون', 'Employees'), icon: <UsersRound size={15} aria-hidden="true" /> },
            { id: 'departments', label: t('الأقسام', 'Departments'), icon: <Building2 size={15} aria-hidden="true" /> },
            { id: 'trends', label: t('التحليلات', 'Trends'), icon: <TrendingUp size={15} aria-hidden="true" /> },
            { id: 'devices', label: t('الأجهزة', 'Devices'), icon: <Server size={15} aria-hidden="true" /> },
          ]}
        />
        {tab !== 'today' && tab !== 'devices' && <RangePicker value={range} onChange={setRange} presets={['week', 'month', 'last30', 'lastMonth']} />}
      </div>

      {tab === 'today' && <TodayView data={data} />}
      {tab === 'employees' && <EmployeesView query={query} />}
      {tab === 'departments' && <DepartmentsView query={query} />}
      {tab === 'trends' && <TrendsView data={data} />}
      {tab === 'devices' && <DevicesView data={data} />}
    </div>
  );
}

/* ── today ─────────────────────────────────────────────────────────── */

function PersonCell({ row, sub }: { row: { code: string; name?: string; department?: string; hr?: SnapshotRow['hr'] }; sub?: ReactNode }) {
  const { lang } = useHRText();
  const name = displayName(row, lang) || `#${row.code}`;
  return (
    <Link to={profileLink(row)} className="flex min-w-0 items-center gap-2.5 rounded-xl p-1 transition-colors hover:bg-slate-50">
      <PersonAvatar name={name} photoUrl={row.hr?.photoUrl} size={34} />
      <span className="min-w-0">
        <span className="hr-bidi block truncate text-[13px] font-semibold text-navy">{name}</span>
        <span className="hr-bidi block truncate text-[11.5px] text-slate-500">{sub ?? (row.department || `#${row.code}`)}</span>
      </span>
    </Link>
  );
}

function TodayView({ data }: { data: AttendanceOverview }) {
  const { t, lang, pick } = useHRText();
  const groups = TODAY_ORDER.filter((status) => (data.snapshot.people[status]?.length ?? 0) > 0);
  const [open, setOpen] = useState<Set<DayStatus>>(() => new Set(['late', 'absent', 'pending', 'leave', 'away', 'incomplete']));
  const toggle = (status: DayStatus) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    return next;
  });
  const arrivals = data.snapshot.arrivals ?? [];
  const firstBin = Math.max(0, arrivals.findIndex((value) => value > 0) - 1);
  const lastBin = arrivals.length - [...arrivals].reverse().findIndex((value) => value > 0);
  const window = arrivals.slice(firstBin, Math.max(firstBin + 8, lastBin + 1));
  const peak = Math.max(1, ...window);
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <p className="text-[13px] font-semibold text-slate-600">
          {formatDate(data.range.snapshot ?? data.range.today, lang)} · {data.snapshot.type === 'work' ? t('يوم عمل', 'Workday') : data.snapshot.type === 'holiday' ? t('عطلة', 'Holiday') : t('ليس يوم عمل', 'Not a workday')}
          {data.snapshot.day?.rate !== null && data.snapshot.day?.rate !== undefined && <> · {t('نسبة الحضور', 'Attendance')} <b className="text-navy">{pct(Math.round(data.snapshot.day.rate * 100), lang)}</b></>}
        </p>
        {!groups.length && <EmptyBlock icon={<CalendarClock size={24} />} title={t('لا توجد بصمات لهذا اليوم بعد', 'No punches for this day yet')} />}
        {groups.map((status) => {
          const rows = data.snapshot.people[status] ?? [];
          const expanded = open.has(status);
          return (
            <Card key={status} padded={false} className="overflow-hidden">
              <button type="button" onClick={() => toggle(status)} aria-expanded={expanded} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-start">
                <span className="flex items-center gap-2.5">
                  <span className="h-3 w-3 rounded-full" style={{ background: statusColor(status) }} aria-hidden="true" />
                  <span className="text-[14.5px] font-bold text-navy">{pick(STATUS[status].label)}</span>
                  <span className="rounded-full bg-slate-100 px-2 text-[12px] font-bold tabular-nums text-slate-700">{num(rows.length, lang)}</span>
                </span>
                <ChevronDown size={17} className={cx('text-slate-500 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
              </button>
              {expanded && (
                <ul className="grid grid-cols-1 gap-1 border-t border-slate-100 p-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {rows.map((row) => (
                    <li key={row.code} className="flex min-w-0 items-center justify-between gap-2 rounded-xl px-1">
                      <PersonCell row={row} />
                      <span className="shrink-0 text-end text-[11.5px] font-semibold tabular-nums text-slate-600">
                        {row.timeOff ? <span className="text-[rgb(110_86_170)]">{row.timeOff.type}</span> : row.first ? <>{clockText(row.first, lang)}{row.last ? ` ← ${clockText(row.last, lang)}` : ''}</> : '—'}
                        {row.late > 0 && <span className="block text-amber-700">+{minutesText(row.late, lang)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
      <aside className="min-w-0 space-y-5">
        {window.some((value) => value > 0) && (
          <Card>
            <SectionTitle title={t('توقيت الوصول', 'Arrival times')} hint={t('عدد من وصلوا في كل نصف ساعة', 'People arriving per half hour')} />
            <div className="flex h-32 items-end gap-1" role="img" aria-label={t('توزيع أوقات الوصول', 'Arrival distribution')}>
              {window.map((value, index) => (
                <span key={index} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] font-bold tabular-nums text-slate-600">{value || ''}</span>
                  <span className="w-full rounded-t-md bg-[rgb(var(--hr-a1))]" style={{ height: `${(value / peak) * 88}px`, opacity: value ? 1 : 0.15, minHeight: 3 }} />
                </span>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10.5px] font-semibold tabular-nums text-slate-500">
              <span>{clock((firstBin) * 30, lang)}</span>
              <span>{clock((firstBin + window.length) * 30, lang)}</span>
            </div>
          </Card>
        )}
        <Card>
          <SectionTitle title={t('آخر البصمات', 'Latest punches')} hint={data.feed.length ? undefined : t('تظهر بصمات اليوم هنا', "Today's punches show here")} />
          <ul className="space-y-1">
            {data.feed.slice(0, 14).map((row, index) => (
              <li key={`${row.code}-${row.at}-${index}`} className="flex items-center justify-between gap-2">
                <PersonCell row={row} sub={row.device} />
                <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-0.5 text-[12px] font-bold tabular-nums text-navy">{clockOf(row.at, lang)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}

/* ── employees ─────────────────────────────────────────────────────── */

type Sort = 'rate' | 'late' | 'absent' | 'arrival' | 'hours' | 'name';

function EmployeesView({ query }: { query: string }) {
  const { t, lang, pick } = useHRText();
  const { data, error, loading, reload } = useHRQuery<AttendanceEmployees>(`${hrApi.attendance.employees}?${query}`);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'late' | 'absent' | 'in'>('active');
  const [sort, setSort] = useState<Sort>('rate');
  const rows = useMemo(() => {
    const needle = normaliseSearch(search);
    const list = (data?.employees ?? []).filter((row) => {
      if (department && row.department !== department) return false;
      if (status === 'active' && !row.active) return false;
      if (status === 'late' && row.today !== 'late') return false;
      if (status === 'absent' && row.today !== 'absent') return false;
      if (status === 'in' && !row.in_office) return false;
      if (!needle) return true;
      return [row.code, row.name, row.hr?.nameArabic, row.hr?.nameEnglish, row.department, row.title].some((value) => normaliseSearch(String(value ?? '')).includes(needle));
    });
    const by: Record<Sort, (row: EmployeeSummary) => number | string> = {
      rate: (row) => row.attendance_rate ?? -1,
      late: (row) => row.late_days ?? 0,
      absent: (row) => row.unexcusedAbsences ?? row.absent_days ?? 0,
      arrival: (row) => -(row.avg_arrival ?? 9999),
      hours: (row) => row.avg_hours ?? -1,
      name: (row) => displayName(row, lang),
    };
    return list.sort((left, right) => {
      const a = by[sort](left);
      const b = by[sort](right);
      if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, lang);
      // Higher first: the arrival key is negated, so the earliest comes first.
      return Number(b) - Number(a);
    });
  }, [data, search, department, status, sort, lang]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (!data || (loading && !data)) return <PageSkeleton rows={1} />;
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <label className="relative min-w-[12rem] flex-1">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input className="field !ps-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('اسم أو كود أو قسم', 'Name, code or department')} aria-label={t('بحث', 'Search')} />
        </label>
        <select className="field !w-auto" value={department} onChange={(event) => setDepartment(event.target.value)} aria-label={t('القسم', 'Department')}>
          <option value="">{t('كل الأقسام', 'All departments')}</option>
          {data.departments.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="field !w-auto" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label={t('الحالة', 'Status')}>
          <option value="active">{t('النشطون', 'Active')}</option>
          <option value="all">{t('الكل', 'Everyone')}</option>
          <option value="in">{t('داخل الآن', 'In now')}</option>
          <option value="late">{t('متأخر اليوم', 'Late today')}</option>
          <option value="absent">{t('غائب اليوم', 'Absent today')}</option>
        </select>
        <select className="field !w-auto" value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label={t('الترتيب', 'Sort')}>
          <option value="rate">{t('الأعلى حضوراً', 'Best attendance')}</option>
          <option value="absent">{t('الأكثر غياباً', 'Most absent')}</option>
          <option value="late">{t('الأكثر تأخيراً', 'Most late')}</option>
          <option value="arrival">{t('الأبكر وصولاً', 'Earliest arrival')}</option>
          <option value="hours">{t('الأطول ساعات', 'Longest hours')}</option>
          <option value="name">{t('الاسم', 'Name')}</option>
        </select>
        <span className="text-[12px] font-semibold text-slate-500">{t(`${num(rows.length, lang)} موظف`, `${num(rows.length, lang)} people`)}</span>
      </div>
      <div className="px-4 pt-3"><Legend statuses={['ontime', 'late', 'excused', 'incomplete', 'absent', 'leave', 'away', 'off', 'holiday']} /></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-[12.5px]">
          <thead>
            <tr className="text-start text-[11.5px] font-bold text-slate-500">
              <th className="px-4 py-3 text-start">{t('الموظف', 'Employee')}</th>
              <th className="px-2 py-3 text-start">{t('اليوم', 'Today')}</th>
              <th className="px-2 py-3 text-start">{t('الحضور', 'Attendance')}</th>
              <th className="px-2 py-3 text-start">{t('الالتزام بالموعد', 'Punctuality')}</th>
              <th className="px-2 py-3 text-start">{t('تأخير', 'Late')}</th>
              <th className="px-2 py-3 text-start">{t('غياب بدون إذن', 'Unexcused')}</th>
              <th className="px-2 py-3 text-start">{t('إجازة', 'Leave')}</th>
              <th className="px-2 py-3 text-start">{t('متوسط الوصول', 'Avg. in')}</th>
              <th className="px-2 py-3 text-start">{t('متوسط الساعات', 'Avg. hours')}</th>
              <th className="px-4 py-3 text-start">{t('آخر الأيام', 'Recent days')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.code} className="transition-colors hover:bg-slate-50/80">
                <td className="max-w-[16rem] px-3 py-2"><PersonCell row={row} sub={[row.department, `#${row.hr?.hrCode ?? row.code}`].filter(Boolean).join(' · ')} /></td>
                <td className="px-2 py-2">
                  <div className="flex flex-col items-start gap-0.5">
                    <StatusPill status={row.today} />
                    {row.today_first && <span className="text-[11px] tabular-nums text-slate-500">{clockText(row.today_first, lang)}{row.today_last ? ` ← ${clockText(row.today_last, lang)}` : ''}</span>}
                  </div>
                </td>
                <td className="px-2 py-2"><RateBar value={row.attendance_rate} /></td>
                <td className="px-2 py-2"><RateBar value={row.effective_schedule === 'fixed' ? row.punctuality : null} /></td>
                <td className="px-2 py-2 tabular-nums"><b className={cx('font-bold', row.late_days ? 'text-amber-700' : 'text-slate-500')}>{num(row.late_days, lang)}</b>{row.late_minutes > 0 && <span className="block text-[11px] text-slate-500">{minutesText(row.late_minutes, lang)}</span>}</td>
                <td className="px-2 py-2 tabular-nums"><b className={cx('font-bold', row.unexcusedAbsences ? 'text-rose-700' : 'text-slate-500')}>{num(row.unexcusedAbsences ?? row.absent_days, lang)}</b></td>
                <td className="px-2 py-2 tabular-nums text-slate-700">{num((row.leaveDays ?? 0) + (row.awayDays ?? 0), lang)}</td>
                <td className="px-2 py-2 tabular-nums text-slate-700">{clock(row.avg_arrival, lang)}</td>
                <td className="px-2 py-2 tabular-nums text-slate-700">{hoursText(row.avg_hours, lang)}</td>
                <td className="px-4 py-2"><DayStrip days={row.strip ?? []} max={22} size={7} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="p-6"><EmptyBlock title={t('لا يوجد موظفون بهذه التصفية', 'Nobody matches these filters')} /></div>}
      </div>
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11.5px] text-slate-500">
        {t('الغياب بدون إذن = أيام بلا بصمة ولا إجازة معتمدة في Odoo. الفترة:', 'Unexcused = days with no punch and no approved Odoo leave. Period:')} {formatDate(data.range.from, lang)} – {formatDate(data.range.to, lang)} · {pick(STATUS.leave.label)} {data.timeOff.connected ? t('من Odoo', 'from Odoo') : t('(Odoo غير متصل)', '(Odoo not connected)')}
      </p>
    </Card>
  );
}

/* ── departments ───────────────────────────────────────────────────── */

function DepartmentsView({ query }: { query: string }) {
  const { t, lang } = useHRText();
  const { data, error, reload } = useHRQuery<AttendanceDepartments>(`${hrApi.attendance.departments}?${query}`);
  const [open, setOpen] = useState<string | null>(null);
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton rows={1} />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {data.departments.map((department) => {
        const key = department.name || '—';
        const expanded = open === key;
        const series = department.daily.slice(-22);
        return (
          <Card key={key} className={cx(expanded && 'lg:col-span-2')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="hr-bidi truncate text-[16px] font-bold text-navy">{department.name || t('بدون قسم', 'No department')}</h3>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {t(`${num(department.employees, lang)} موظف`, `${num(department.employees, lang)} people`)} · {department.schedule === 'flexible' ? t('مواعيد مرنة', 'Flexible hours') : department.late_after !== null ? t(`متأخر بعد ${clock(department.late_after, lang)}`, `Late after ${clock(department.late_after, lang)}`) : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11.5px] font-bold">
                <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-green-800 ring-1 ring-green-200">{t('حضروا', 'In')} {num(department.today.here, lang)}</span>
                {department.today.late > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-800 ring-1 ring-amber-200">{t('متأخر', 'Late')} {num(department.today.late, lang)}</span>}
                {department.today.missing > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-rose-800 ring-1 ring-rose-200">{t('غير موجود', 'Missing')} {num(department.today.missing, lang)}</span>}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <div><dt className="text-[11.5px] font-semibold text-slate-500">{t('الحضور', 'Attendance')}</dt><dd className="mt-1"><RateBar value={department.attendance_rate} /></dd></div>
              <div><dt className="text-[11.5px] font-semibold text-slate-500">{t('الالتزام', 'Punctuality')}</dt><dd className="mt-1"><RateBar value={department.schedule === 'flexible' ? null : department.punctuality} /></dd></div>
              <div><dt className="text-[11.5px] font-semibold text-slate-500">{t('متوسط الوصول', 'Avg. in')}</dt><dd className="mt-0.5 text-[14px] font-bold tabular-nums text-navy">{clock(department.avg_arrival, lang)}</dd></div>
              <div><dt className="text-[11.5px] font-semibold text-slate-500">{t('متوسط الساعات', 'Avg. hours')}</dt><dd className="mt-0.5 text-[14px] font-bold tabular-nums text-navy">{hoursText(department.avg_hours, lang)}</dd></div>
            </dl>
            {series.length > 1 && (
              <div className="mt-4 flex h-12 items-end gap-[3px]" role="img" aria-label={t('نسبة الحضور يومياً', 'Daily attendance rate')}>
                {series.map((point) => (
                  <span key={point.date} title={`${formatDate(point.date, lang, 'short')} · ${point.rate === null ? '—' : pct(Math.round(point.rate * 100), lang)}`} className="flex-1 rounded-t" style={{ height: `${Math.max(4, (point.rate ?? 0) * 48)}px`, background: point.rate === null ? 'rgb(226 232 240)' : point.rate >= 0.9 ? 'rgb(21 128 61)' : point.rate >= 0.75 ? 'rgb(180 83 9)' : 'rgb(190 18 60)', opacity: 0.85 }} />
                ))}
              </div>
            )}
            <button type="button" className="btn-quiet btn-sm mt-3" onClick={() => setOpen(expanded ? null : key)} aria-expanded={expanded}>
              <ChevronDown size={15} className={cx('transition-transform', expanded && 'rotate-180')} />{expanded ? t('إخفاء الموظفين', 'Hide people') : t('عرض الموظفين', 'Show people')}
            </button>
            {expanded && (
              <ul className="mt-3 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {department.members.map((member) => (
                  <li key={member.code} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-slate-50 px-2 py-1.5 ring-1 ring-slate-200/70">
                    <PersonCell row={member} sub={member.title || `#${member.code}`} />
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[12px] font-bold tabular-nums text-navy">{member.attendance_rate === null ? '—' : pct(Math.round(member.attendance_rate * 100), lang)}</span>
                      <DayStrip days={member.strip ?? []} max={14} size={6} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ── trends ────────────────────────────────────────────────────────── */

function delta(current: number | null | undefined, previous: number | null | undefined, scale = 1) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  return Math.round((current - previous) * scale * 10) / 10;
}

function TrendsView({ data }: { data: AttendanceOverview }) {
  const { t, lang } = useHRText();
  const { kpis, previous } = data;
  const work = data.daily.filter((point) => point.type === 'work');
  const tallest = Math.max(1, ...work.map((point) => point.expected));
  const heat = data.heatmap ?? [];
  const peak = Math.max(1, ...heat.flat());
  const hours = Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => heat.some((row) => row[hour] > 0));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <FigureTile label={t('نسبة الحضور', 'Attendance rate')} value={kpis.attendance_rate === null ? '—' : pct(Math.round(kpis.attendance_rate * 100), lang)} delta={delta(kpis.attendance_rate, previous.attendance_rate, 100)} hint={t('مقارنة بالفترة السابقة', 'vs previous period')} />
        <FigureTile label={t('الالتزام بالموعد', 'Punctuality')} value={kpis.punctuality === null ? '—' : pct(Math.round(kpis.punctuality * 100), lang)} delta={delta(kpis.punctuality, previous.punctuality, 100)} />
        <FigureTile label={t('أيام غياب', 'Absent days')} value={num(kpis.absent_days, lang)} delta={delta(kpis.absent_days, previous.absent_days)} better="down" />
        <FigureTile label={t('ساعات تأخير', 'Late hours')} value={num(kpis.late_hours, lang, 1)} delta={delta(kpis.late_hours, previous.late_hours)} better="down" />
        <FigureTile label={t('متوسط الوصول', 'Average arrival')} value={clock(kpis.avg_arrival, lang)} />
        <FigureTile label={t('متوسط ساعات اليوم', 'Average day')} value={hoursText(kpis.avg_hours, lang)} />
        <FigureTile label={t('ساعات إضافية', 'Overtime hours')} value={num(kpis.overtime_hours, lang, 0)} />
        <FigureTile label={t('بصمة ناقصة', 'Missing punches')} value={num(kpis.incomplete_days, lang)} delta={delta(kpis.incomplete_days, previous.incomplete_days)} better="down" hint={t(`${num(kpis.work_days, lang)} يوم عمل`, `${num(kpis.work_days, lang)} workdays`)} />
      </div>

      <Card>
        <SectionTitle title={t('الحضور يوماً بيوم', 'Day by day')} hint={t('كل عمود يوم عمل: في الموعد، متأخر، بصمة ناقصة، غائب', 'Each column a workday: on time, late, missing punch, absent')} action={<Legend statuses={['ontime', 'late', 'incomplete', 'absent']} />} />
        <div className="overflow-x-auto">
          <div className="flex h-48 min-w-[36rem] items-end gap-1" role="img" aria-label={t('الحضور اليومي', 'Daily attendance')}>
            {work.map((point) => {
              const parts: Array<[DayStatus, number]> = [['ontime', point.ontime + point.in], ['late', point.late], ['incomplete', point.incomplete], ['absent', point.absent]];
              return (
                <span key={point.date} className="group flex min-w-0 flex-1 flex-col items-stretch justify-end" title={`${formatDate(point.date, lang)} · ${point.rate === null ? '—' : pct(Math.round(point.rate * 100), lang)}`}>
                  {parts.map(([status, value]) => value > 0 && <span key={status} style={{ height: `${(value / tallest) * 168}px`, background: statusColor(status) }} className="first:rounded-t-md" />)}
                  <span className="mt-1 text-center text-[9.5px] font-semibold tabular-nums text-slate-500">{Number(point.date.slice(8))}</span>
                </span>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <SectionTitle title={t('خريطة البصمات', 'Punch heatmap')} hint={t('البصمات حسب اليوم والساعة', 'Punches by weekday and hour')} />
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-[3px]">
              <thead><tr><th />{hours.map((hour) => <th key={hour} className="text-[10px] font-semibold tabular-nums text-slate-500">{hour}</th>)}</tr></thead>
              <tbody>
                {[5, 6, 0, 1, 2, 3, 4].map((weekday) => (
                  <tr key={weekday}>
                    <th scope="row" className="pe-2 text-start text-[11px] font-semibold text-slate-600">{WEEKDAY[weekday][lang]}</th>
                    {hours.map((hour) => {
                      const value = heat[weekday]?.[hour] ?? 0;
                      return <td key={hour} title={`${value}`} className="h-6 w-6 rounded" style={{ background: value ? `rgb(var(--hr-a1) / ${0.12 + (value / peak) * 0.88})` : 'rgb(241 245 249)' }} />;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <SectionTitle title={t('الأبرز في الفترة', 'Stand-outs this period')} hint={t('من لهم 3 أيام عمل على الأقل', 'People with at least 3 workdays')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LeaderList icon={UserCheck} title={t('الأكثر التزاماً', 'Most punctual')} rows={data.leaders.punctual} value={(row) => pct(Math.round(row.value * 100), lang)} />
            <LeaderList icon={AlarmClock} title={t('الأكثر تأخيراً', 'Most often late')} rows={data.leaders.late} value={(row) => t(`${num(row.value, lang)} يوم`, `${num(row.value, lang)} d`)} />
            <LeaderList icon={UserX} title={t('الأكثر غياباً', 'Most absent')} rows={data.leaders.absent} value={(row) => t(`${num(row.value, lang)} يوم`, `${num(row.value, lang)} d`)} />
            <LeaderList icon={Activity} title={t('الأطول يوماً', 'Longest days')} rows={data.leaders.hours} value={(row) => hoursText(row.value, lang)} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function LeaderList({ icon: Icon, title, rows, value }: { icon: typeof UserCheck; title: string; rows: LeaderRow[]; value: (row: LeaderRow) => string }) {
  const { t } = useHRText();
  return (
    <div className="min-w-0">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-navy"><Icon size={14} className="text-[rgb(var(--hr-a1))]" aria-hidden="true" />{title}</p>
      {rows.length ? (
        <ol className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.code} className="flex items-center justify-between gap-2">
              <PersonCell row={row} />
              <span className="shrink-0 text-[12px] font-bold tabular-nums text-slate-700">{value(row)}</span>
            </li>
          ))}
        </ol>
      ) : <p className="text-[12px] text-slate-500">{t('لا أحد بعد.', 'Nobody yet.')}</p>}
    </div>
  );
}

/* ── devices ───────────────────────────────────────────────────────── */

function DevicesView({ data }: { data: AttendanceOverview }) {
  const { t, lang } = useHRText();
  const devices = data.devices.devices;
  if (!devices.length) return <EmptyBlock icon={<Server size={24} />} title={t('لا توجد أجهزة مسجّلة', 'No devices registered')} />;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {devices.map((device) => {
        const received = device.last_received ? new Date(device.last_received) : null;
        const hoursAgo = received ? (Date.now() - received.getTime()) / 3_600_000 : null;
        const stale = hoursAgo === null || hoursAgo > 3;
        const peak = Math.max(1, ...device.daily);
        return (
          <Metric
            key={`${device.site}-${device.id}`}
            icon={Fingerprint}
            tone={stale ? 'warning' : 'success'}
            label={<span className="font-mono">{device.id}</span>}
            value={num(device.today, lang)}
            hint={
              <span className="block space-y-1 whitespace-normal">
                <span className="block">{t('بصمة اليوم', 'punches today')} · {t(`${num(device.people, lang)} شخص في الفترة`, `${num(device.people, lang)} people in range`)}</span>
                <span className={cx('block font-semibold', stale ? 'text-amber-700' : 'text-green-700')}>
                  <LogIn size={12} className="me-1 inline" aria-hidden="true" />
                  {received ? t(`آخر استلام ${dateTime(device.last_received, lang)}`, `Last received ${dateTime(device.last_received, lang)}`) : t('لم يُستلم شيء بعد', 'Nothing received yet')}
                </span>
                <span className="mt-2 flex h-8 items-end gap-[2px]" aria-hidden="true">
                  {device.daily.slice(-30).map((value, index) => <span key={index} className="flex-1 rounded-t-sm bg-[rgb(var(--hr-a1)/0.55)]" style={{ height: `${Math.max(2, (value / peak) * 32)}px` }} />)}
                </span>
                <span className="block text-[11px] text-slate-500">{device.site} · {t(`الإجمالي ${num(device.lifetime_total, lang)}`, `${num(device.lifetime_total, lang)} all-time`)}</span>
              </span>
            }
          />
        );
      })}
    </div>
  );
}

export default AttendancePage;
