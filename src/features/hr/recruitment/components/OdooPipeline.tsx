/**
 * The Odoo side of one job: its stages, the six-step funnel, and the
 * candidates — scoped to applicants since this job's clock started, because
 * an Odoo job is reused round after round.
 */

import { motion } from 'framer-motion';
import { ExternalLink, Link2, RefreshCw, TriangleAlert } from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { invalidateHR } from '../../api';
import { date, money, num, useHRText } from '../../format';
import { FUNNEL_LABEL, ODOO_STAGE_AR } from '../../labels';
import type { RequestPipeline } from '../../types';
import { useMotion } from '../../ui/motion';
import { Badge } from '../../ui/primitives';
import { EmptyBlock, Skeleton } from '../../ui/states';

const STEPS = ['received', 'filtered', 'interviewed', 'accepted', 'offer', 'hired'] as const;

export function stageName(stage: string, lang: 'ar' | 'en') {
  return lang === 'en' ? stage : ODOO_STAGE_AR[stage] ?? stage;
}

export function OdooPipeline({ pipeline, loading, canLink, onLink, onRefresh }: { pipeline: RequestPipeline | null; loading: boolean; canLink: boolean; onLink: () => void; onRefresh: () => void }) {
  const { t, lang, pick } = useHRText();
  const motionPresets = useMotion();
  if (loading && !pipeline) return <Skeleton className="h-48" />;
  if (!pipeline?.configured) return <EmptyBlock title={t('Odoo غير مُعد', 'Odoo is not configured')} body={t('مسار المرشحين يظهر هنا عند ربط Odoo بالخادم.', 'The candidate pipeline appears here once Odoo is configured.')} />;
  if (!pipeline.connected) {
    return <EmptyBlock icon={<TriangleAlert size={22} />} title={t('تعذّر الوصول إلى Odoo الآن', 'Odoo is unreachable right now')} body={t('بيانات Qodo ما زالت صحيحة؛ سيُعاد المحاولة عند التحديث.', 'Qodo\'s own data is unaffected; it will retry on refresh.')} action={<button type="button" className="btn-ghost btn-sm mt-2" onClick={onRefresh}><RefreshCw size={14} />{t('تحديث', 'Refresh')}</button>} />;
  }
  if (!pipeline.link || pipeline.link.stale) {
    return (
      <EmptyBlock
        icon={<Link2 size={22} />}
        title={pipeline.link?.stale ? t('الوظيفة المربوطة لم تعد موجودة في Odoo', 'The linked Odoo job no longer exists') : t('لا توجد وظيفة Odoo مربوطة', 'No Odoo job is linked')}
        body={t('اربط الوظيفة بوظيفة Odoo لتظهر المراحل والمرشحون هنا.', 'Link this job to its Odoo job to see stages and candidates here.')}
        action={canLink ? <button type="button" className="btn-primary btn-sm mt-2" onClick={onLink}><Link2 size={14} />{t('ربط وظيفة Odoo', 'Link Odoo job')}</button> : undefined}
      />
    );
  }

  const link = pipeline.link;
  const funnel = pipeline.funnel;
  const stages = pipeline.stages ?? [];
  const max = Math.max(1, ...stages.map((stage) => stage.count));
  const funnelMax = Math.max(1, funnel?.received ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 truncate text-[14px] font-bold text-navy">{link.name}</p>
        {link.confirmed ? <Badge tone="success">{t('ربط مؤكد', 'Confirmed link')}</Badge> : <Badge tone="warning">{t('مطابقة تلقائية — تحتاج تأكيداً', 'Automatic match — confirm it')}</Badge>}
        {!link.active && <Badge tone="neutral">{t('مؤرشفة في Odoo', 'Archived in Odoo')}</Badge>}
        <span className="ms-auto flex items-center gap-2">
          {canLink && <button type="button" className="btn-ghost btn-sm !min-h-8" onClick={onLink}><Link2 size={14} />{link.confirmed ? t('تغيير', 'Change') : t('تأكيد الربط', 'Confirm link')}</button>}
          <button type="button" className="btn-quiet btn-sm !min-h-8" onClick={() => { invalidateHR('/hr/recruitment/requests'); onRefresh(); }} aria-label={t('تحديث من Odoo', 'Refresh from Odoo')}><RefreshCw size={14} /></button>
          {link.url && <a href={link.url} target="_blank" rel="noreferrer noopener" className="btn-ghost btn-sm !min-h-8"><ExternalLink size={14} />Odoo</a>}
        </span>
      </div>
      <p className="-mt-3 text-[12px] text-[#5A6C82]">
        {t(`${num(pipeline.total, lang)} مرشح منذ ${date(pipeline.since, lang)}`, `${num(pipeline.total, lang)} applicants since ${date(pipeline.since, lang)}`)}
        {link.allTimeApplicants !== null && link.allTimeApplicants !== undefined && <> · {t(`${num(link.allTimeApplicants, lang)} على الوظيفة منذ إنشائها`, `${num(link.allTimeApplicants, lang)} on the job all time`)}</>}
        {link.recruiter && <> · {t('المسؤول في Odoo:', 'Odoo recruiter:')} {link.recruiter}</>}
      </p>

      {funnel && (
        <section aria-label={t('دورة التوظيف', 'Recruitment funnel')}>
          <h4 className="mb-2 text-[12.5px] font-bold text-navy">{t('دورة التوظيف', 'Recruitment funnel')}</h4>
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {STEPS.map((step, index) => (
              <li key={step} className="rounded-xl border border-[#E6ECF3] bg-white p-3">
                <p className="text-[11px] font-semibold leading-4 text-[#5A6C82]"><span className="tabular-nums text-ink-faint">{index + 1}. </span>{pick(FUNNEL_LABEL[step])}</p>
                <p className="mt-1.5 text-[20px] font-bold tabular-nums text-navy">{num(funnel[step], lang)}</p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                  <motion.span className={cx('block h-full rounded-full', step === 'hired' ? 'bg-emerald-500' : 'bg-brand-500')} initial={false} animate={{ width: `${(funnel[step] / funnelMax) * 100}%` }} transition={motionPresets.ease} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {stages.length > 0 && (
        <section aria-label={t('مراحل Odoo', 'Odoo stages')}>
          <h4 className="mb-2 text-[12.5px] font-bold text-navy">{t('المراحل في Odoo', 'Odoo stages')}</h4>
          <ul className="space-y-2">
            {stages.map((stage) => (
              <li key={stage.stage} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-[12.5px]">
                <span className="truncate font-semibold text-[#3F5068]">{stageName(stage.stage, lang)}</span>
                <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <motion.span className={cx('block h-full rounded-full', stage.stage === 'Rejected' ? 'bg-slate-400' : 'bg-brand-500')} initial={false} animate={{ width: `${(stage.count / max) * 100}%` }} transition={motionPresets.ease} />
                </span>
                <span className="font-bold tabular-nums text-navy">{num(stage.count, lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(pipeline.candidates?.length ?? 0) > 0 && (
        <section aria-label={t('المرشحون', 'Candidates')}>
          <h4 className="mb-2 text-[12.5px] font-bold text-navy">{t('المرشحون في Odoo', 'Odoo candidates')}</h4>
          <div className="overflow-hidden rounded-xl border border-[#E6ECF3]">
            <ul className="max-h-[420px] divide-y divide-[#EEF2F7] overflow-y-auto">
              {pipeline.candidates!.map((candidate) => (
                <li key={candidate.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[12.5px]">
                  <div className="min-w-0 flex-1">
                    <p className={cx('truncate font-semibold', candidate.refused ? 'text-ink-faint line-through' : 'text-navy')}>{candidate.name}</p>
                    <p className="truncate text-[11.5px] text-ink-faint">
                      {stageName(candidate.stage, lang)} · {t('تقدّم', 'Applied')} {date(candidate.appliedOn, lang, 'short')}
                      {candidate.expectedSalary ? <> · {t('متوقع', 'Expects')} {money(candidate.expectedSalary, lang)}</> : null}
                      {candidate.refused && candidate.refuseReason ? <> · {candidate.refuseReason}</> : null}
                    </p>
                  </div>
                  {candidate.hiredOn && <Badge tone="success">{t('عُيّن', 'Hired')}</Badge>}
                  {candidate.url && <a href={candidate.url} target="_blank" rel="noreferrer noopener" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-navy" aria-label={t(`فتح ${candidate.name} في Odoo`, `Open ${candidate.name} in Odoo`)}><ExternalLink size={14} /></a>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
