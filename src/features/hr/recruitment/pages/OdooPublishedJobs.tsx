import { useMemo, useState } from 'react';
import { ExternalLink, Globe2, RefreshCw, Search, UsersRound } from 'lucide-react';
import { api, errorMessage } from '../../../../lib/api';
import { hrApi, useHRQuery } from '../../api';
import { date, num, useHRText } from '../../format';
import { Card, PageHeader } from '../../ui/primitives';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../../ui/states';

interface OdooJob {
  id: number;
  name: string;
  company: string;
  department: string;
  recruiter: { id: number; name: string } | null;
  toRecruit: number;
  applications: number;
  newApplications: number;
  hired: number;
  published: boolean;
  odooUrl: string;
  jobUrl: string | null;
}

interface OdooJobsData {
  configured: boolean;
  connected: boolean;
  company: string;
  fetchedAt: string | null;
  jobs: OdooJob[];
}

export function OdooPublishedJobs() {
  const { t, lang } = useHRText();
  const { data, error, loading, reload, setData } = useHRQuery<OdooJobsData>(hrApi.recruitment.odooJobs(), { refreshMs: 120_000 });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [recruiter, setRecruiter] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const recruiters = useMemo(() => {
    const grouped = new Map<number, { id: number; name: string; count: number }>();
    for (const job of data?.jobs ?? []) {
      if (!job.recruiter) continue;
      const current = grouped.get(job.recruiter.id);
      grouped.set(job.recruiter.id, { ...job.recruiter, count: (current?.count ?? 0) + 1 });
    }
    return [...grouped.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  }, [data]);
  const jobs = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (data?.jobs ?? []).filter((job) =>
      (recruiter === null || job.recruiter?.id === recruiter) &&
      (!needle || `${job.name} ${job.department} ${job.recruiter?.name ?? ''}`.toLocaleLowerCase().includes(needle))
    );
  }, [data, recruiter, query]);

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

  const totalSeats = data.jobs.reduce((sum, job) => sum + job.toRecruit, 0);
  const totalNew = data.jobs.reduce((sum, job) => sum + job.newApplications, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('التوظيف · Odoo', 'Recruitment · Odoo')}
        title={t('الوظائف المنشورة في مصر', 'Published jobs in Egypt')}
        description={t('من وظائف Odoo مباشرة: شركة Egypt - Engoaad، الوظائف النشطة والمنشورة فقط.', 'Live from Odoo jobs: Egypt - Engoaad, active and published positions only.')}
        actions={<button type="button" className="btn-secondary btn-sm" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />{t('تحديث من Odoo', 'Refresh from Odoo')}</button>}
      />
      {refreshError !== null && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] font-semibold text-rose-700">{t('تعذّر تحديث وظائف Odoo: ', 'Could not refresh Odoo jobs: ')}{errorMessage(refreshError, lang)}</p>}

      {!data.configured || !data.connected ? (
        <EmptyBlock title={t('تعذّر الاتصال بوظائف Odoo', 'Odoo jobs are unavailable')} body={t('تحقق من إعدادات الربط ثم أعد المحاولة.', 'Check the connection and try again.')} action={<button type="button" className="btn-secondary btn-sm" onClick={() => void refresh()}>{t('إعادة المحاولة', 'Try again')}</button>} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="!p-4"><p className="text-[12px] font-semibold text-ink-faint">{t('وظائف منشورة', 'Published jobs')}</p><p className="mt-1 text-3xl font-extrabold text-navy">{num(data.jobs.length, lang)}</p></Card>
            <Card className="!p-4"><p className="text-[12px] font-semibold text-ink-faint">{t('مطلوب توظيفهم', 'To recruit')}</p><p className="mt-1 text-3xl font-extrabold text-navy">{num(totalSeats, lang)}</p></Card>
            <Card className="!p-4"><p className="text-[12px] font-semibold text-ink-faint">{t('طلبات جديدة', 'New applications')}</p><p className="mt-1 text-3xl font-extrabold text-navy">{num(totalNew, lang)}</p></Card>
          </div>

          <Card className="!p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-pressed={recruiter === null} onClick={() => setRecruiter(null)} className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${recruiter === null ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{t('الكل', 'All')} · {num(data.jobs.length, lang)}</button>
              {recruiters.map((person) => <button key={person.id} type="button" aria-pressed={recruiter === person.id} onClick={() => setRecruiter(person.id)} className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${recruiter === person.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{person.name} · {num(person.count, lang)}</button>)}
              <label className="relative ms-auto w-full sm:w-60"><Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" /><input className="field !py-2 ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('ابحث عن وظيفة…', 'Search jobs…')} aria-label={t('بحث', 'Search')} /></label>
            </div>
            <p className="mt-3 text-[11px] text-ink-faint">{t('المصدر: Odoo · Egypt - Engoaad · Published', 'Source: Odoo · Egypt - Engoaad · Published')}{data.fetchedAt ? ` · ${t('آخر قراءة', 'Last read')} ${date(data.fetchedAt, lang)}` : ''}</p>
          </Card>

          {jobs.length ? <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {jobs.map((job) => <Card key={job.id} className="relative overflow-hidden !p-0">
              <div className="absolute end-0 top-0 rounded-bl-xl bg-emerald-500 px-3 py-1 text-[11px] font-extrabold text-white">{t('منشورة', 'PUBLISHED')}</div>
              <div className="p-5">
                <div className="pe-20"><h2 className="text-[16px] font-extrabold text-navy">{job.name}</h2><p className="mt-1 text-[12px] text-ink-faint">{job.recruiter?.name || t('بدون مسؤول', 'Unassigned')}</p><p className="mt-1 text-[12px] text-ink-faint">{job.company}{job.department ? ` · ${job.department}` : ''}</p></div>
                <div className="mt-6 flex flex-wrap items-center gap-3 text-[12px]"><span className="rounded-lg bg-violet-100 px-3 py-2 font-bold text-violet-800">{num(job.newApplications, lang)} {t('طلبات جديدة', 'New Applications')}</span><span className="font-semibold text-slate-700">{num(job.toRecruit, lang)} {t('مطلوب', 'To Recruit')}</span><span className="font-semibold text-slate-700">{num(job.applications, lang)} {t('متقدم', 'Applications')}</span></div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3 text-[12px]"><span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><Globe2 size={14} />{t('منشورة', 'Published')}</span><a href={job.odooUrl} target="_blank" rel="noreferrer" className="ms-auto inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"><UsersRound size={14} />{t('فتح في Odoo', 'Open in Odoo')}<ExternalLink size={13} /></a>{job.jobUrl && <a href={job.jobUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">{t('صفحة الوظيفة', 'Job Page')}<ExternalLink size={13} /></a>}</div>
            </Card>)}
          </div> : <EmptyBlock title={t('لا توجد وظائف تطابق البحث', 'No matching jobs')} />}
        </>
      )}
    </div>
  );
}
