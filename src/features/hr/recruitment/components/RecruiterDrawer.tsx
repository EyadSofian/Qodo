/**
 * One recruiter's workload and month, opened from their card: every job they
 * carry with its clock, then KPI and reward progress with a way into each.
 */

import { Link } from 'react-router-dom';
import { hrApi, useHRQuery } from '../../api';
import { shortName, useHRText } from '../../format';
import { PRIORITY_LABEL } from '../../labels';
import type { JobRequest, RecruiterCardData } from '../../types';
import { Drawer } from '../../ui/Drawer';
import { LinkArrow, PersonAvatar, PriorityBadge, ProgressDots, SlaMeter, StatusBadge } from '../../ui/primitives';
import { EmptyBlock, Skeleton } from '../../ui/states';

interface CapacityBoard {
  recruiters: Array<RecruiterCardData & { jobs: JobRequest[] }>;
}

export function RecruiterDrawer({ card, onClose }: { card: RecruiterCardData | null; onClose: () => void }) {
  const { t, lang, pick } = useHRText();
  const { data, loading } = useHRQuery<CapacityBoard>(card ? hrApi.recruitment.capacity : null);
  const jobs = data?.recruiters.find((item) => item.member.employeeCode === card?.member.employeeCode)?.jobs ?? [];
  const name = card ? (lang === 'en' ? card.member.nameEnglish : card.member.nameArabic) || shortName(card.member.shortName, lang) : '';

  return (
    <Drawer open={Boolean(card)} onClose={onClose} title={name} subtitle={card?.member.title} width={560}>
      {card && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <PersonAvatar name={name} photoUrl={card.member.photoUrl} size={64} />
            <dl className="grid flex-1 grid-cols-3 gap-2 text-center">
              {(['critical', 'required', 'planned'] as const).map((key) => (
                <div key={key} className="rounded-xl bg-[#F6F8FB] px-2 py-2.5">
                  <dt className="text-[11px] font-semibold text-[#5A6C82]">{pick(PRIORITY_LABEL[key])}</dt>
                  <dd className="mt-0.5 text-[16px] font-bold tabular-nums text-navy">{card.workload[key]}{card.limits[key] !== null ? <span className="text-[12px] font-semibold text-ink-faint"> / {card.limits[key]}</span> : null}</dd>
                </div>
              ))}
            </dl>
          </div>

          <section>
            <h3 className="mb-2 text-[13px] font-bold text-navy">{t('الوظائف المسندة', 'Assigned jobs')}</h3>
            {loading && !data ? <Skeleton className="h-32" /> : jobs.length === 0 ? (
              <EmptyBlock title={t('لا توجد وظائف نشطة', 'No active jobs')} />
            ) : (
              <ul className="space-y-2">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <Link to={`/hr/recruitment/requests/${encodeURIComponent(job.id)}`} onClick={onClose} className="block rounded-xl border border-[#E6ECF3] p-3 hover:border-brand-200 hover:bg-[#F7FAFD]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="hr-bidi truncate text-[13px] font-bold text-navy">{job.title}</p>
                          <p className="text-[11.5px] text-ink-faint">{job.reference} · {job.department || '—'}</p>
                        </div>
                        <div className="flex shrink-0 gap-1.5"><PriorityBadge priority={job.priority} />{job.status !== 'hiring' && <StatusBadge status={job.status} />}</div>
                      </div>
                      <div className="mt-2.5"><SlaMeter sla={job.slaSnapshot} /></div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E6ECF3] p-3.5">
              <p className="text-[12px] font-semibold text-[#5A6C82]">{t('مؤشر الأداء هذا الشهر', 'KPI this month')}</p>
              <p className="mt-1 text-[22px] font-bold text-navy">{card.kpi.percent === null ? '—' : `${Math.round(card.kpi.percent)}%`}</p>
              <div className="mt-2"><LinkArrow to={`/hr/recruitment/kpi?recruiter=${encodeURIComponent(card.member.employeeCode)}`}>{t('لماذا هذه النتيجة؟', 'Why this score?')}</LinkArrow></div>
            </div>
            <div className="rounded-xl border border-[#E6ECF3] p-3.5">
              <p className="text-[12px] font-semibold text-[#5A6C82]">{t('تقدم المكافأة', 'Reward progress')}</p>
              <div className="mt-2 flex items-center gap-2"><ProgressDots done={card.reward.done} of={card.reward.of} /><span className="text-[13px] font-bold text-navy">{card.reward.done} / {card.reward.of}</span></div>
              <div className="mt-2"><LinkArrow to={`/hr/recruitment/rewards?recruiter=${encodeURIComponent(card.member.employeeCode)}`}>{t('فتح المكافآت', 'Open rewards')}</LinkArrow></div>
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}
