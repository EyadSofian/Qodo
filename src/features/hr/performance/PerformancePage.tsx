/**
 * /hr/performance — one view over the four ways Qodo measures people: the
 * approved KPI scorecards, the recruitment KPI, task scores and the quarterly
 * review. `?tab=scorecards` is the KPI desk itself; `?tab=reviews` is the
 * quarter's reviews; `?filter=low` is where HR Home's attention figure lands.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Briefcase, Check, ClipboardCheck, Gauge, LayoutDashboard, Lock, Search, TrendingDown } from 'lucide-react';
import { errorMessage } from '../../../lib/api';
import { cx } from '../../../lib/utils';
import { useWorkspace } from '../../../lib/workspace';
import { KPIScorecards, type KPISubject } from '../../../components/hr/KPIScorecards';
import { Modal, Spinner, useToast } from '../../../components/ui';
import { hrApi, hrMutate, useHRQuery } from '../api';
import { currentPeriod, currentQuarter, dateTime, monthLabel, normaliseSearch, num, pct, quarterLabel, shiftPeriod, shiftQuarter, useHRText } from '../format';
import { useHR } from '../shell/HRContext';
import type { PeopleData, PerformanceData, PerformanceRow, QuarterlyReviewData } from '../types';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge, Metric, PageHeader } from '../ui/primitives';
import { PillTabs } from '../ui/PillTabs';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../ui/states';
import { Stepper } from '../ui/Stepper';
import type { Tone } from '../ui/tones';

const LOW = 70;

function scoreTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined) return 'neutral';
  if (value < 50) return 'critical';
  if (value < LOW) return 'warning';
  if (value >= 90) return 'success';
  return 'info';
}

function Score({ value, hint }: { value: number | null | undefined; hint?: string }) {
  const { lang } = useHRText();
  if (value === null || value === undefined) return <span className="text-ink-faint">—</span>;
  const tone = scoreTone(value);
  return (
    <span className="inline-flex flex-col">
      <span className={cx('font-bold tabular-nums', tone === 'critical' ? 'text-red-700' : tone === 'warning' ? 'text-amber-700' : tone === 'success' ? 'text-emerald-700' : 'text-navy')}>{pct(value, lang)}</span>
      {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
    </span>
  );
}

function ReviewDialog({ code, quarter, onClose }: { code: string; quarter: string; onClose: () => void }) {
  const { t, lang, pick } = useHRText();
  const { push } = useToast();
  const { data, error, loading } = useHRQuery<QuarterlyReviewData>(hrApi.review(code, quarter));
  const [scores, setScores] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState<'draft' | 'final' | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  useEffect(() => {
    if (!data || loadedId === `${data.review.id}:${data.review.updatedAt ?? ''}`) return;
    setLoadedId(`${data.review.id}:${data.review.updatedAt ?? ''}`);
    setScores(Object.fromEntries(Object.entries(data.review.scores ?? {}).map(([key, value]) => [key, String(value)])));
    setComments({ ...(data.review.comments ?? {}) });
    setSummary(data.review.summary ?? '');
  }, [data, loadedId]);

  const criteria = data?.review.criteria ?? [];
  const total = criteria.reduce((sum, criterion) => sum + criterion.max, 0);
  const got = criteria.reduce((sum, criterion) => sum + Math.min(criterion.max, Math.max(0, Number(scores[criterion.id] || 0))), 0);
  const answered = criteria.filter((criterion) => scores[criterion.id] !== undefined && scores[criterion.id] !== '').length;
  const editable = Boolean(data?.canEdit);

  const save = async (finalize: boolean) => {
    setSaving(finalize ? 'final' : 'draft');
    try {
      await hrMutate('put', hrApi.review(code, quarter), {
        scores: Object.fromEntries(Object.entries(scores).filter(([, value]) => value !== '').map(([key, value]) => [key, Number(value)])),
        comments,
        summary,
        finalize,
      });
      push(finalize ? t('اعتُمد التقييم.', 'Review finalised.') : t('حُفظت المسودة.', 'Draft saved.'));
      if (finalize) onClose();
    } catch (failure) {
      push(errorMessage(failure, lang), 'bad');
    } finally {
      setSaving(null);
    }
  };

  const name = data ? pick(data.employee.name) : `#${code}`;
  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={t(`تقييم ${quarterLabel(quarter, 'ar')} — ${name}`, `${quarterLabel(quarter, 'en')} review — ${name}`)}
      footer={editable ? (
        <>
          <span className="me-auto text-[12.5px] font-semibold text-[#5A6C82]">{t(`${answered}/${criteria.length} معايير · ${num(got, lang)} من ${num(total, lang)}`, `${answered}/${criteria.length} criteria · ${num(got, lang)} of ${num(total, lang)}`)}</span>
          <button type="button" className="btn-ghost" disabled={Boolean(saving)} onClick={() => void save(false)}>{saving === 'draft' ? <Spinner size={16} /> : null}{t('حفظ مسودة', 'Save draft')}</button>
          <button type="button" className="btn-primary" disabled={Boolean(saving) || answered !== criteria.length} onClick={() => void save(true)}>{saving === 'final' ? <Spinner size={16} /> : <Check size={16} />}{t('اعتماد نهائي', 'Finalise')}</button>
        </>
      ) : <button type="button" className="btn-ghost" onClick={onClose}>{t('إغلاق', 'Close')}</button>}
    >
      {error && !data ? <ErrorBlock error={error} /> : loading && !data ? <div className="grid place-items-center py-10"><Spinner /></div> : data ? (
        <div className="space-y-4">
          {!editable && (
            <p className="flex items-center gap-2 rounded-xl bg-[#F6F8FB] px-3 py-2.5 text-[12.5px] text-[#5A6C82]">
              <Lock size={14} aria-hidden="true" />
              {data.review.status === 'final' ? t(`معتمد ${data.review.finalizedAt ? dateTime(data.review.finalizedAt, lang) : ''} — لا يُعدَّل.`, `Final ${data.review.finalizedAt ? dateTime(data.review.finalizedAt, lang) : ''} — it cannot change.`) : t('للعرض فقط.', 'Read only.')}
            </p>
          )}
          <p className="text-[12.5px] leading-6 text-[#5A6C82]">{t('المعايير محفوظة مع التقييم نفسه، فتغيير المعايير في الإعدادات لا يعيد حساب ربع سابق.', 'The criteria are stored with the review itself, so changing them in settings never rescores a past quarter.')}</p>
          <ul className="space-y-3">
            {criteria.map((criterion) => (
              <li key={criterion.id} className="rounded-xl border border-[#EEF2F7] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`score-${criterion.id}`} className="text-[13px] font-bold text-navy">{pick(criterion)}</label>
                  <span className="flex items-center gap-1.5 text-[12px] text-[#5A6C82]">
                    <input id={`score-${criterion.id}`} className="field !w-20 !py-1.5 text-center" type="number" min={0} max={criterion.max} step="any" inputMode="decimal" disabled={!editable} value={scores[criterion.id] ?? ''} onChange={(event) => setScores((current) => ({ ...current, [criterion.id]: event.target.value }))} />
                    / {num(criterion.max, lang)}
                  </span>
                </div>
                <input className="field mt-2 !py-2 !text-[12.5px]" disabled={!editable} value={comments[criterion.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [criterion.id]: event.target.value }))} placeholder={t('ملاحظة (اختياري)', 'Comment (optional)')} aria-label={t(`ملاحظة على ${criterion.ar}`, `Comment on ${criterion.en}`)} maxLength={1000} />
              </li>
            ))}
          </ul>
          <label className="block">
            <span className="label">{t('الملخص', 'Summary')}</span>
            <textarea className="field min-h-[84px]" disabled={!editable} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={2000} />
          </label>
        </div>
      ) : null}
    </Modal>
  );
}

function Overview({ data, onReview }: { data: PerformanceData; onReview: (code: string) => void }) {
  const { t, lang, pick } = useHRText();
  const [params, setParams] = useSearchParams();
  const lowOnly = params.get('filter') === 'low';
  const department = params.get('department') ?? '';
  const [q, setQ] = useState('');
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const departments = useMemo(() => [...new Set(data.rows.map((row) => row.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')), [data]);
  const rows = useMemo(() => {
    const needle = normaliseSearch(q);
    return data.rows
      .filter((row) => !department || row.department === department)
      .filter((row) => !lowOnly || (row.general?.percent ?? 100) < LOW || (row.recruitment?.percent ?? 100) < LOW)
      .filter((row) => !needle || normaliseSearch(`${row.employeeCode} ${row.name.ar} ${row.name.en} ${row.title}`).includes(needle))
      .map((row) => ({ ...row, id: row.employeeCode }));
  }, [data, department, lowOnly, q]);
  const generals = data.rows.map((row) => row.general?.percent).filter((value): value is number => typeof value === 'number');
  const average = generals.length ? generals.reduce((sum, value) => sum + value, 0) / generals.length : null;

  const columns: Array<Column<PerformanceRow & { id: string }>> = [
    { key: 'name', header: t('الموظف', 'Employee'), sort: (row) => pick(row.name), cell: (row) => <Link to={`/hr/people/${encodeURIComponent(row.employeeCode)}`} onClick={(event) => event.stopPropagation()} className="min-w-0"><span className="block truncate font-semibold text-navy hover:text-brand-700">{pick(row.name)}</span><span className="block truncate text-[11.5px] text-[#5A6C82]">{[row.title, row.department].filter(Boolean).join(' · ') || `#${row.employeeCode}`}</span></Link> },
    { key: 'general', header: t('KPI العام', 'General KPI'), sort: (row) => row.general?.percent ?? null, cell: (row) => <Score value={row.general?.percent} hint={row.general ? monthLabel(row.general.period, lang) : undefined} /> },
    { key: 'recruitment', header: t('KPI التوظيف', 'Recruitment KPI'), sort: (row) => row.recruitment?.percent ?? null, cell: (row) => (row.recruitment ? <Link to={`/hr/recruitment/kpi?recruiter=${encodeURIComponent(row.employeeCode)}&period=${data.period}`} onClick={(event) => event.stopPropagation()} className="hover:underline"><Score value={row.recruitment.percent} /></Link> : <span className="text-ink-faint">—</span>) },
    { key: 'tasks', header: t('تقييم المهام', 'Task scores'), sort: (row) => row.tasks.average, cell: (row) => <Score value={row.tasks.average} hint={row.tasks.count ? t(`${row.tasks.count} مهمة`, `${row.tasks.count} tasks`) : undefined} /> },
    {
      key: 'review',
      header: quarterLabel(data.quarter, lang),
      sort: (row) => row.review?.percent ?? null,
      cell: (row) => (row.review ? (
        <span className="flex items-center gap-2"><Score value={row.review.percent} /><Badge tone={row.review.status === 'final' ? 'success' : 'warning'}>{row.review.status === 'final' ? t('معتمد', 'Final') : t(`مسودة ${row.review.answered}/${row.review.total}`, `Draft ${row.review.answered}/${row.review.total}`)}</Badge></span>
      ) : <span className="text-[12px] text-ink-faint">{t('لم يُقيَّم', 'Not reviewed')}</span>),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric icon={Gauge} label={t('متوسط KPI العام', 'Average general KPI')} value={pct(average, lang)} hint={t(`${generals.length} بطاقة`, `${generals.length} scorecards`)} tone={scoreTone(average)} />
        <Metric icon={TrendingDown} label={t(`KPI عام أقل من ${LOW}%`, `General KPI below ${LOW}%`)} value={num(data.attention.lowGeneral, lang)} tone={data.attention.lowGeneral ? 'warning' : 'neutral'} onClick={() => set('filter', lowOnly ? '' : 'low')} hint={lowOnly ? t('معروضة الآن', 'Showing') : undefined} />
        <Metric icon={Briefcase} label={t(`KPI توظيف أقل من ${LOW}%`, `Recruitment KPI below ${LOW}%`)} value={num(data.attention.lowRecruitment, lang)} tone={data.attention.lowRecruitment ? 'warning' : 'neutral'} to={`/hr/recruitment/kpi?period=${data.period}`} />
        <Metric icon={ClipboardCheck} label={t('تقييمات ربع سنوية لم تُعتمد', 'Quarterly reviews not final')} value={num(data.attention.reviewsPending, lang)} tone={data.attention.reviewsPending ? 'info' : 'neutral'} onClick={() => set('tab', 'reviews')} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input className="field !py-2 ps-9" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('الاسم أو الكود…', 'Name or code…')} aria-label={t('بحث', 'Search')} />
        </div>
        <select className="field !py-2 sm:w-56" value={department} onChange={(event) => set('department', event.target.value)} aria-label={t('القسم', 'Department')}>
          <option value="">{t('كل الأقسام', 'All departments')}</option>
          {departments.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
        {lowOnly && <button type="button" className="chip self-start bg-amber-50 text-amber-800 sm:self-auto" onClick={() => set('filter', '')}>{t(`أقل من ${LOW}% ✕`, `Below ${LOW}% ✕`)}</button>}
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        onRowClick={data.canReview ? (row) => onReview(row.employeeCode) : undefined}
        rowHref={data.canReview ? undefined : (row) => `/hr/people/${encodeURIComponent(row.employeeCode)}`}
        initialSort={lowOnly ? { key: 'general', direction: 'asc' } : null}
        caption={t('الأداء', 'Performance')}
        empty={<EmptyBlock title={t('لا يوجد موظفون مطابقون', 'No matching employees')} />}
      />
      {data.canReview && <p className="text-[11.5px] text-ink-faint">{t('اضغط صف موظف لفتح تقييمه الربع سنوي.', 'Click an employee to open their quarterly review.')}</p>}
    </div>
  );
}

function Reviews({ data, onReview }: { data: PerformanceData; onReview: (code: string) => void }) {
  const { t, lang, pick } = useHRText();
  const [show, setShow] = useState<'pending' | 'final' | 'all'>('pending');
  const rows = data.rows
    .filter((row) => (show === 'all' ? true : show === 'final' ? row.review?.status === 'final' : row.review?.status !== 'final'))
    .map((row) => ({ ...row, id: row.employeeCode }));
  const final = data.rows.filter((row) => row.review?.status === 'final').length;
  const columns: Array<Column<PerformanceRow & { id: string }>> = [
    { key: 'name', header: t('الموظف', 'Employee'), sort: (row) => pick(row.name), cell: (row) => <span className="min-w-0"><span className="block truncate font-semibold text-navy">{pick(row.name)}</span><span className="block truncate text-[11.5px] text-[#5A6C82]">{[row.title, row.department].filter(Boolean).join(' · ')}</span></span> },
    { key: 'status', header: t('الحالة', 'Status'), sort: (row) => row.review?.status ?? '', cell: (row) => (row.review ? <Badge tone={row.review.status === 'final' ? 'success' : 'warning'}>{row.review.status === 'final' ? t('معتمد', 'Final') : t(`مسودة ${row.review.answered}/${row.review.total}`, `Draft ${row.review.answered}/${row.review.total}`)}</Badge> : <Badge tone="neutral">{t('لم يبدأ', 'Not started')}</Badge>) },
    { key: 'score', header: t('النتيجة', 'Score'), sort: (row) => row.review?.percent ?? null, cell: (row) => <Score value={row.review?.percent} /> },
    { key: 'action', header: '', align: 'end', cell: (row) => <span className="text-[12.5px] font-semibold text-brand-700">{row.review?.status === 'final' ? t('عرض', 'View') : data.canReview ? t('تقييم', 'Review') : t('عرض', 'View')}</span> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[#5A6C82]">{t(`${num(final, lang)} من ${num(data.rows.length, lang)} تقييماً معتمداً في ${quarterLabel(data.quarter, 'ar')}.`, `${num(final, lang)} of ${num(data.rows.length, lang)} reviews final for ${quarterLabel(data.quarter, 'en')}.`)}</p>
        <div className="flex gap-1 rounded-xl border border-[#E6ECF3] bg-white p-1" role="group" aria-label={t('عرض', 'Show')}>
          {([['pending', t('لم تُعتمد', 'Not final')], ['final', t('معتمدة', 'Final')], ['all', t('الكل', 'All')]] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={show === id} onClick={() => setShow(id)} className={cx('rounded-lg px-3 py-1.5 text-[12.5px] font-semibold', show === id ? 'bg-navy text-white' : 'text-[#5A6C82] hover:bg-[#F6F8FB]')}>{label}</button>
          ))}
        </div>
      </div>
      <DataTable rows={rows} columns={columns} onRowClick={(row) => onReview(row.employeeCode)} caption={t('التقييمات الربع سنوية', 'Quarterly reviews')} empty={<EmptyBlock icon={<ClipboardCheck size={24} />} title={show === 'pending' ? t('كل التقييمات معتمدة', 'Every review is final') : t('لا توجد تقييمات', 'No reviews')} />} />
    </div>
  );
}

function Scorecards() {
  const { lang } = useHRText();
  const { access } = useHR();
  const { directory } = useWorkspace();
  const people = useHRQuery<PeopleData>(access?.people ? hrApi.people : null);
  const subjects: KPISubject[] = useMemo(() => [
    ...(people.data?.employees ?? []).map((employee) => ({ id: employee.employeeCode, name: employee.nameArabic || employee.nameEnglish || `#${employee.employeeCode}`, type: 'employee' as const })),
    ...directory.map((user) => ({ id: user.id, name: user.name, type: 'user' as const })),
  ], [people.data, directory]);
  return <KPIScorecards lang={lang} canManage={Boolean(access?.manage)} subjects={subjects} />;
}

export function PerformancePage() {
  const { t, lang } = useHRText();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'scorecards' ? 'scorecards' : params.get('tab') === 'reviews' ? 'reviews' : 'overview';
  const period = /^\d{4}-\d{2}$/.test(params.get('period') ?? '') ? params.get('period')! : currentPeriod();
  const quarter = /^\d{4}-Q[1-4]$/.test(params.get('quarter') ?? '') ? params.get('quarter')! : currentQuarter();
  const reviewing = params.get('review');
  const { data, error, loading, reload } = useHRQuery<PerformanceData>(tab === 'scorecards' ? null : hrApi.performance(period, quarter));
  const set = (key: string, value: string | null, replace = true) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace });
  };

  const tabs = [
    { id: 'overview', label: t('نظرة موحدة', 'Overview'), icon: <LayoutDashboard size={14} aria-hidden="true" /> },
    { id: 'reviews', label: t('التقييم الربع سنوي', 'Quarterly reviews'), icon: <ClipboardCheck size={14} aria-hidden="true" /> },
    { id: 'scorecards', label: t('بطاقات KPI', 'KPI scorecards'), icon: <Gauge size={14} aria-hidden="true" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('الأداء', 'Performance')}
        title={t('أداء الموظفين', 'Employee performance')}
        description={t('KPI العام من البطاقات المعتمدة، وKPI التوظيف، وتقييم المهام، والتقييم الربع سنوي — في مكان واحد وبنفس الكود.', 'The general KPI from approved scorecards, the recruitment KPI, task scores and the quarterly review — in one place, joined on the employee code.')}
        actions={tab === 'overview' ? (
          <Stepper label={monthLabel(period, lang)} onPrev={() => set('period', shiftPeriod(period, -1))} onNext={() => set('period', shiftPeriod(period, 1))} nextDisabled={period >= currentPeriod()} prevLabel={t('الشهر السابق', 'Previous month')} nextLabel={t('الشهر التالي', 'Next month')} />
        ) : tab === 'reviews' ? (
          <Stepper label={quarterLabel(quarter, lang)} onPrev={() => set('quarter', shiftQuarter(quarter, -1))} onNext={() => set('quarter', shiftQuarter(quarter, 1))} nextDisabled={quarter >= currentQuarter()} prevLabel={t('الربع السابق', 'Previous quarter')} nextLabel={t('الربع التالي', 'Next quarter')} />
        ) : null}
      />
      <PillTabs value={tab} onChange={(next) => set('tab', next === 'overview' ? null : next, false)} options={tabs} label={t('أقسام الأداء', 'Performance sections')} layoutId="performance-tab" />
      {tab === 'scorecards' ? <Scorecards /> : error && !data ? <ErrorBlock error={error} onRetry={reload} /> : loading && !data ? <PageSkeleton rows={1} /> : data ? (
        tab === 'reviews' ? <Reviews data={data} onReview={(code) => set('review', code, false)} /> : <Overview data={data} onReview={(code) => set('review', code, false)} />
      ) : null}
      {reviewing && <ReviewDialog code={reviewing} quarter={quarter} onClose={() => set('review', null)} />}
    </div>
  );
}

export default PerformancePage;
