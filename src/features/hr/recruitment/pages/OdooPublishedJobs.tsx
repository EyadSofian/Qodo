import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ExternalLink, Globe2, RefreshCw, Search, UsersRound } from 'lucide-react';
import { api, errorMessage } from '../../../../lib/api';
import { cx } from '../../../../lib/utils';
import { hrApi, useHRQuery } from '../../api';
import { date, num, useHRText } from '../../format';
import { Card, PageHeader, PersonAvatar, SectionTitle } from '../../ui/primitives';
import { Drawer } from '../../ui/Drawer';
import { useMotion } from '../../ui/motion';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../../ui/states';
import { RecruiterCarousel } from '../components/RecruiterCarousel';

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
  team: OdooRecruiter[];
}

interface OdooRecruiter {
  id: number;
  name: string;
  fullName: string;
  nameArabic: string;
  title: string;
  employeeCode: string | null;
  photoUrl: string | null;
}

function RecruiterCard({ person, jobs, active, onOpen }: { person: OdooRecruiter; jobs: OdooJob[]; active: boolean; onOpen: () => void }) {
  const { t, lang } = useHRText();
  const motionPresets = useMotion();
  const fullName = lang === 'ar' ? person.nameArabic || person.fullName : person.fullName;
  const short = fullName.split(/\s+/).slice(0, 2).join(' ');
  const seats = jobs.reduce((sum, job) => sum + job.toRecruit, 0);
  const newApplications = jobs.reduce((sum, job) => sum + job.newApplications, 0);
  return <motion.button
    type="button"
    onClick={onOpen}
    animate={motionPresets.reduce ? undefined : { y: active ? -4 : 0 }}
    transition={motionPresets.spring}
    className={cx('flex h-full w-full flex-col rounded-2xl border border-[#E6ECF3] bg-white p-4 text-start outline-none transition-[box-shadow,border-color] duration-200', active ? 'shadow-[0_18px_40px_-22px_rgba(11,37,69,0.45)]' : 'shadow-[0_1px_2px_rgba(11,37,69,0.04)] hover:shadow-[0_12px_28px_-20px_rgba(11,37,69,0.4)]')}
    aria-label={t(`فتح وظائف ${short}`, `Open ${short}'s jobs`)}
  >
    <div className="flex items-center gap-3">
      <PersonAvatar name={fullName} photoUrl={person.photoUrl} size={52} />
      <div className="min-w-0 flex-1"><p className="hr-bidi truncate text-[14.5px] font-bold text-navy" title={fullName}>{short}</p><p className="hr-bidi truncate text-[12px] text-[#5A6C82]" title={person.title}>{person.title || t('فريق التوظيف', 'Recruitment team')}</p></div>
    </div>
    <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[#EEF2F7] pt-3.5 text-center">
      <div><dt className="text-[10.5px] font-semibold leading-4 text-[#5A6C82]">{t('وظائف منشورة', 'Published jobs')}</dt><dd className="mt-1 text-[20px] font-bold text-navy">{num(jobs.length, lang)}</dd></div>
      <div><dt className="text-[10.5px] font-semibold leading-4 text-[#5A6C82]">{t('مطلوب', 'To recruit')}</dt><dd className="mt-1 text-[20px] font-bold text-navy">{num(seats, lang)}</dd></div>
      <div><dt className="text-[10.5px] font-semibold leading-4 text-[#5A6C82]">{t('طلبات جديدة', 'New applications')}</dt><dd className="mt-1 text-[20px] font-bold text-navy">{num(newApplications, lang)}</dd></div>
    </dl>
    <span className="mt-4 block w-full rounded-xl bg-[#F6F8FB] px-3 py-2.5 text-center text-[12px] font-bold text-brand-700">{t('افتح وظائف المسؤول', 'Open recruiter jobs')}</span>
  </motion.button>;
}

export function OdooPublishedJobs({ view = 'team' }: { view?: 'team' | 'jobs' }) {
  const { t, lang } = useHRText();
  const { data, error, loading, reload, setData } = useHRQuery<OdooJobsData>(hrApi.recruitment.odooJobs(), { refreshMs: 120_000 });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [recruiter, setRecruiter] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const recruiters = useMemo(() => (data?.team ?? [])
    .map((person) => ({ ...person, count: data?.jobs.filter((job) => job.recruiter?.id === person.id).length ?? 0 }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)), [data]);
  const jobs = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (data?.jobs ?? []).filter((job) =>
      (recruiter === null || job.recruiter?.id === recruiter) &&
      (!needle || `${job.name} ${job.department} ${job.recruiter?.name ?? ''}`.toLocaleLowerCase().includes(needle))
    );
  }, [data, recruiter, query]);
  const openPerson = data?.team?.find((person) => person.id === open) ?? null;
  const personJobs = openPerson ? data?.jobs.filter((job) => job.recruiter?.id === openPerson.id) ?? [] : [];

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
        title={view === 'team' ? t('مكتب التوظيف', 'Recruitment desk') : t('الوظائف المنشورة في مصر', 'Published jobs in Egypt')}
        description={view === 'team' ? t('اختَر مسؤول التوظيف لعرض وظائفه المنشورة في Odoo لشركة Egypt - Engoaad.', 'Choose a recruiter to view their published Odoo jobs for Egypt - Engoaad.') : t('من وظائف Odoo مباشرة: شركة Egypt - Engoaad، الوظائف النشطة والمنشورة فقط.', 'Live from Odoo jobs: Egypt - Engoaad, active and published positions only.')}
        actions={<><button type="button" className="btn-secondary btn-sm" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />{t('تحديث من Odoo', 'Refresh from Odoo')}</button>{view === 'team' && <Link to="/hr/recruitment/hiring" className="btn-primary btn-sm">{t('كل الوظائف', 'All jobs')}</Link>}</>}
      />
      {refreshError !== null && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] font-semibold text-rose-700">{t('تعذّر تحديث وظائف Odoo: ', 'Could not refresh Odoo jobs: ')}{errorMessage(refreshError, lang)}</p>}

      {!data.configured || !data.connected ? (
        <EmptyBlock title={t('تعذّر الاتصال بوظائف Odoo', 'Odoo jobs are unavailable')} body={t('تحقق من إعدادات الربط ثم أعد المحاولة.', 'Check the connection and try again.')} action={<button type="button" className="btn-secondary btn-sm" onClick={() => void refresh()}>{t('إعادة المحاولة', 'Try again')}</button>} />
      ) : (
        <>
          {view === 'team' && <section aria-labelledby="recruitment-team-title">
            <SectionTitle id="recruitment-team-title" title={t('فريق التوظيف', 'Recruitment team')} hint={t('اضغط على أي موظف لفتح وظائفه الحالية.', 'Select a team member to open their current jobs.')} />
            <RecruiterCarousel
              cards={recruiters}
              keyOf={(person) => person.id}
              labelOf={(person) => person.name}
              onOpen={(person) => setOpen(person.id)}
              renderCard={(person, active, onOpen) => <RecruiterCard person={person} jobs={data.jobs.filter((job) => job.recruiter?.id === person.id)} active={active} onOpen={onOpen} />}
            />
          </section>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="!p-4"><p className="text-[12px] font-semibold text-ink-faint">{t('وظائف منشورة', 'Published jobs')}</p><p className="mt-1 text-3xl font-extrabold text-navy">{num(data.jobs.length, lang)}</p></Card>
            <Card className="!p-4"><p className="text-[12px] font-semibold text-ink-faint">{t('مطلوب توظيفهم', 'To recruit')}</p><p className="mt-1 text-3xl font-extrabold text-navy">{num(totalSeats, lang)}</p></Card>
            <Card className="!p-4"><p className="text-[12px] font-semibold text-ink-faint">{t('طلبات جديدة', 'New applications')}</p><p className="mt-1 text-3xl font-extrabold text-navy">{num(totalNew, lang)}</p></Card>
          </div>

          {view === 'jobs' && <><Card className="!p-4">
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
          </div> : <EmptyBlock title={t('لا توجد وظائف تطابق البحث', 'No matching jobs')} />}</>}
          {view === 'team' && <p className="text-[11px] text-ink-faint">{t('المصدر: Odoo · Egypt - Engoaad · Published', 'Source: Odoo · Egypt - Engoaad · Published')}{data.fetchedAt ? ` · ${t('آخر قراءة', 'Last read')} ${date(data.fetchedAt, lang)}` : ''}</p>}
          <Drawer open={Boolean(openPerson)} onClose={() => setOpen(null)} title={openPerson ? (lang === 'ar' ? openPerson.nameArabic || openPerson.fullName : openPerson.fullName) : ''} subtitle={openPerson?.title} width={560}>
            {openPerson && <div className="space-y-5">
              <div className="flex items-center gap-4"><PersonAvatar name={openPerson.fullName} photoUrl={openPerson.photoUrl} size={64} /><div><p className="text-[13px] font-bold text-navy">{num(personJobs.length, lang)} {t('وظائف منشورة', 'published jobs')}</p><p className="text-[12px] text-ink-faint">{t('Egypt - Engoaad · Published', 'Egypt - Engoaad · Published')}</p></div></div>
              <section><h3 className="mb-2 text-[13px] font-bold text-navy">{t('الوظائف المسندة', 'Assigned jobs')}</h3>
                {personJobs.length ? <ul className="space-y-2">{personJobs.map((job) => <li key={job.id} className="rounded-xl border border-[#E6ECF3] p-3"><p className="text-[13px] font-bold text-navy">{job.name}</p><p className="mt-1 text-[11.5px] text-ink-faint">{num(job.toRecruit, lang)} {t('مطلوب', 'to recruit')} · {num(job.newApplications, lang)} {t('طلبات جديدة', 'new applications')} · {num(job.applications, lang)} {t('متقدم', 'applications')}</p><a href={job.odooUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:underline">{t('فتح الوظيفة في Odoo', 'Open job in Odoo')}<ExternalLink size={13} /></a></li>)}</ul> : <EmptyBlock title={t('لا توجد وظائف منشورة مسندة له حالياً', 'No published jobs assigned right now')} />}
              </section>
            </div>}
          </Drawer>
        </>
      )}
    </div>
  );
}
