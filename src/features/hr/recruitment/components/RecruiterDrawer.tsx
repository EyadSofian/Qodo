/**
 * One recruiter's desk, opened from their card: every job they carry with its
 * clock and the changes allowed on it right there (priority, deadline,
 * reassignment), then what Odoo publishes under their name, then KPI and
 * reward progress with a way into each.
 *
 * An edit opens the same dialog the request page uses. The drawer steps aside
 * while the dialog is up and comes back with fresh figures when it closes.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ExternalLink, Flag, Globe2, Pencil, TimerOff, UserPlus } from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { hrApi, invalidateHR, useHRQuery } from '../../api';
import { num, shortName, useHRText } from '../../format';
import { PRIORITY_LABEL } from '../../labels';
import type { JobRequest, OdooJob, RecruiterBoardRow, RecruiterCardData, RecruitmentContext } from '../../types';
import { Drawer } from '../../ui/Drawer';
import { Badge, LinkArrow, PersonAvatar, PriorityBadge, ProgressDots, SlaMeter, StatusBadge } from '../../ui/primitives';
import { EmptyBlock, Skeleton } from '../../ui/states';
import { TONE } from '../../ui/tones';
import { AssignDialog, ExtendDialog, PriorityDialog } from './dialogs';

interface CapacityBoard {
  recruiters: RecruiterBoardRow[];
  context: RecruitmentContext;
}

type Edit = { kind: 'priority' | 'extend' | 'assign'; job: JobRequest };

/** A published Odoo job, and the Qodo request that carries its deadline. */
export function OdooJobRow({ job, onNavigate }: { job: OdooJob; onNavigate?: () => void }) {
  const { t, lang } = useHRText();
  return (
    <li className="rounded-2xl border border-violet-100 bg-violet-50/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="hr-bidi truncate text-[13px] font-bold text-navy">{job.name}</p>
          <p className="mt-0.5 text-[11.5px] text-[#5A6C82]">
            {t(`${num(job.toRecruit, lang)} مقعد · ${num(job.applications, lang)} متقدم`, `${num(job.toRecruit, lang)} seats · ${num(job.applications, lang)} applications`)}
            {job.department ? ` · ${job.department}` : ''}
          </p>
        </div>
        {job.newApplications > 0 && <span className="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-bold text-white">{t(`${num(job.newApplications, lang)} جديد`, `${num(job.newApplications, lang)} new`)}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] font-semibold">
        {job.request ? (
          <Link to={`/hr/recruitment/requests/${encodeURIComponent(job.request.id)}`} onClick={onNavigate} className="inline-flex items-center gap-1 text-[rgb(var(--hr-a1))] hover:underline">
            <Pencil size={12} aria-hidden="true" />
            {t(`طلب ${job.request.reference}`, `Request ${job.request.reference}`)}
          </Link>
        ) : (
          <span className="text-ink-faint">{t('غير مرتبطة بطلب في Qodo', 'No Qodo request linked')}</span>
        )}
        <a href={job.odooUrl} target="_blank" rel="noreferrer" className="ms-auto inline-flex items-center gap-1 text-violet-700 hover:underline">
          {t('فتح في Odoo', 'Open in Odoo')}
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </li>
  );
}

