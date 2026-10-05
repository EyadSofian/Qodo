/**
 * /hr/recruitment/requests — every request this person may see, by where it
 * is in its life. A department manager sees their own; the desk sees all.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, Plus, RotateCcw, Search } from 'lucide-react';
import { errorMessage } from '../../../../lib/api';
import { useToast } from '../../../../components/ui';
import { hrApi, hrMutate, useHRQuery } from '../../api';
import { date, num, shortName, useHRText } from '../../format';
import { STATUS_LABEL } from '../../labels';
import type { JobRequest, RecruitmentContext, RequestStatus } from '../../types';
import { DataTable, type Column } from '../../ui/DataTable';
import { PageHeader, PersonAvatar, PriorityBadge, SlaMeter, StatusBadge } from '../../ui/primitives';
import { PillTabs } from '../../ui/PillTabs';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../../ui/states';

const TABS: Array<{ id: string; statuses: RequestStatus[] | null; label: { ar: string; en: string } }> = [
  { id: 'all', statuses: null, label: { ar: 'الكل', en: 'All' } },
  { id: 'draft', statuses: ['draft'], label: STATUS_LABEL.draft },
  { id: 'pending_review', statuses: ['pending_review'], label: STATUS_LABEL.pending_review },
  { id: 'pending_approval', statuses: ['pending_approval'], label: STATUS_LABEL.pending_approval },
  { id: 'hiring', statuses: ['hiring', 'on_hold'], label: STATUS_LABEL.hiring },
  { id: 'completed', statuses: ['completed'], label: STATUS_LABEL.completed },
  { id: 'closed', statuses: ['cancelled', 'rejected'], label: { ar: 'مغلقة', en: 'Closed' } },
];

export function JobRequests() {
  const { t, lang, pick } = useHRText();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((item) => item.id === params.get('status')) ?? TABS[0];
  const archived = params.get('scope') === 'archived';
  const mine = !archived && params.get('scope') === 'mine';
  const query = params.get('q') ?? '';
  const { data, error, loading, reload } = useHRQuery<{ requests: JobRequest[]; context: RecruitmentContext }>(hrApi.recruitment.requests(undefined, archived ? 'archived' : mine ? 'mine' : undefined));
  const [restoring, setRestoring] = useState<string | null>(null);
  const { push } = useToast();

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.requests ?? [])
      .filter((request) => archived || !tab.statuses || tab.statuses.includes(request.status))
      .filter((request) => !needle || `${request.title} ${request.reference} ${request.department} ${request.requestedByName}`.toLowerCase().includes(needle))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }, [data, tab, query, archived]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((item) => [item.id, (data?.requests ?? []).filter((request) => !item.statuses || item.statuses.includes(request.status)).length])), [data]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={1} />;
  const fromOdoo = data?.context.jobSource === 'odoo';
  const canCreate = !fromOdoo && Boolean(data?.context.perms.request || data?.context.perms.assign);
  const canManageArchive = Boolean(data?.context.perms.settings);
  const restore = async (id: string) => {
    setRestoring(id);
    try {
      await hrMutate('post', hrApi.recruitment.restoreRequest(id), {});
      push(t('تم استرجاع الطلب إلى قائمة التوظيف.', 'Request restored to recruitment.'));
      await reload();
    } catch (restoreError) {
      push(errorMessage(restoreError, lang), 'bad');
    } finally {
      setRestoring(null);
    }
  };

  const columns: Array<Column<JobRequest>> = [
    {
      key: 'title',
      header: t('الوظيفة', 'Job'),
      sort: (row) => row.title,
      cell: (row) => (
        <div className="min-w-0">
          <p className="hr-bidi truncate font-bold text-navy">{row.title || t('بدون عنوان', 'Untitled')}</p>
          <p className="truncate text-[11.5px] text-ink-faint">{row.reference} · {row.department || '—'}</p>
        </div>
      ),
    },
    { key: 'status', header: t('الحالة', 'Status'), sort: (row) => row.status, cell: (row) => <StatusBadge status={row.status} /> },
    { key: 'priority', header: t('الأولوية', 'Priority'), sort: (row) => row.priority ?? 'z', cell: (row) => <PriorityBadge priority={row.priority} /> },
    {
      key: 'recruiter',
      header: t('المسؤول', 'Recruiter'),
      cell: (row) => row.recruiter ? (
        <span className="flex items-center gap-2"><PersonAvatar name={shortName(row.recruiter.name, lang)} photoUrl={row.recruiter.photoUrl} size={26} /><span className="truncate">{shortName(row.recruiter.name, lang)}</span></span>
      ) : <span className="text-ink-faint">—</span>,
    },
    { key: 'sla', header: 'SLA', cell: (row) => <SlaMeter sla={row.slaSnapshot} source={row.source} compact /> },
    { key: 'requested', header: t('بواسطة', 'Requested by'), sort: (row) => row.requestedByName, cell: (row) => <span className="text-[12.5px] text-[#5A6C82]">{row.requestedByName || '—'}</span>, hideOnCard: true },
    { key: 'updated', header: t('آخر تحديث', 'Updated'), sort: (row) => row.updatedAt, cell: (row) => <span className="text-[12px] text-ink-faint">{date(row.updatedAt, lang)}</span>, hideOnCard: true },
    ...(archived && canManageArchive && !fromOdoo ? [{ key: 'restore', header: t('الإجراء', 'Action'), cell: (row: JobRequest) => <button type="button" className="btn-secondary btn-sm" disabled={Boolean(restoring)} onClick={() => void restore(row.id)}><RotateCcw size={14} />{restoring === row.id ? t('جارٍ الاسترجاع…', 'Restoring…') : t('استرجاع', 'Restore')}</button> }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('التوظيف', 'Recruitment')}
        title={archived ? t('أرشيف طلبات الوظائف', 'Archived job requests') : t('طلبات الوظائف', 'Job requests')}
        description={archived ? (fromOdoo ? t('كل ما ليس منشوراً في Odoo الآن محفوظ هنا للرجوع إليه. الوظيفة ترجع تلقائياً عند نشرها في Odoo.', 'Everything Odoo does not publish now is kept here for reference. A job returns by itself when it is published in Odoo.') : t('الطلبات المؤرشفة محفوظة ويمكن إرجاعها إلى قائمة التوظيف.', 'Archived requests are kept here and can be restored to recruitment.')) : fromOdoo ? t('وظيفة واحدة لكل وظيفة منشورة في Odoo لشركة Egypt - Engoaad. المهلة والأولوية من تاريخ التفعيل ومدة التوظيف في Odoo.', 'One job per position Odoo publishes for Egypt - Engoaad. Deadline and priority come from the Active Date and Hiring Period in Odoo.') : t('من الطلب إلى مراجعة القسم إلى الاعتماد النهائي — الـSLA لا يبدأ قبل الاعتماد.', 'From request to department review to final approval — the SLA never starts before approval.')}
        actions={archived
          ? <Link to="/hr/recruitment/requests" className="btn-secondary btn-sm">{t('العودة للطلبات', 'Back to requests')}</Link>
          : <span className="flex flex-wrap items-center gap-2">{canManageArchive && <Link to="/hr/recruitment/requests?scope=archived" className="btn-ghost btn-sm"><Archive size={15} />{t('الأرشيف', 'Archive')}</Link>}{canCreate && <Link to="/hr/recruitment/requests/new" className="btn-primary btn-sm"><Plus size={16} />{t('طلب وظيفة جديد', 'New job request')}</Link>}</span>}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {!archived && <PillTabs
          className="min-w-0"
          value={tab.id}
          onChange={(next) => set('status', next === 'all' ? null : next)}
          options={TABS.map((item) => ({ id: item.id, label: pick(item.label), count: num(counts[item.id], lang) }))}
          label={t('حالة الطلب', 'Request status')}
          layoutId="job-request-status"
        />}
        {!archived && <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[12.5px] font-semibold text-[#5A6C82]">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={mine} onChange={(event) => set('scope', event.target.checked ? 'mine' : null)} />
          {t('طلباتي فقط', 'Only my requests')}
        </label>}
        <div className="relative lg:ms-auto lg:w-72">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input className="field !py-2 ps-9" value={query} onChange={(event) => set('q', event.target.value || null)} placeholder={t('ابحث بالوظيفة أو المرجع…', 'Search job or reference…')} aria-label={t('بحث', 'Search')} />
        </div>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowHref={(row) => archived ? null : `/hr/recruitment/requests/${encodeURIComponent(row.id)}`}
        caption={archived ? t('أرشيف طلبات الوظائف', 'Archived job requests') : t('طلبات الوظائف', 'Job requests')}
        empty={<EmptyBlock title={t('لا توجد طلبات هنا', 'No requests here')} body={canCreate ? t('ابدأ طلباً جديداً من الزر بالأعلى.', 'Start a new request from the button above.') : undefined} />}
      />
    </div>
  );
}

export default JobRequests;
