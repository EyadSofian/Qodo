/**
 * /hr/reports — every HR report in one shape. Pick a report, narrow it with
 * the shared filters (dates, employee, department, job, recruiter), and click
 * any headline to see exactly the rows behind it; every row opens the job,
 * the employee or the recruiter it describes, and the view exports as CSV.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Download, FileBarChart, Search, X } from 'lucide-react';
import { matchesReportFilter } from '@shared/hrReportFilter';
import { cx } from '../../../lib/utils';
import { hrApi, useHRQuery } from '../api';
import { date, money, normaliseSearch, num, useHRText } from '../format';
import { LOCATION_LABEL, STATUS_LABEL } from '../labels';
import { useHR } from '../shell/HRContext';
import type { Localised, Priority, RecruiterCardData, ReportResult } from '../types';
import { DataTable, type Column } from '../ui/DataTable';
import { Card, PageHeader, PriorityBadge } from '../ui/primitives';
import { PillTabs } from '../ui/PillTabs';
import { EmptyBlock, ErrorBlock, Skeleton } from '../ui/states';
import { TONE } from '../ui/tones';

const REPORT_META: Record<string, { label: Localised; hint: Localised; recruitment: boolean }> = {
  recruitment_sla: { label: { ar: 'أداء الـSLA', en: 'SLA performance' }, hint: { ar: 'كل وظيفة بدأ لها SLA: الموعد، الإغلاق، والنتيجة.', en: 'Every job with a started SLA: due date, closing and outcome.' }, recruitment: true },
  recruiter_productivity: { label: { ar: 'إنتاجية مسؤولي التوظيف', en: 'Recruiter productivity' }, hint: { ar: 'ما بدأ وما أُغلق وما تأخر لكل مسؤول، مع KPI والمكافآت.', en: 'What each recruiter started, closed and let slip, with KPI and rewards.' }, recruitment: true },
  recruitment_funnel: { label: { ar: 'قمع التوظيف', en: 'Recruitment funnel' }, hint: { ar: 'من Odoo: مستلمون، بعد الفرز، مقابلات، مقبولون، عروض، تعيين.', en: 'From Odoo: received, filtered, interviewed, accepted, offered, hired.' }, recruitment: true },
  instructor_history: { label: { ar: 'سجل توظيف المدربين', en: 'Instructor hiring history' }, hint: { ar: 'طلبات المدربين في مصر والسعودية ومدة إغلاقها.', en: 'Instructor requests in Egypt and Saudi Arabia and how long they took.' }, recruitment: true },
  kpi: { label: { ar: 'KPI التوظيف شهرياً', en: 'Recruitment KPI by month' }, hint: { ar: 'نتيجة كل مسؤول في كل شهر بمحاورها الأربعة.', en: 'Each recruiter\'s score per month across the four categories.' }, recruitment: true },
  payroll: { label: { ar: 'الرواتب', en: 'Payroll' }, hint: { ar: 'إجمالي كل موظف بالدولار والجنيه.', en: 'Each employee\'s total in USD and EGP.' }, recruitment: false },
  workforce: { label: { ar: 'القوى العاملة', en: 'Workforce' }, hint: { ar: 'الموظفون بالقسم والنوع والعمر وتاريخ التعيين.', en: 'Employees by department, gender, age and hiring date.' }, recruitment: false },
  quarterly_reviews: { label: { ar: 'التقييمات الربع سنوية', en: 'Quarterly reviews' }, hint: { ar: 'كل تقييم ربع سنوي وحالته ونتيجته.', en: 'Every quarterly review, its status and score.' }, recruitment: false },
};

const COLUMN_LABEL: Record<string, Localised> = {
  reference: { ar: 'المرجع', en: 'Reference' },
  title: { ar: 'الوظيفة', en: 'Job' },
  department: { ar: 'القسم', en: 'Department' },
  priority: { ar: 'الأولوية', en: 'Priority' },
  recruiter: { ar: 'المسؤول', en: 'Recruiter' },
  start: { ar: 'بداية الـSLA', en: 'SLA start' },
  due: { ar: 'الاستحقاق', en: 'Due' },
  completed: { ar: 'الإغلاق', en: 'Completed' },
  target: { ar: 'المستهدف (يوم عمل)', en: 'Target (WD)' },
  actual: { ar: 'الفعلي (يوم عمل)', en: 'Actual (WD)' },
  outcome: { ar: 'النتيجة', en: 'Outcome' },
  started: { ar: 'بدأت', en: 'Started' },
  onTime: { ar: 'في الموعد', en: 'On time' },
  late: { ar: 'متأخرة', en: 'Late' },
  open: { ar: 'مفتوحة', en: 'Open' },
  overdue: { ar: 'متأخرة الآن', en: 'Overdue now' },
  averageWorkingDays: { ar: 'متوسط أيام الإغلاق', en: 'Avg. days to close' },
  kpi: { ar: 'KPI', en: 'KPI' },
  rewardBatches: { ar: 'مكافآت', en: 'Rewards' },
  received: { ar: 'مستلمون', en: 'Received' },
  filtered: { ar: 'بعد الفرز', en: 'Filtered' },
  interviewed: { ar: 'مقابلات', en: 'Interviewed' },
  accepted: { ar: 'مقبولون', en: 'Accepted' },
  offer: { ar: 'عروض', en: 'Offers' },
  hired: { ar: 'تعيين', en: 'Hired' },
  location: { ar: 'الموقع', en: 'Location' },
  status: { ar: 'الحالة', en: 'Status' },
  workingDays: { ar: 'أيام العمل', en: 'Working days' },
  employeeCode: { ar: 'الكود', en: 'Code' },
  name: { ar: 'الاسم', en: 'Name' },
  totalUsd: { ar: 'الإجمالي USD', en: 'Total USD' },
  totalEgp: { ar: 'الإجمالي EGP', en: 'Total EGP' },
  gender: { ar: 'النوع', en: 'Gender' },
  age: { ar: 'العمر', en: 'Age' },
  hiringDate: { ar: 'تاريخ التعيين', en: 'Hiring date' },
  period: { ar: 'الشهر', en: 'Month' },
  percent: { ar: 'النتيجة %', en: 'Score %' },
  hr_review: { ar: 'مراجعة HR', en: 'HR review' },
  hiring_target: { ar: 'هدف التعيين', en: 'Hiring target' },
  commitment: { ar: 'الالتزام', en: 'Commitment' },
  system_quality: { ar: 'جودة النظام', en: 'System quality' },
  quarter: { ar: 'الربع', en: 'Quarter' },
};

const ENUM_LABEL: Record<string, Record<string, Localised>> = {
  outcome: {
    met: { ar: 'داخل الـSLA', en: 'Met' },
    missed: { ar: 'بعد الموعد', en: 'Missed' },
    overdue: { ar: 'متأخرة الآن', en: 'Overdue' },
    open: { ar: 'جارية', en: 'Open' },
    on_hold: { ar: 'معلّقة', en: 'On hold' },
    not_started: { ar: 'لم يبدأ', en: 'Not started' },
    unknown: { ar: 'غير معروفة', en: 'Unknown' },
    cancelled: { ar: 'ملغاة', en: 'Cancelled' },
    rejected: { ar: 'مرفوضة', en: 'Rejected' },
  },
  status: {
    ...STATUS_LABEL,
    active: { ar: 'نشط', en: 'Active' },
    inactive: { ar: 'غير نشط', en: 'Inactive' },
    final: { ar: 'معتمد', en: 'Final' },
  },
  gender: { male: { ar: 'ذكر', en: 'Male' }, female: { ar: 'أنثى', en: 'Female' }, unspecified: { ar: 'غير محدد', en: 'Unspecified' } },
  location: LOCATION_LABEL,
};

const OUTCOME_TONE: Record<string, string> = { met: TONE.success.text, missed: TONE.critical.text, overdue: TONE.critical.text, unknown: 'text-ink-faint' };
const PERCENT_KEYS = new Set(['percent', 'kpi']);
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/;
const isLocalised = (value: unknown): value is Localised => Boolean(value && typeof value === 'object' && 'ar' in (value as object) && 'en' in (value as object));

type Row = ReportResult['rows'][number];

/** One cell as text — the table and the CSV say the same thing. */
function cellText(key: string, value: unknown, lang: 'ar' | 'en'): string {
  if (value === null || value === undefined || value === '') return '—';
  if (ENUM_LABEL[key] && typeof value === 'string') return ENUM_LABEL[key][value]?.[lang] ?? value;
  if (isLocalised(value)) return (lang === 'en' ? value.en || value.ar : value.ar || value.en) || '—';
  if (key === 'period' && typeof value === 'string') return value;
  if (typeof value === 'string' && DATE_LIKE.test(value)) return date(value, lang);
  if (typeof value === 'number') {
    if (key === 'totalUsd') return money(value, lang, 'USD');
    if (key === 'totalEgp') return money(value, lang, 'EGP');
    if (PERCENT_KEYS.has(key)) return `${num(value, lang, 1)}%`;
    return num(value, lang, 1);
  }
  if (typeof value === 'boolean') return value ? '✓' : '—';
  return String(value);
}

