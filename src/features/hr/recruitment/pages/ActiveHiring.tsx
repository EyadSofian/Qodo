/**
 * /hr/recruitment/hiring — the operational view of every live job.
 *
 * Sorted so the job needing attention first is on top: overdue, then
 * Critical, then due soon, then Required, then Planned. Filters live in the
 * URL, which is how every figure on the overview lands here pre-filtered. The
 * Odoo columns fill in after the table — Odoo is slow and the table is not.
 */

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LayoutGrid, Rows3, Search, X } from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { hrApi, useHRQuery } from '../../api';
import { date, num, shortName, useHRText } from '../../format';
import { PRIORITY_LABEL, PRIORITY_ORDER, SLA_LABEL } from '../../labels';
import type { JobRequest, RecruitmentContext } from '../../types';
import { DataTable, type Column } from '../../ui/DataTable';
import { Badge, Card, PageHeader, PersonAvatar, PriorityBadge, SlaMeter, StatusBadge } from '../../ui/primitives';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../../ui/states';
import { stageName } from '../components/OdooPipeline';

function urgency(request: JobRequest) {
  const state = request.slaSnapshot.state;
  if (state === 'overdue') return 0;
  if (request.priority === 'critical') return 1;
  if (state === 'due_soon' || state === 'due_today') return 2;
  if (request.priority === 'required') return 3;
  if (request.priority === 'planned') return 4;
  return 5;
}

