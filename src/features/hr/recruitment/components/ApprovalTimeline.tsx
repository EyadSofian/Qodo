/**
 * Requested → Department review → Final approval → Hiring, as a timeline:
 * ✓ done with who and when, ● the step it is waiting on, ○ what is still ahead.
 */

import { Check, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { cx } from '../../../../lib/utils';
import { dateTime, useHRText } from '../../format';
import { DECISION_LABEL, STAGE_LABEL } from '../../labels';
import type { TimelineStep } from '../../types';
import { useMotion } from '../../ui/motion';

export function ApprovalTimeline({ steps, waitingFor }: { steps: TimelineStep[]; waitingFor?: Partial<Record<TimelineStep['stage'], string>> }) {
  const { t, lang, pick } = useHRText();
  const motionPresets = useMotion();
  return (
    <ol className="relative space-y-0">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const done = step.state === 'done';
        const rejected = step.state === 'rejected';
        const current = step.state === 'current';
        return (
          <li key={step.stage} className="relative flex gap-3.5 pb-5 last:pb-0">
            {!last && <span className={cx('absolute start-[13px] top-7 h-[calc(100%-1.25rem)] w-px', done ? 'bg-emerald-300' : 'bg-[#E1E8F0]')} aria-hidden="true" />}
            <span className="relative z-10 mt-0.5 grid h-7 w-7 shrink-0 place-items-center">
              {done ? (
                <motion.span initial={motionPresets.reduce ? false : { scale: 0.6 }} animate={{ scale: 1 }} transition={motionPresets.spring} className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-white">
                  <Check size={15} aria-hidden="true" />
                </motion.span>
              ) : rejected ? (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-red-500 text-white"><X size={15} aria-hidden="true" /></span>
              ) : current ? (
                <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-brand-500 bg-white">
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-500 motion-safe:animate-pulse" />
                </span>
              ) : (
                <span className="h-7 w-7 rounded-full border-2 border-[#D5DEE9] bg-white" />
              )}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cx('text-[13.5px] font-bold', done || current ? 'text-navy' : rejected ? 'text-red-700' : 'text-ink-faint')}>
                {pick(STAGE_LABEL[step.stage])}
                <span className="sr-only"> — {done ? t('تم', 'done') : current ? t('الحالي', 'current') : rejected ? t('مرفوض', 'rejected') : t('لاحقاً', 'upcoming')}</span>
              </p>
              {step.event && (done || rejected) ? (
                <p className="mt-0.5 text-[12px] text-[#5A6C82]">
                  {step.event.actorName || t('النظام', 'System')} · {dateTime(step.event.createdAt, lang)}
                  {step.event.decision && !['submitted', 'approved'].includes(step.event.decision) && <> · {pick(DECISION_LABEL[step.event.decision] ?? { ar: step.event.decision, en: step.event.decision })}</>}
                  {step.event.selfReviewed && <> · {t('راجعه صاحب الطلب بصفته مدير القسم', 'reviewed by the requester as department manager')}</>}
                </p>
              ) : current ? (
                <p className="mt-0.5 text-[12px] font-semibold text-brand-700">{waitingFor?.[step.stage] ?? t('بانتظار الإجراء', 'Waiting')}</p>
              ) : (
                <p className="mt-0.5 text-[12px] text-ink-faint">{step.stage === 'hiring' ? t('لم يبدأ بعد', 'Not started') : t('لاحقاً', 'Upcoming')}</p>
              )}
              {step.event?.comment && (done || rejected) && <p className="mt-1.5 rounded-lg bg-[#F6F8FB] px-2.5 py-1.5 text-[12px] leading-5 text-[#3F5068]">{step.event.comment}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