function sortValue(value: unknown, lang: 'ar' | 'en'): string | number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (isLocalised(value)) return lang === 'en' ? value.en : value.ar;
  return String(value);
}

function rowTarget(reportId: string, row: Row): string | null {
  if (typeof row.reference === 'string') return `/hr/recruitment/requests/${encodeURIComponent(row.id)}`;
  if (typeof row.employeeCode === 'string') return `/hr/people/${encodeURIComponent(row.employeeCode)}`;
  if (typeof row.recruiterCode === 'string') return `/hr/recruitment/kpi?recruiter=${encodeURIComponent(row.recruiterCode)}${reportId === 'kpi' && typeof row.period === 'string' ? `&period=${row.period}` : ''}`;
  return null;
}

function toCsv(columns: string[], rows: Row[], lang: 'ar' | 'en') {
  const escape = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  const header = columns.map((key) => escape(COLUMN_LABEL[key]?.[lang] ?? key)).join(',');
  const body = rows.map((row) => columns.map((key) => {
    const value = row[key];
    // Numbers and ISO dates export raw, so a spreadsheet can sum and sort them.
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string' && DATE_LIKE.test(value)) return value.slice(0, 10);
    const text = cellText(key, value, lang);
    return escape(text === '—' ? '' : text);
  }).join(','));
  // The byte-order mark makes Excel read the Arabic as UTF-8.
  return `﻿${[header, ...body].join('\r\n')}`;
}

