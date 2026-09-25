/**
 * /hr/payroll — Payroll & Benefits, for `hr.payroll` only (the server refuses
 * everyone else; the sidebar merely hides the link). Cost by department, the
 * salary ranking, insurance and tax totals, and the records that do not line
 * up. Imports moved to HR Settings; this page links there.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Building2, Calculator, Search, ShieldCheck, Upload, UsersRound, Wallet } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { hrApi, useHRQuery } from '../api';
import { date, money, normaliseSearch, num, useHRText } from '../format';
import { useHR } from '../shell/HRContext';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge, Card, Metric, PageHeader, SectionTitle } from '../ui/primitives';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../ui/states';
import { labelColor } from '../ui/theme';
import { useHashScroll } from '../ui/useHashScroll';

interface PayrollPerson {
  employeeCode: string;
  nameArabic: string;
  nameEnglish: string;
  title: string;
  department: string;
  hiringDate: string | null;
}

interface PayrollData {
  analytics: {
    rate: { buy: number; sell: number; asOf: string; source: string; sourceUrl: string; live: boolean };
    totalEgp: number;
    totalUsd: number;
    averageUsd: number;
    employees: number;
    departments: Array<{ department: string; employees: number; totalEgp: number; totalUsd: number; averageUsd: number }>;
    highestCostDepartment: { department: string; totalUsd: number } | null;
    lowestCostDepartment: { department: string; totalUsd: number } | null;
    ranking: Array<{ employeeCode: string; name: string; department: string; totalEgp: number; totalUsd: number }>;
  };
  insurance: { records: number; insured: number; employeeShare: number; employerShare: number; monthlyTax: number; uninsuredOnPayroll: PayrollPerson[] };
  gaps: { activeWithoutPayroll: PayrollPerson[]; payrollWithoutMaster: PayrollPerson[] };
  source: { fileName: string; importedAt: string; summary: Record<string, number> | null } | null;
  employees: Array<{ employeeCode: string; name: string; department: string; hasInsurance: boolean }>;
}

const usd = (value: number | null | undefined, lang: 'ar' | 'en') => money(value, lang, 'USD');

function PeopleList({ people, empty }: { people: PayrollPerson[]; empty: string }) {
  const { lang } = useHRText();
  if (!people.length) return <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-[12.5px] font-semibold text-emerald-800">{empty}</p>;
  return (
    <ul className="max-h-80 divide-y divide-[#EEF2F7] overflow-y-auto rounded-xl border border-[#EEF2F7]">
      {people.map((person) => (
        <li key={person.employeeCode}>
          <Link to={`/hr/people/${encodeURIComponent(person.employeeCode)}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#F7FAFD]">
            <span className="min-w-0">
              <span className="hr-bidi block truncate text-[13px] font-semibold text-navy">{(lang === 'en' ? person.nameEnglish || person.nameArabic : person.nameArabic || person.nameEnglish) || `#${person.employeeCode}`}</span>
              <span className="block truncate text-[11.5px] text-[#5A6C82]">#{person.employeeCode} · {[person.title, person.department].filter(Boolean).join(' · ') || '—'}</span>
            </span>
            {person.hiringDate && <span className="shrink-0 text-[11.5px] text-ink-faint">{date(person.hiringDate, lang)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PayrollPage() {
  const { t, lang } = useHRText();
  const { access } = useHR();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useHRQuery<PayrollData>(hrApi.payroll);
  const [q, setQ] = useState('');
  const department = params.get('department') ?? '';
  useHashScroll(Boolean(data));

  const insuranceByCode = useMemo(() => new Map((data?.employees ?? []).map((employee) => [employee.employeeCode, employee.hasInsurance])), [data]);
  const rows = useMemo(() => {
    const needle = normaliseSearch(q);
    return (data?.analytics.ranking ?? [])
      .filter((row) => !department || row.department === department)
      .filter((row) => !needle || normaliseSearch(`${row.employeeCode} ${row.name} ${row.department}`).includes(needle))
      .map((row) => ({ ...row, id: row.employeeCode }));
  }, [data, department, q]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton />;
  if (!data) return null;
  const { analytics, insurance, gaps } = data;
  const maxDepartment = Math.max(1, ...analytics.departments.map((item) => item.totalUsd));
  const chooseDepartment = (value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== department) next.set('department', value);
    else next.delete('department');
    setParams(next, { replace: true });
  };

  const columns: Array<Column<(typeof rows)[number]>> = [
    { key: 'name', header: t('الموظف', 'Employee'), sort: (row) => row.name, cell: (row) => <span className="min-w-0"><span className="hr-bidi block truncate font-semibold text-navy">{row.name}</span><span className="block text-[11.5px] text-[#5A6C82]">#{row.employeeCode}</span></span> },
    { key: 'department', header: t('القسم', 'Department'), sort: (row) => row.department, cell: (row) => <span className="text-[12.5px] text-[#5A6C82]">{row.department}</span> },
    { key: 'usd', header: 'USD', align: 'end', sort: (row) => row.totalUsd, cell: (row) => <span className="font-bold tabular-nums text-navy">{usd(row.totalUsd, lang)}</span> },
    { key: 'egp', header: 'EGP', align: 'end', sort: (row) => row.totalEgp, cell: (row) => <span className="tabular-nums text-[#5A6C82]">{money(row.totalEgp, lang)}</span> },
    { key: 'insurance', header: t('التأمين', 'Insurance'), sort: (row) => (insuranceByCode.get(row.employeeCode) ? 1 : 0), cell: (row) => (insuranceByCode.get(row.employeeCode) ? <Badge tone="success">{t('مسجل', 'On record')}</Badge> : <Badge tone="warning">{t('غير موجود', 'Missing')}</Badge>) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('الرواتب والمزايا', 'Payroll & Benefits')}
        title={t('تكلفة الرواتب', 'Payroll cost')}
        description={data.source ? t(`من ${data.source.fileName} · رُفع ${date(data.source.importedAt, lang)}`, `From ${data.source.fileName} · uploaded ${date(data.source.importedAt, lang)}`) : t('لم يُرفع ملف الرواتب بعد.', 'No payroll workbook has been uploaded yet.')}
        actions={access?.manage ? <Link to="/hr/settings?section=imports" className="btn-ghost btn-sm"><Upload size={15} />{t('رفع ملف رواتب', 'Upload payroll')}</Link> : null}
      />

      <div className="hr-stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric emphasis icon={Wallet} tone="success" label={t('إجمالي المسير (USD)', 'Total payroll (USD)')} value={usd(analytics.totalUsd, lang)} hint={money(analytics.totalEgp, lang)} />
        <Metric icon={Calculator} label={t('متوسط الموظف', 'Average per employee')} value={usd(analytics.averageUsd, lang)} />
        <Metric icon={UsersRound} tone="info" label={t('على المسير', 'On payroll')} value={num(analytics.employees, lang)} />
        <Metric icon={Building2} label={t('أعلى قسم تكلفة', 'Highest-cost department')} value={<span className="block truncate text-[17px]">{analytics.highestCostDepartment?.department ?? '—'}</span>} hint={analytics.highestCostDepartment ? usd(analytics.highestCostDepartment.totalUsd, lang) : undefined} onClick={analytics.highestCostDepartment ? () => chooseDepartment(analytics.highestCostDepartment!.department) : undefined} />
        <Metric icon={ShieldCheck} label={t('حصة الشركة في التأمينات', 'Employer insurance share')} value={money(insurance.employerShare, lang)} to="#insurance" />
        <Metric icon={AlertTriangle} label={t('نشطون بلا سجل راتب', 'Active without payroll')} value={num(gaps.activeWithoutPayroll.length, lang)} tone={gaps.activeWithoutPayroll.length ? 'warning' : 'neutral'} to="#gaps" />
      </div>
      <p className="text-[11.5px] text-ink-faint">
        {t(`التحويل على سعر بيع الدولار ${num(analytics.rate.sell, lang, 2)} ج.م · ${analytics.rate.source} · ${analytics.rate.asOf}`, `Converted at the USD sell rate of EGP ${num(analytics.rate.sell, lang, 2)} · ${analytics.rate.source} · ${analytics.rate.asOf}`)}
        {!analytics.rate.live && <span className="ms-1 font-semibold text-amber-700">{t('(سعر احتياطي)', '(fallback rate)')}</span>}
      </p>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          <SectionTitle title={t('التكلفة حسب القسم', 'Cost by department')} hint={t('اضغط قسماً لتصفية الترتيب.', 'Click a department to filter the ranking.')} />
          {analytics.departments.length ? (
            <ul className="space-y-1">
              {analytics.departments.map((item) => {
                const color = labelColor(item.department);
                const chosen = department === item.department;
                return (
                  <li key={item.department}>
                    <button type="button" aria-pressed={chosen} onClick={() => chooseDepartment(item.department)} className={cx('w-full rounded-2xl px-2.5 py-2 text-start transition-colors', !chosen && 'hover:bg-white/70')} style={chosen ? { backgroundColor: `rgb(${color} / 0.08)`, boxShadow: `inset 0 0 0 1px rgb(${color} / 0.3)` } : undefined}>
                      <span className="flex items-baseline justify-between gap-3 text-[12.5px]">
                        <span className="flex min-w-0 items-center gap-2 font-semibold text-navy">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `rgb(${color})` }} aria-hidden="true" />
                          <span className="hr-bidi truncate">{item.department}</span>
                          <span className="shrink-0 font-normal text-ink-faint">· {num(item.employees, lang)}</span>
                        </span>
                        <span className="shrink-0 font-bold tabular-nums text-navy">{usd(item.totalUsd, lang)}</span>
                      </span>
                      <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-slate-200/60"><span className="block h-full rounded-full" style={{ width: `${(item.totalUsd / maxDepartment) * 100}%`, backgroundImage: `linear-gradient(90deg, rgb(${color}), rgb(${color} / 0.6))` }} /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyBlock title={t('لا توجد بيانات رواتب', 'No payroll data')} />}
        </Card>

        <Card>
          <SectionTitle
            title={t('ترتيب الرواتب', 'Salary ranking')}
            hint={department ? t(`قسم ${department}`, `${department} department`) : t('كل الأقسام، من الأعلى', 'All departments, highest first')}
            action={
              <div className="flex items-center gap-2">
                {department && <button type="button" className="chip bg-brand-50 text-brand-700" onClick={() => chooseDepartment('')}>{department} ✕</button>}
                <span className="relative">
                  <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
                  <input className="field !w-44 !py-1.5 ps-8 !text-[12.5px]" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('بحث…', 'Search…')} aria-label={t('بحث في الرواتب', 'Search payroll')} />
                </span>
              </div>
            }
          />
          <DataTable rows={rows} columns={columns} rowHref={(row) => `/hr/people/${encodeURIComponent(row.employeeCode)}`} initialSort={{ key: 'usd', direction: 'desc' }} caption={t('ترتيب الرواتب', 'Salary ranking')} empty={<EmptyBlock title={t('لا يوجد موظفون مطابقون', 'No matching employees')} />} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section id="insurance" className="scroll-mt-24">
          <Card>
            <SectionTitle title={<span className="flex items-center gap-2"><ShieldCheck size={16} className="text-brand-600" aria-hidden="true" />{t('التأمينات والضرائب', 'Insurance & tax')}</span>} hint={t('إجماليات شهرية من ملف التأمينات.', 'Monthly totals from the insurance workbook.')} />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                [t('سجلات التأمين', 'Insurance records'), num(insurance.records, lang)],
                [t('مؤمَّن عليهم', 'Insured'), num(insurance.insured, lang)],
                [t('حصة الموظفين', 'Employee share'), money(insurance.employeeShare, lang)],
                [t('حصة الشركة', 'Employer share'), money(insurance.employerShare, lang)],
                [t('الضريبة الشهرية', 'Monthly tax'), money(insurance.monthlyTax, lang)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-[#F6F8FB] p-3"><dt className="text-[11.5px] font-semibold text-[#5A6C82]">{label}</dt><dd className="mt-0.5 text-[16px] font-bold tabular-nums text-navy">{value}</dd></div>
              ))}
            </dl>
            <h3 className="mb-2 mt-5 text-[13px] font-bold text-navy">{t(`على المسير بلا رقم تأميني (${insurance.uninsuredOnPayroll.length})`, `On payroll without an insurance number (${insurance.uninsuredOnPayroll.length})`)}</h3>
            <PeopleList people={insurance.uninsuredOnPayroll} empty={t('كل من على المسير لديه رقم تأميني.', 'Everyone on payroll has an insurance number.')} />
          </Card>
        </section>

        <section id="gaps" className="scroll-mt-24">
          <Card>
            <SectionTitle title={<span className="flex items-center gap-2"><AlertTriangle size={16} className="text-amber-600" aria-hidden="true" />{t('فجوات السجلات', 'Record gaps')}</span>} hint={t('ما لا يتطابق بين قاعدة الموظفين وملف الرواتب.', 'What does not line up between the employee database and payroll.')} />
            <h3 className="mb-2 text-[13px] font-bold text-navy">{t(`نشطون بلا سجل راتب (${gaps.activeWithoutPayroll.length})`, `Active without a payroll row (${gaps.activeWithoutPayroll.length})`)}</h3>
            <PeopleList people={gaps.activeWithoutPayroll} empty={t('كل الموظفين النشطين لهم سجل راتب.', 'Every active employee has a payroll row.')} />
            <h3 className="mb-2 mt-5 text-[13px] font-bold text-navy">{t(`في الرواتب وليسوا في قاعدة الموظفين (${gaps.payrollWithoutMaster.length})`, `On payroll but not in the employee database (${gaps.payrollWithoutMaster.length})`)}</h3>
            <PeopleList people={gaps.payrollWithoutMaster} empty={t('كل سجلات الرواتب لها موظف في القاعدة.', 'Every payroll row matches an employee.')} />
          </Card>
        </section>
      </div>
    </div>
  );
}

export default PayrollPage;
