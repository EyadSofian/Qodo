/**
 * /hr/recruitment/capacity — who can take the next job.
 *
 * Each recruiter against their limits (Critical 2, Required 5, Planned open),
 * with the jobs behind the numbers one click away and reassignment in place.
 * Arriving from an alert (`?recruiter=`) opens and highlights that person.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronDown, UserPlus } from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { hrApi, invalidateHR, useHRQuery } from '../../api';
import { shortName, useHRText } from '../../format';
import { PRIORITY_LABEL } from '../../labels';
import type { JobRequest, RecruiterCardData, RecruitmentContext } from '../../types';
import { useMotion } from '../../ui/motion';
import { Badge, CapacityBar, Card, PageHeader, PersonAvatar, PriorityBadge, SectionTitle, SlaMeter, StatusBadge } from '../../ui/primitives';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../../ui/states';
import { TONE } from '../../ui/tones';
import { AssignDialog } from '../components/dialogs';

interface Board {
  recruiters: Array<RecruiterCardData & { jobs: JobRequest[] }>;
  unassigned: JobRequest[];
  context: RecruitmentContext;
}

function JobRow({ job, canAssign, onAssign }: { job: JobRequest; canAssign: boolean; onAssign: () => void }) {
  const { t } = useHRText();
  return (
    <li className="grid grid-cols-1 items-center gap-3 rounded-xl border border-[#EEF2F7] px-3.5 py-2.5 sm:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1fr)_auto]">
      <Link to={`/hr/recruitment/requests/${encodeURIComponent(job.id)}`} className="min-w-0 hover:underline">
        <p className="hr-bidi truncate text-[13px] font-bold text-navy">{job.title}</p>
        <p className="truncate text-[11.5px] text-ink-faint">{job.reference} · {job.department || '—'}</p>
      </Link>
      <div className="flex gap-1.5"><PriorityBadge priority={job.priority} />{job.status !== 'hiring' && <StatusBadge status={job.status} />}</div>
      <SlaMeter sla={job.slaSnapshot} />
      {canAssign && job.abilities.assign ? <button type="button" className="btn-ghost btn-sm !min-h-8" onClick={onAssign}><UserPlus size={14} />{t('إعادة إسناد', 'Reassign')}</button> : <span />}
    </li>
  );
}

export function RecruitmentCapacity() {
  const { t, lang, pick } = useHRText();
  const motionPresets = useMotion();
  const [params] = useSearchParams();
  const focus = params.get('recruiter');
  const { data, error, loading, reload } = useHRQuery<Board>(hrApi.recruitment.capacity, { refreshMs: 120_000 });
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus ? [focus] : []));
  const [assigning, setAssigning] = useState<JobRequest | null>(null);

  useEffect(() => {
    if (!focus || !data) return;
    setOpen((current) => new Set([...current, focus]));
    window.requestAnimationFrame(() => {
      document.getElementById(`recruiter-${focus}`)?.scrollIntoView({ behavior: motionPresets.reduce ? 'auto' : 'smooth', block: 'center' });
    });
  }, [focus, data, motionPresets.reduce]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={2} />;
  if (!data) return null;
  const canAssign = Boolean(data.context.perms.assign);
  const toggle = (code: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    return next;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('التوظيف', 'Recruitment')}
        title={t('سعة الفريق', 'Team capacity')}
        description={t(`الحد الأقصى: ${data.context.policy.capacity.critical ?? '∞'} وظائف حرجة و${data.context.policy.capacity.required ?? '∞'} مطلوبة لكل مسؤول؛ المخطط لها بلا حد. تُحسب الوظائف المعتمدة (النشطة والمعلّقة) فقط.`, `Limits: ${data.context.policy.capacity.critical ?? '∞'} Critical and ${data.context.policy.capacity.required ?? '∞'} Required per recruiter; Planned is open. Only approved jobs (hiring or on hold) count.`)}
      />

      <div className="space-y-3">
        {data.recruiters.map((card) => {
          const code = card.member.employeeCode;
          const name = shortName(card.member.shortName, lang);
          const expanded = open.has(code);
          const over = card.level.critical === 'over' || card.level.required === 'over';
          const full = card.level.critical === 'full' || card.level.required === 'full';
          return (
            <motion.div
              key={code}
              id={`recruiter-${code}`}
              layout={!motionPresets.reduce}
              className={cx('rounded-2xl border bg-white shadow-[0_1px_2px_rgba(11,37,69,0.04)] transition-shadow', focus === code ? 'ring-2 ring-brand-300' : '', over ? 'border-red-200' : full ? 'border-amber-200' : 'border-[#E6ECF3]')}
            >
              <button type="button" onClick={() => toggle(code)} aria-expanded={expanded} className="grid grid-cols-1 w-full items-center gap-4 p-4 text-start sm:grid-cols-[minmax(0,15rem)_1fr_auto]">
                <span className="flex min-w-0 items-center gap-3">
                  <PersonAvatar name={name} photoUrl={card.member.photoUrl} size={44} />
                  <span className="min-w-0">
                    <span className="hr-bidi block truncate text-[14px] font-bold text-navy">{name}</span>
                    <span className="hr-bidi block truncate text-[12px] text-[#5A6C82]">{card.member.title}</span>
                  </span>
                </span>
                <span className="grid grid-cols-3 gap-4">
                  {(['critical', 'required', 'planned'] as const).map((key) => (
                    <span key={key} className="min-w-0">
                      <span className="flex items-baseline justify-between gap-1 text-[11.5px] font-semibold text-[#5A6C82]">
                        {pick(PRIORITY_LABEL[key])}
                        <span className={cx('text-[13px] font-bold tabular-nums', card.level[key] === 'over' ? TONE.critical.text : card.level[key] === 'full' ? TONE.warning.text : 'text-navy')}>
                          {card.workload[key]}{card.limits[key] !== null ? ` / ${card.limits[key]}` : ''}
                        </span>
                      </span>
                      <span className="mt-1.5 block">{card.limits[key] !== null ? <CapacityBar count={card.workload[key]} limit={card.limits[key]} tone={key === 'critical' ? 'critical' : 'warning'} /> : <span className="block h-1.5 rounded-full bg-brand-100" />}</span>
                    </span>
                  ))}
                </span>
                <span className="flex items-center gap-2 justify-self-end">
                  {card.pipeline > 0 && <Badge tone="neutral">{t(`${card.pipeline} قيد الاعتماد`, `${card.pipeline} pending approval`)}</Badge>}
                  {card.overdue > 0 && <Badge tone="critical">{t(`${card.overdue} متأخرة`, `${card.overdue} overdue`)}</Badge>}
                  <ChevronDown size={18} className={cx('text-ink-faint transition-transform duration-200', expanded && 'rotate-180')} aria-hidden="true" />
                </span>
              </button>
              {expanded && (
                <div className="border-t border-[#EEF2F7] p-4 pt-3">
                  {card.jobs.length ? (
                    <ul className="space-y-2">{card.jobs.map((job) => <JobRow key={job.id} job={job} canAssign={canAssign} onAssign={() => setAssigning(job)} />)}</ul>
                  ) : <p className="text-[12.5px] text-ink-faint">{t('لا توجد وظائف مسندة.', 'No jobs assigned.')}</p>}
                </div>
              )}
            </motion.div>
          );
        })}
        {!data.recruiters.length && <EmptyBlock title={t('لا يوجد فريق توظيف بعد', 'No recruitment team yet')} />}
      </div>

      <Card>
        <SectionTitle title={t('وظائف بلا مسؤول', 'Jobs without a recruiter')} hint={t('الوظائف الحرجة بلا مسؤول تظهر كتنبيه حرج.', 'A Critical job without a recruiter raises a critical alert.')} />
        {data.unassigned.length ? (
          <ul className="space-y-2">{data.unassigned.map((job) => <JobRow key={job.id} job={job} canAssign={canAssign} onAssign={() => setAssigning(job)} />)}</ul>
        ) : <p className="text-[12.5px] text-emerald-700">{t('كل الوظائف لها مسؤول.', 'Every job has a recruiter.')}</p>}
      </Card>

      {assigning && (
        <AssignDialog
          request={assigning}
          context={data.context}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            invalidateHR('/hr/recruitment');
          }}
        />
      )}
    </div>
  );
}

export default RecruitmentCapacity;
