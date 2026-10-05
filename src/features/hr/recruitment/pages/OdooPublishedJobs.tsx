/**
 * /hr/recruitment/odoo-jobs — what Odoo publishes for Egypt today.
 *
 * Read-only and live: every active, published `hr.job` of Egypt - Engoaad,
 * who owns it in Odoo, how many applied, and the Qodo request confirmed
 * against it. The request is where the deadline, the priority and every edit
 * live; a job with none is one Qodo is not timing yet. The team's own page is
 * the Overview — this is the board behind the violet line on each card.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, FilePlus2, Globe2, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { api, errorMessage } from '../../../../lib/api';
import { cx } from '../../../../lib/utils';
import { hrApi, useHRQuery } from '../../api';
import { date, num, useHRText } from '../../format';
import type { OdooJob, OdooJobsData } from '../../types';
import { Card, HeroStat, PageHeader, PersonAvatar, PriorityBadge, StatusBadge } from '../../ui/primitives';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../../ui/states';

export function OdooPublishedJobs() {
  const { t, lang } = useHRText();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload, setData } = useHRQuery<OdooJobsData>(hrApi.recruitment.odooJobs(), { refreshMs: 120_000 });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const owner = params.get('owner') ?? '';
  const onlyNew = params.get('new') === '1';
  const link = params.get('link') ?? '';
  const q = params.get('q') ?? '';
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const owners = useMemo(() => (data?.team ?? [])
    .map((person) => ({ ...person, count: data?.jobs.filter((job) => job.recruiter?.id === person.id).length ?? 0 }))
    .filter((person) => person.count > 0)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)), [data]);
  const personOf = (job: OdooJob) => data?.team.find((person) => person.id === job.recruiter?.id) ?? null;

  const jobs = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase();
    return (data?.jobs ?? [])
      .filter((job) => !owner || (owner === 'none' ? !job.ownerCode : String(job.recruiter?.id ?? '') === owner))
      .filter((job) => !onlyNew || job.newApplications > 0)
      .filter((job) => !link || (link === 'linked' ? Boolean(job.request) : !job.request))
      .filter((job) => !needle || `${job.name} ${job.department} ${job.recruiter?.name ?? ''} ${job.request?.reference ?? ''}`.toLocaleLowerCase().includes(needle))
      .sort((left, right) => right.newApplications - left.newApplications || left.name.localeCompare(right.name));
  }, [data, owner, onlyNew, link, q]);

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      setData(await api.get<OdooJobsData>(hrApi.recruitment.odooJobs(true)));
    } catch (failure) {
      setRefreshError(failure);
    } finally {
      setRefreshing(false);
    }
  }

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={2} />;
  if (!data) return null;

  const connected = data.configured && data.connected;
  const totalSeats = data.jobs.reduce((sum, job) => sum + job.toRecruit, 0);
  const totalNew = data.jobs.reduce((sum, job) => sum + job.newApplications, 0);
  const unlinked = data.jobs.filter((job) => !job.request).length;
  const chip = (pressed: boolean) => cx('inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors', pressed ? 'bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] text-white shadow-[0_8px_16px_-10px_rgb(var(--hr-a1)/0.9)]' : 'bg-white/80 text-slate-700 ring-1 ring-slate-200 hover:text-navy');
  const filtered = Boolean(owner || onlyNew || link || q);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('التوظيف · Odoo', 'Recruitment · Odoo')}
        title={t('وظائف Odoo المنشورة', 'Published Odoo jobs')}
        description={t('مباشرة من Odoo: وظائف Egypt - Engoaad النشطة والمنشورة فقط، ومع كل وظيفة الطلب المرتبط بها في Qodo حيث المهلة والتعديل.', 'Live from Odoo: active, published Egypt - Engoaad jobs only, each with the Qodo request that carries its deadline and edits.')}
        stats={connected ? (
          <>
            <HeroStat value={num(data.jobs.length, lang)} label={t('وظيفة منشورة', 'published jobs')} />
            <HeroStat value={num(totalSeats, lang)} label={t('مقعد مطلوب', 'seats to recruit')} />
            <HeroStat value={num(totalNew, lang)} label={t('طلب تقديم جديد', 'new applications')} to="/hr/recruitment/odoo-jobs?new=1" />
            {unlinked > 0 && <HeroStat value={num(unlinked, lang)} label={t('بلا طلب في Qodo', 'with no Qodo request')} to="/hr/recruitment/odoo-jobs?link=unlinked" />}
          </>
        ) : undefined}
        actions={<button type="button" className="btn-ghost btn-sm" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />{t('تحديث من Odoo', 'Refresh from Odoo')}</button>}
      />
      {refreshError !== null && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] font-semibold text-rose-700">{t('تعذّر تحديث وظائف Odoo: ', 'Could not refresh Odoo jobs: ')}{errorMessage(refreshError, lang)}</p>}

      {!connected ? (
        <EmptyBlock title={t('تعذّر الاتصال بوظائف Odoo', 'Odoo jobs are unavailable')} body={t('تحقق من إعدادات الربط ثم أعد المحاولة.', 'Check the connection and try again.')} action={<button type="button" className="btn-secondary btn-sm" onClick={() => void refresh()}>{t('إعادة المحاولة', 'Try again')}</button>} />
      ) : (
        <>
          <Card padded={false} className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-pressed={!owner} onClick={() => set('owner', '')} className={chip(!owner)}>{t('الكل', 'All')} · {num(data.jobs.length, lang)}</button>
              {owners.map((person) => (
                <button key={person.id} type="button" aria-pressed={owner === String(person.id)} onClick={() => set('owner', owner === String(person.id) ? '' : String(person.id))} className={chip(owner === String(person.id))}>
                  <span className="hr-bidi">{lang === 'ar' ? person.nameArabic.split(/\s+/).slice(0, 2).join(' ') || person.name : person.name}</span> · {num(person.count, lang)}
                </button>
              ))}
              <label className="relative ms-auto w-full sm:w-64">
                <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
                <input className="field !py-2 ps-9" value={q} onChange={(event) => set('q', event.target.value)} placeholder={t('ابحث عن وظيفة أو رقم طلب…', 'Search a job or request number…')} aria-label={t('بحث', 'Search')} />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" aria-pressed={onlyNew} onClick={() => set('new', onlyNew ? '' : '1')} className={chip(onlyNew)}>{t('بها طلبات جديدة', 'With new applications')}</button>
              <button type="button" aria-pressed={link === 'unlinked'} onClick={() => set('link', link === 'unlinked' ? '' : 'unlinked')} className={chip(link === 'unlinked')}>{t('بلا طلب في Qodo', 'No Qodo request')}</button>
              <button type="button" aria-pressed={owner === 'none'} onClick={() => set('owner', owner === 'none' ? '' : 'none')} className={chip(owner === 'none')}>{t('بلا مسؤول من الفريق', 'No team owner')}</button>
              {filtered && <button type="button" onClick={() => setParams(new URLSearchParams(), { replace: true })} className="inline-flex min-h-8 items-center gap-1 px-1 text-[12px] font-semibold text-[rgb(var(--hr-a1))] hover:underline"><X size={13} aria-hidden="true" />{t('مسح الفلاتر', 'Clear filters')}</button>}
              <span className="ms-auto text-[11.5px] text-ink-faint">{t(`${num(jobs.length, lang)} وظيفة`, `${num(jobs.length, lang)} jobs`)}{data.fetchedAt ? ` · ${t('آخر قراءة', 'Last read')} ${date(data.fetchedAt, lang)}` : ''}</span>
            </div>
          </Card>

          {jobs.length ? (
            <div className="hr-stagger grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {jobs.map((job) => {
                const person = personOf(job);
                const ownerName = person ? (lang === 'ar' ? person.nameArabic || person.fullName : person.fullName) : job.recruiter?.name ?? '';
                return (
                  <Card key={job.id} as="article" padded={false} className="flex flex-col overflow-hidden">
                    <div className="flex-1 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="hr-bidi text-[15.5px] font-extrabold leading-6 text-navy">{job.name}</h2>
                          <p className="mt-0.5 truncate text-[12px] text-slate-500">{job.department || job.company}</p>
                        </div>
                        {job.newApplications > 0 && <span className="shrink-0 rounded-full bg-violet-600 px-2.5 py-1 text-[11.5px] font-bold text-white">{t(`${num(job.newApplications, lang)} جديد`, `${num(job.newApplications, lang)} new`)}</span>}
                      </div>

                      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-2xl bg-white/70 py-2 ring-1 ring-slate-100"><dt className="text-[10.5px] font-semibold text-slate-500">{t('مطلوب', 'To recruit')}</dt><dd className="text-[17px] font-extrabold tabular-nums text-navy">{num(job.toRecruit, lang)}</dd></div>
                        <div className="rounded-2xl bg-white/70 py-2 ring-1 ring-slate-100"><dt className="text-[10.5px] font-semibold text-slate-500">{t('متقدمون', 'Applications')}</dt><dd className="text-[17px] font-extrabold tabular-nums text-navy">{num(job.applications, lang)}</dd></div>
                        <div className="rounded-2xl bg-white/70 py-2 ring-1 ring-slate-100"><dt className="text-[10.5px] font-semibold text-slate-500">{t('تم تعيينهم', 'Hired')}</dt><dd className="text-[17px] font-extrabold tabular-nums text-navy">{num(job.hired, lang)}</dd></div>
                      </dl>

                      <div className="mt-4 flex items-center gap-2.5">
                        {job.recruiter ? (
                          <>
                            <PersonAvatar name={ownerName} photoUrl={person?.photoUrl ?? null} size={30} />
                            <div className="min-w-0">
                              <p className="hr-bidi truncate text-[12.5px] font-bold text-navy">{ownerName}</p>
                              <p className="text-[11px] text-slate-500">{job.ownerCode ? t('مسؤول الوظيفة في Odoo', 'Job owner in Odoo') : t('مسؤول في Odoo — ليس ضمن فريق التوظيف هنا', 'Owner in Odoo — not on the recruitment team here')}</p>
                            </div>
                          </>
                        ) : <p className="text-[12.5px] font-bold text-amber-700">{t('بلا مسؤول في Odoo', 'No owner in Odoo')}</p>}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/80 bg-white/50 px-5 py-3 text-[12px] font-semibold">
                      {job.request ? (
                        <Link to={`/hr/recruitment/requests/${encodeURIComponent(job.request.id)}`} className="inline-flex items-center gap-1.5 text-[rgb(var(--hr-a1))] hover:underline">
                          <Pencil size={13} aria-hidden="true" />
                          {t(`طلب ${job.request.reference}`, `Request ${job.request.reference}`)}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-slate-500"><FilePlus2 size={13} aria-hidden="true" />{t('غير مرتبطة بطلب في Qodo', 'No Qodo request linked')}</span>
                      )}
                      {job.request && <span className="flex gap-1.5">{job.request.priority && <PriorityBadge priority={job.request.priority} />}{job.request.status !== 'hiring' && <StatusBadge status={job.request.status} />}</span>}
                      <a href={job.odooUrl} target="_blank" rel="noreferrer" className="ms-auto inline-flex items-center gap-1 text-violet-700 hover:underline"><Globe2 size={13} aria-hidden="true" />{t('فتح في Odoo', 'Open in Odoo')}<ExternalLink size={12} aria-hidden="true" /></a>
                      {job.jobUrl && <a href={job.jobUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-700 hover:underline">{t('صفحة الوظيفة', 'Job page')}<ExternalLink size={12} aria-hidden="true" /></a>}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : <EmptyBlock title={t('لا توجد وظائف تطابق الفلاتر', 'No jobs match these filters')} />}
        </>
      )}
    </div>
  );
}

export default OdooPublishedJobs;