export function RecruiterDrawer({ card, onClose }: { card: RecruiterCardData | null; onClose: () => void }) {
  const { t, lang, pick } = useHRText();
  const { data, loading } = useHRQuery<CapacityBoard>(card ? hrApi.recruitment.capacity : null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const row = data?.recruiters.find((item) => item.member.employeeCode === card?.member.employeeCode) ?? null;
  // The board row is the fresh copy of the card that was clicked.
  const live = row ?? card;
  const jobs = row?.jobs ?? [];
  const odooJobs = row?.odooJobs ?? [];
  const name = live ? (lang === 'en' ? live.member.nameEnglish : live.member.nameArabic) || shortName(live.member.shortName, lang) : '';
  const done = () => {
    setEdit(null);
    invalidateHR('/hr/recruitment');
  };

  return (
    <>
      <Drawer open={Boolean(card) && !edit} onClose={onClose} title={name} subtitle={live?.member.title} width={580}>
        {live && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <PersonAvatar name={name} photoUrl={live.member.photoUrl} size={64} />
              <dl className="grid flex-1 grid-cols-3 gap-2 text-center">
                {(['critical', 'required', 'planned'] as const).map((key) => (
                  <div key={key} className={cx('rounded-2xl px-2 py-2.5', live.level[key] === 'over' ? 'bg-red-50 ring-1 ring-red-200' : live.level[key] === 'full' ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-[#F6F8FB]')}>
                    <dt className="text-[11px] font-semibold text-[#5A6C82]">{pick(PRIORITY_LABEL[key])}</dt>
                    <dd className={cx('mt-0.5 text-[16px] font-bold tabular-nums', live.level[key] === 'over' ? TONE.critical.text : live.level[key] === 'full' ? TONE.warning.text : 'text-navy')}>{live.workload[key]}{live.limits[key] !== null ? <span className="text-[12px] font-semibold text-ink-faint"> / {live.limits[key]}</span> : null}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {live.overdue > 0 && (
              <p className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] font-bold text-red-700">
                <TimerOff size={15} aria-hidden="true" />
                {t(`${num(live.overdue, lang)} وظيفة تجاوزت مهلتها — تظهر أولاً بالأسفل.`, `${num(live.overdue, lang)} jobs are past their deadline — listed first below.`)}
              </p>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-bold text-navy">{t('الوظائف المسندة', 'Assigned jobs')}{jobs.length ? <span className="ms-1.5 font-semibold text-ink-faint">{num(jobs.length, lang)}</span> : null}</h3>
                <LinkArrow to={`/hr/recruitment/hiring?recruiter=${encodeURIComponent(live.member.employeeCode)}`}>{t('في التوظيف النشط', 'In Active Hiring')}</LinkArrow>
              </div>
              {loading && !data ? <Skeleton className="h-32" /> : jobs.length === 0 ? (
                <EmptyBlock title={t('لا توجد وظائف نشطة', 'No active jobs')} />
              ) : (
                <ul className="space-y-2">
                  {[...jobs].sort((left, right) => Number(right.slaSnapshot.state === 'overdue') - Number(left.slaSnapshot.state === 'overdue')).map((job) => {
                    const overdue = job.slaSnapshot.state === 'overdue';
                    const actions = [
                      job.abilities.changePriority && { kind: 'priority' as const, icon: Flag, label: t('الأولوية', 'Priority') },
                      job.abilities.extend && { kind: 'extend' as const, icon: CalendarPlus, label: t('مد المهلة', 'Extend') },
                      job.abilities.assign && { kind: 'assign' as const, icon: UserPlus, label: t('إعادة إسناد', 'Reassign') },
                    ].filter(Boolean) as Array<{ kind: Edit['kind']; icon: typeof Flag; label: string }>;
                    return (
                      <li key={job.id} className={cx('rounded-2xl border p-3', overdue ? 'border-red-200 bg-red-50/40' : 'border-[#E6ECF3]')}>
                        <div className="flex items-start justify-between gap-2">
                          <Link to={`/hr/recruitment/requests/${encodeURIComponent(job.id)}`} onClick={onClose} className="min-w-0 hover:underline">
                            <p className="hr-bidi truncate text-[13px] font-bold text-navy">{job.title}</p>
                            <p className="text-[11.5px] text-ink-faint">{job.reference} · {job.department || '—'}</p>
                          </Link>
                          <div className="flex shrink-0 gap-1.5"><PriorityBadge priority={job.priority} />{job.status !== 'hiring' && <StatusBadge status={job.status} />}</div>
                        </div>
                        <div className="mt-2.5"><SlaMeter sla={job.slaSnapshot} /></div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[#EEF2F7] pt-2.5">
                          {actions.map((action) => (
                            <button key={action.kind} type="button" onClick={() => setEdit({ kind: action.kind, job })} className="inline-flex min-h-8 items-center gap-1 rounded-xl border border-[#E6ECF3] bg-white px-2.5 text-[12px] font-semibold text-navy hover:border-[rgb(var(--hr-a1)/0.5)] hover:text-[rgb(var(--hr-a1))]">
                              <action.icon size={13} aria-hidden="true" />
                              {action.label}
                            </button>
                          ))}
                          <Link to={`/hr/recruitment/requests/${encodeURIComponent(job.id)}`} onClick={onClose} className="ms-auto inline-flex min-h-8 items-center gap-1 rounded-xl px-2.5 text-[12px] font-bold text-[rgb(var(--hr-a1))] hover:underline">
                            <Pencil size={13} aria-hidden="true" />
                            {t('فتح وتعديل', 'Open & edit')}
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {live.odoo && (
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-navy"><Globe2 size={14} className="text-violet-600" aria-hidden="true" />{t('منشور في Odoo', 'Published in Odoo')}{odooJobs.length ? <span className="font-semibold text-ink-faint">{num(odooJobs.length, lang)}</span> : null}</h3>
                  <LinkArrow to="/hr/recruitment/odoo-jobs">{t('كل وظائف Odoo', 'All Odoo jobs')}</LinkArrow>
                </div>
                {loading && !data ? <Skeleton className="h-20" /> : odooJobs.length === 0 ? (
                  <p className="rounded-2xl bg-[#F6F8FB] px-3.5 py-3 text-[12.5px] text-[#5A6C82]">{t('لا توجد وظائف منشورة باسم هذا المسؤول في Odoo الآن.', 'Odoo has no published job under this name right now.')}</p>
                ) : (
                  <ul className="space-y-2">{odooJobs.map((job) => <OdooJobRow key={job.id} job={job} onNavigate={onClose} />)}</ul>
                )}
              </section>
            )}

            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#E6ECF3] p-3.5">
                <p className="text-[12px] font-semibold text-[#5A6C82]">{t('مؤشر الأداء هذا الشهر', 'KPI this month')}</p>
                <p className="mt-1 text-[22px] font-bold text-navy">{live.kpi.percent === null ? '—' : `${Math.round(live.kpi.percent)}%`}</p>
                <div className="mt-2"><LinkArrow to={`/hr/recruitment/kpi?recruiter=${encodeURIComponent(live.member.employeeCode)}`}>{t('لماذا هذه النتيجة؟', 'Why this score?')}</LinkArrow></div>
              </div>
              <div className={cx('rounded-2xl border p-3.5', live.reward.ready > 0 ? 'border-emerald-200 bg-emerald-50/60' : 'border-[#E6ECF3]')}>
                <p className="flex items-center justify-between gap-2 text-[12px] font-semibold text-[#5A6C82]">{t('تقدم المكافأة', 'Reward progress')}{live.reward.ready > 0 && <Badge tone="success">{t('دفعة جاهزة', 'Batch ready')}</Badge>}</p>
                <div className="mt-2 flex items-center gap-2"><ProgressDots done={live.reward.ready > 0 ? live.reward.of : live.reward.done} of={live.reward.of} /><span className="text-[13px] font-bold text-navy">{live.reward.done} / {live.reward.of}</span></div>
                <div className="mt-2"><LinkArrow to={`/hr/recruitment/rewards?recruiter=${encodeURIComponent(live.member.employeeCode)}`}>{t('فتح المكافآت', 'Open rewards')}</LinkArrow></div>
              </div>
            </section>
          </div>
        )}
      </Drawer>

      {edit && data && edit.kind === 'priority' && <PriorityDialog request={edit.job} context={data.context} onClose={() => setEdit(null)} onDone={done} />}
      {edit && data && edit.kind === 'extend' && <ExtendDialog request={edit.job} context={data.context} onClose={() => setEdit(null)} onDone={done} />}
      {edit && data && edit.kind === 'assign' && <AssignDialog request={edit.job} context={data.context} onClose={() => setEdit(null)} onDone={done} />}
    </>
  );
}