const FILTER_KEYS = ['from', 'to', 'employee', 'department', 'job', 'recruiter'] as const;

export function ReportsPage() {
  const { t, lang, pick } = useHRText();
  const { access } = useHR();
  const [params, setParams] = useSearchParams();
  const list = useHRQuery<{ reports: string[] }>(hrApi.reports);
  const available = (list.data?.reports ?? []).filter((id) => REPORT_META[id]);
  const reportId = available.includes(params.get('report') ?? '') ? params.get('report')! : available[0] ?? null;
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const { data, error, loading, reload } = useHRQuery<ReportResult>(reportId && !invalidRange ? hrApi.report(reportId, filters) : null);
  const team = useHRQuery<{ team: RecruiterCardData[] }>(reportId && REPORT_META[reportId]?.recruitment && access?.recruitment ? '/hr/recruitment/team' : null);
  const drill = params.get('drill') ?? '';
  const [q, setQ] = useState('');

  const set = (changes: Record<string, string | null>, replace = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace });
  };

  const current = data && data.id === reportId ? data : null;
  const drilled = current?.headline.find((entry) => entry.key === drill) ?? null;
  const rows = useMemo(() => {
    if (!current) return [];
    const needle = normaliseSearch(q);
    return current.rows
      .filter((row) => matchesReportFilter(row, drilled?.filter ?? null))
      .filter((row) => !needle || normaliseSearch(current.columns.map((key) => cellText(key, row[key], lang)).join(' ')).includes(needle));
  }, [current, drilled, q, lang]);

  if (list.error && !list.data) return <ErrorBlock error={list.error} onRetry={list.reload} />;

  const exportCsv = () => {
    if (!current || !reportId) return;
    const blob = new Blob([toCsv(current.columns, rows, lang)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportId}${drilled ? `-${drilled.key}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const columns: Array<Column<Row>> = (current?.columns ?? []).map((key) => ({
    key,
    header: pick(COLUMN_LABEL[key] ?? { ar: key, en: key }),
    align: typeof current?.rows.find((row) => row[key] !== null && row[key] !== undefined)?.[key] === 'number' ? 'end' : 'start',
    sort: (row: Row) => sortValue(row[key], lang),
    cell: (row: Row) => {
      const value = row[key];
      if (key === 'priority') return <PriorityBadge priority={(value as Priority | null) ?? null} />;
      const text = cellText(key, value, lang);
      if (key === 'title' || key === 'name' || key === 'recruiter') return <span className="block min-w-[9rem] font-semibold text-navy">{text}</span>;
      if (key === 'outcome') return <span className={cx('font-semibold', OUTCOME_TONE[String(value)] ?? 'text-navy')}>{text}</span>;
      return <span className={cx('whitespace-nowrap', typeof value === 'number' && 'tabular-nums', text === '—' && 'text-ink-faint')}>{text}</span>;
    },
  }));

  const recruitmentReport = Boolean(reportId && REPORT_META[reportId]?.recruitment);
  const recruiters = (team.data?.team ?? []).map((card) => card.member);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('التقارير', 'Reports')}
        title={t('تقارير الموارد البشرية', 'HR reports')}
        description={t('كل رقم في رأس التقرير يفتح الصفوف التي حُسب منها، وكل صف يفتح الوظيفة أو الموظف.', 'Every headline number opens the rows it was counted from, and every row opens its job or employee.')}
        actions={current ? <button type="button" className="btn-ghost btn-sm" onClick={exportCsv} disabled={!rows.length}><Download size={15} />{t('تصدير CSV', 'Export CSV')}</button> : null}
      />

      {list.loading && !list.data ? <Skeleton className="h-12" /> : available.length ? (
        <PillTabs
          wrap
          value={reportId ?? ''}
          onChange={(id) => set({ report: id, drill: null }, false)}
          options={available.map((id) => ({ id, label: pick(REPORT_META[id].label), icon: <FileBarChart size={14} aria-hidden="true" /> }))}
          label={t('التقارير', 'Reports')}
          layoutId="report-choice"
        />
      ) : <EmptyBlock icon={<BarChart3 size={24} />} title={t('لا توجد تقارير ضمن صلاحياتك', 'No reports within your access')} />}

      {reportId && (
        <>
          <Card padded={false} className="p-3">
            <p className="mb-2.5 px-1 text-[12.5px] text-[#5A6C82]">{pick(REPORT_META[reportId].hint)}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <label className="block"><span className="sr-only">{t('من', 'From')}</span><input type="date" className="field !py-2" value={filters.from} onChange={(event) => set({ from: event.target.value, drill: null })} aria-label={t('من تاريخ', 'From date')} /></label>
              <label className="block"><span className="sr-only">{t('إلى', 'To')}</span><input type="date" className="field !py-2" value={filters.to} onChange={(event) => set({ to: event.target.value, drill: null })} aria-label={t('إلى تاريخ', 'To date')} /></label>
              <input className="field !py-2" value={filters.employee} onChange={(event) => set({ employee: event.target.value, drill: null })} placeholder={t('الموظف…', 'Employee…')} aria-label={t('الموظف', 'Employee')} />
              <input className="field !py-2" value={filters.department} onChange={(event) => set({ department: event.target.value, drill: null })} placeholder={t('القسم…', 'Department…')} aria-label={t('القسم', 'Department')} />
              <input className="field !py-2" value={filters.job} onChange={(event) => set({ job: event.target.value, drill: null })} placeholder={t('الوظيفة…', 'Job…')} aria-label={t('الوظيفة', 'Job')} />
              {recruitmentReport ? (
                <select className="field !py-2" value={filters.recruiter} onChange={(event) => set({ recruiter: event.target.value, drill: null })} aria-label={t('المسؤول', 'Recruiter')}>
                  <option value="">{t('كل المسؤولين', 'All recruiters')}</option>
                  {recruiters.map((member) => <option key={member.employeeCode} value={member.employeeCode}>{pick(member.shortName)}</option>)}
                </select>
              ) : <span className="hidden lg:block" />}
            </div>
            {invalidRange && <p className="mt-2 px-1 text-[12px] font-semibold text-red-700">{t('تاريخ البداية بعد تاريخ النهاية.', 'The start date is after the end date.')}</p>}
            {FILTER_KEYS.some((key) => filters[key]) && (
              <button type="button" className="mt-2 inline-flex items-center gap-1 px-1 text-[12px] font-semibold text-brand-700 hover:underline" onClick={() => set(Object.fromEntries([...FILTER_KEYS, 'drill'].map((key) => [key, null])))}><X size={12} aria-hidden="true" />{t('مسح الفلاتر', 'Clear filters')}</button>
            )}
          </Card>

          {error && !current ? <ErrorBlock error={error} onRetry={reload} /> : loading && !current ? (
            <div className="space-y-3"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20" />)}</div><Skeleton className="h-64" /></div>
          ) : current ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {current.headline.map((entry) => {
                  const active = drill === entry.key;
                  const tone = entry.tone ?? 'neutral';
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => set({ drill: active ? null : entry.key })}
                      className={cx('group min-w-0 rounded-2xl border bg-white px-4 py-3.5 text-start shadow-[0_1px_2px_rgba(11,37,69,0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-[0_8px_22px_-14px_rgba(11,37,69,0.35)]', active ? 'border-brand-400 ring-2 ring-brand-100' : 'border-[#E6ECF3] hover:border-brand-200')}
                    >
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#5A6C82]">
                        {tone !== 'neutral' && <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', TONE[tone].dot)} aria-hidden="true" />}
                        <span className="truncate">{pick(entry.label)}</span>
                      </span>
                      <span className="mt-1.5 block text-[22px] font-bold leading-7 tabular-nums text-navy">
                        {entry.value === null ? '—' : entry.unit === 'USD' ? money(entry.value, lang, 'USD') : `${num(entry.value, lang, 1)}${entry.unit === '%' ? '%' : ''}`}
                      </span>
                    </button>
                  );
                })}
              </div>
              {current.note && <p className="text-[12px] text-[#5A6C82]">{pick(current.note)}</p>}
              {current.rate && <p className="text-[11.5px] text-ink-faint">{t(`سعر الدولار ${num(current.rate.sell, lang, 2)} ج.م · ${current.rate.source} · ${current.rate.asOf}`, `USD at EGP ${num(current.rate.sell, lang, 2)} · ${current.rate.source} · ${current.rate.asOf}`)}</p>}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#5A6C82]">
                  <span className="font-semibold text-navy">{t(`${num(rows.length, 'ar')} صف`, `${num(rows.length, 'en')} rows`)}</span>
                  {drilled && <button type="button" className="chip bg-brand-50 text-brand-700" onClick={() => set({ drill: null })}>{pick(drilled.label)} ✕</button>}
                </div>
                <div className="relative sm:w-72">
                  <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
                  <input className="field !py-2 ps-9" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('ابحث داخل النتائج…', 'Search the results…')} aria-label={t('بحث داخل النتائج', 'Search the results')} />
                </div>
              </div>
              <DataTable
                rows={rows}
                columns={columns}
                rowHref={(row) => rowTarget(current.id, row)}
                minWidth={Math.max(720, current.columns.length * 118)}
                caption={pick(REPORT_META[current.id].label)}
                empty={<EmptyBlock title={t('لا توجد صفوف', 'No rows')} body={t('غيّر الفلاتر أو التاريخ.', 'Change the filters or the dates.')} />}
              />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

export default ReportsPage;