export function ActiveHiring() {
  const { t, lang, pick } = useHRText();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useHRQuery<{ requests: JobRequest[]; context: RecruitmentContext }>(hrApi.recruitment.requests('hiring,on_hold'), { refreshMs: 120_000 });
  const pipelines = useHRQuery<{ summaries: Record<string, { total: number; furthestStage: string | null } | null> }>(data ? hrApi.recruitment.pipelines : null);
  const view = params.get('view') === 'cards' ? 'cards' : 'table';
  const filters = {
    priority: params.get('priority') ?? '',
    sla: params.get('sla') ?? '',
    status: params.get('status') ?? '',
    recruiter: params.get('recruiter') ?? '',
    classification: params.get('classification') ?? '',
    q: params.get('q') ?? '',
  };
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const needle = filters.q.trim().toLowerCase();
    return (data?.requests ?? [])
      .filter((request) => !filters.priority || request.priority === filters.priority)
      .filter((request) => !filters.sla || (filters.sla === 'due_soon' ? ['due_soon', 'due_today'].includes(request.slaSnapshot.state) : request.slaSnapshot.state === filters.sla))
      .filter((request) => !filters.status || request.status === filters.status)
      .filter((request) => !filters.recruiter || request.recruiterCode === filters.recruiter)
      .filter((request) => !filters.classification || request.classification === filters.classification)
      .filter((request) => !needle || `${request.title} ${request.reference} ${request.department}`.toLowerCase().includes(needle))
      .sort((left, right) => urgency(left) - urgency(right) || (left.slaSnapshot.remainingWorkingDays ?? 999) - (right.slaSnapshot.remainingWorkingDays ?? 999));
  }, [data, filters.priority, filters.sla, filters.status, filters.recruiter, filters.classification, filters.q]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={1} />;
  if (!data) return null;

  const context = data.context;
  const classificationOf = (id: string | null) => context.policy.classifications.find((item) => item.id === id);
  const odoo = pipelines.data?.summaries ?? {};
  const active = Object.entries(filters).filter(([key, value]) => value && key !== 'q');

  const columns: Array<Column<JobRequest>> = [
    {
      key: 'job',
      header: t('الوظيفة', 'Job'),
      sort: (row) => row.title,
      cell: (row) => (
        <div className="min-w-0 max-w-[16rem]">
          <p className="hr-bidi truncate font-bold text-navy">{row.title}</p>
          <p className="truncate text-[11.5px] text-ink-faint">{row.reference} · {row.department || '—'}</p>
        </div>
      ),
    },
    { key: 'classification', header: t('التصنيف', 'Classification'), sort: (row) => row.classification, cell: (row) => <span className="text-[12.5px]">{classificationOf(row.classification) ? pick(classificationOf(row.classification)!) : '—'}</span>, hideOnCard: true },
    { key: 'priority', header: t('الأولوية', 'Priority'), sort: (row) => PRIORITY_ORDER.indexOf(row.priority ?? 'planned'), cell: (row) => <PriorityBadge priority={row.priority} /> },
    {
      key: 'recruiter',
      header: t('المسؤول', 'Recruiter'),
      sort: (row) => row.recruiterCode,
      cell: (row) => row.recruiter ? <span className="flex items-center gap-2"><PersonAvatar name={shortName(row.recruiter.name, lang)} photoUrl={row.recruiter.photoUrl} size={26} /><span className="truncate text-[12.5px]">{shortName(row.recruiter.name, lang)}</span></span> : <span className={cx('text-[12px] font-semibold', row.priority === 'critical' ? 'text-red-700' : 'text-ink-faint')}>{t('غير مُسند', 'Unassigned')}</span>,
    },
    { key: 'headcount', header: t('المطلوب', 'Headcount'), align: 'center', sort: (row) => row.headcount, cell: (row) => <span className="tabular-nums">{num(row.headcount, lang)}</span>, hideOnCard: true },
    { key: 'hired', header: t('مقبول', 'Hired'), align: 'center', sort: (row) => row.accepted, cell: (row) => <span className="font-semibold tabular-nums">{num(row.accepted, lang)}</span> },
    { key: 'sla', header: 'SLA', sort: (row) => urgency(row) * 1000 + (row.slaSnapshot.remainingWorkingDays ?? 0), cell: (row) => <SlaMeter sla={row.slaSnapshot} compact /> },
    { key: 'stage', header: t('المرحلة الحالية', 'Current stage'), cell: (row) => <span className="text-[12px] text-[#3F5068]">{row.status === 'on_hold' ? pick(SLA_LABEL.paused) : odoo[row.id]?.furthestStage ? stageName(odoo[row.id]!.furthestStage!, lang) : row.odooLink ? '…' : '—'}</span>, hideOnCard: true },
    { key: 'odoo', header: t('مرشحو Odoo', 'Odoo candidates'), align: 'center', sort: (row) => odoo[row.id]?.total ?? -1, cell: (row) => <span className="tabular-nums">{odoo[row.id] ? num(odoo[row.id]!.total, lang) : row.odooLink ? '…' : '—'}</span>, hideOnCard: true },
    { key: 'due', header: t('الاستحقاق', 'Due'), sort: (row) => row.slaSnapshot.dueDate ?? '', cell: (row) => <span className="whitespace-nowrap text-[12px]">{date(row.slaSnapshot.dueDate, lang)}</span> },
    { key: 'status', header: t('الحالة', 'Status'), sort: (row) => row.status, cell: (row) => <StatusBadge status={row.status} />, hideOnCard: true },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('التوظيف', 'Recruitment')}
        title={t('التوظيف النشط', 'Active hiring')}
        description={t('الأكثر احتياجاً للتدخل أولاً: المتأخرة، ثم الحرجة، ثم القريبة الاستحقاق، ثم المطلوبة، ثم المخطط لها.', 'Most urgent first: overdue, then Critical, then due soon, then Required, then Planned.')}
        actions={
          <div className="flex rounded-2xl border border-white/70 bg-white/90 p-1 shadow-[0_12px_26px_-16px_rgb(15_23_42/0.55)] backdrop-blur" role="group" aria-label={t('طريقة العرض', 'View')}>
            {([['table', Rows3, t('جدول', 'Table')], ['cards', LayoutGrid, t('بطاقات', 'Cards')]] as const).map(([id, Icon, label]) => (
              <button key={id} type="button" aria-pressed={view === id} onClick={() => set('view', id === 'table' ? '' : id)} className={cx('flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-semibold transition-all duration-200', view === id ? 'bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] text-white shadow-[0_8px_16px_-8px_rgb(var(--hr-a1)/0.9)]' : 'text-slate-600 hover:text-navy')}><Icon size={14} aria-hidden="true" />{label}</button>
            ))}
          </div>
        }
      />

      <Card padded={false} className="p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
            <input className="field !py-2 ps-9" value={filters.q} onChange={(event) => set('q', event.target.value)} placeholder={t('ابحث…', 'Search…')} aria-label={t('بحث', 'Search')} />
          </div>
          <select className="field !py-2" value={filters.priority} onChange={(event) => set('priority', event.target.value)} aria-label={t('الأولوية', 'Priority')}>
            <option value="">{t('كل الأولويات', 'All priorities')}</option>
            {PRIORITY_ORDER.map((key) => <option key={key} value={key}>{pick(PRIORITY_LABEL[key])}</option>)}
          </select>
          <select className="field !py-2" value={filters.sla} onChange={(event) => set('sla', event.target.value)} aria-label="SLA">
            <option value="">{t('كل حالات الـSLA', 'Any SLA state')}</option>
            {(['overdue', 'due_soon', 'on_track', 'paused'] as const).map((key) => <option key={key} value={key}>{pick(SLA_LABEL[key])}</option>)}
          </select>
          <select className="field !py-2" value={filters.recruiter} onChange={(event) => set('recruiter', event.target.value)} aria-label={t('المسؤول', 'Recruiter')}>
            <option value="">{t('كل المسؤولين', 'All recruiters')}</option>
            {context.team.map((member) => <option key={member.employeeCode} value={member.employeeCode}>{shortName(member.shortName, lang)}</option>)}
          </select>
          <select className="field !py-2" value={filters.classification} onChange={(event) => set('classification', event.target.value)} aria-label={t('التصنيف', 'Classification')}>
            <option value="">{t('كل التصنيفات', 'All classifications')}</option>
            {context.policy.classifications.map((item) => <option key={item.id} value={item.id}>{pick(item)}</option>)}
          </select>
        </div>
        {active.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {active.map(([key]) => (
              <button key={key} type="button" onClick={() => set(key, '')} className="inline-flex items-center gap-1 rounded-full bg-[#EAF1F9] px-2.5 py-1 text-[11.5px] font-semibold text-brand-700 hover:bg-brand-100">
                {key === 'priority' ? pick(PRIORITY_LABEL[filters.priority as 'critical']) : key === 'sla' ? pick(SLA_LABEL[filters.sla as 'overdue']) : key === 'recruiter' ? shortName(context.team.find((member) => member.employeeCode === filters.recruiter)?.shortName, lang) || filters.recruiter : key === 'status' ? t('معلّقة', 'On hold') : pick(classificationOf(filters.classification) ?? { ar: filters.classification, en: filters.classification })}
                <X size={12} aria-hidden="true" />
              </button>
            ))}
            <span className="text-[12px] text-ink-faint">{t(`${rows.length} وظيفة`, `${rows.length} jobs`)}</span>
          </div>
        )}
      </Card>

      {view === 'table' ? (
        <DataTable
          rows={rows}
          columns={columns}
          rowHref={(row) => `/hr/recruitment/requests/${encodeURIComponent(row.id)}`}
          caption={t('التوظيف النشط', 'Active hiring')}
          rowClassName={(row) => (row.slaSnapshot.state === 'overdue' ? 'border-s-2 border-s-red-400' : undefined)}
          empty={<EmptyBlock title={t('لا توجد وظائف تطابق الفلاتر', 'No jobs match these filters')} />}
        />
      ) : rows.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <Link key={row.id} to={`/hr/recruitment/requests/${encodeURIComponent(row.id)}`} className={cx('block rounded-2xl border bg-white p-4 transition-shadow hover:shadow-[0_12px_28px_-20px_rgba(11,37,69,0.4)]', row.slaSnapshot.state === 'overdue' ? 'border-red-200' : 'border-[#E6ECF3]')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="hr-bidi truncate text-[14px] font-bold text-navy">{row.title}</p><p className="truncate text-[11.5px] text-ink-faint">{row.reference} · {row.department || '—'}</p></div>
                <PriorityBadge priority={row.priority} />
              </div>
              <div className="mt-3"><SlaMeter sla={row.slaSnapshot} /></div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#EEF2F7] pt-3 text-[12px]">
                {row.recruiter ? <span className="flex min-w-0 items-center gap-2"><PersonAvatar name={shortName(row.recruiter.name, lang)} photoUrl={row.recruiter.photoUrl} size={24} /><span className="truncate">{shortName(row.recruiter.name, lang)}</span></span> : <Badge tone={row.priority === 'critical' ? 'critical' : 'neutral'}>{t('غير مُسند', 'Unassigned')}</Badge>}
                <span className="shrink-0 font-semibold tabular-nums text-navy">{num(row.accepted, lang)} / {num(row.headcount, lang)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : <EmptyBlock title={t('لا توجد وظائف تطابق الفلاتر', 'No jobs match these filters')} />}
    </div>
  );
}

export default ActiveHiring;
