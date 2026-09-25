/**
 * One recruiter: who they are, what they carry against their limits, how the
 * month is going, and how close the next reward is. The card lifts when it is
 * the focused slide, and wears an amber or red edge when a limit is full or
 * broken — a highlight, never a shake.
 */

import { motion } from 'framer-motion';
import { cx } from '../../../../lib/utils';
import { shortName, useHRText } from '../../format';
import { PRIORITY_LABEL } from '../../labels';
import type { RecruiterCardData } from '../../types';
import { useMotion } from '../../ui/motion';
import { AnimatedNumber, CapacityBar, PersonAvatar, ProgressDots } from '../../ui/primitives';
import { TONE } from '../../ui/tones';

export function RecruiterCard({ card, active = false, onOpen }: { card: RecruiterCardData; active?: boolean; onOpen?: () => void }) {
  const { t, lang, pick } = useHRText();
  const motionPresets = useMotion();
  const { member, workload, limits, level } = card;
  const name = lang === 'en' ? member.nameEnglish || member.nameArabic : member.nameArabic || member.nameEnglish;
  const over = level.critical === 'over' || level.required === 'over';
  const full = !over && (level.critical === 'full' || level.required === 'full');
  const levelTone = (key: 'critical' | 'required') => (level[key] === 'over' ? 'critical' : level[key] === 'full' ? 'warning' : key === 'critical' ? 'critical' : 'warning');

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      animate={motionPresets.reduce ? undefined : { y: active ? -4 : 0 }}
      transition={motionPresets.spring}
      className={cx(
        'flex h-full w-full flex-col rounded-2xl border bg-white p-4 text-start outline-none transition-[box-shadow,border-color] duration-200',
        active ? 'shadow-[0_18px_40px_-22px_rgba(11,37,69,0.45)]' : 'shadow-[0_1px_2px_rgba(11,37,69,0.04)] hover:shadow-[0_12px_28px_-20px_rgba(11,37,69,0.4)]',
        over ? 'border-red-300 ring-1 ring-red-100' : full ? 'border-amber-300 ring-1 ring-amber-100' : 'border-[#E6ECF3]'
      )}
      aria-label={t(`فتح أداء ${name}`, `Open ${name}'s workload`)}
    >
      <div className="flex items-center gap-3">
        <PersonAvatar name={name} photoUrl={member.photoUrl} size={52} />
        <div className="min-w-0 flex-1">
          <p className="hr-bidi truncate text-[14.5px] font-bold text-navy" title={name}>{shortName(member.shortName, lang) || name}</p>
          <p className="hr-bidi truncate text-[12px] text-[#5A6C82]" title={member.title}>{member.title || t('فريق التوظيف', 'Recruitment team')}</p>
        </div>
        {(over || full) && (
          <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold', over ? `${TONE.critical.bg} ${TONE.critical.text}` : `${TONE.warning.bg} ${TONE.warning.text}`)}>
            {over ? t('فوق الحد', 'Over limit') : t('ممتلئ', 'At limit')}
          </span>
        )}
      </div>

      <dl className="mt-4 space-y-2.5 border-t border-[#EEF2F7] pt-3.5">
        {(['critical', 'required'] as const).map((key) => (
          <div key={key} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2.5">
            <dt className="text-[12px] font-semibold text-[#5A6C82]">{pick(PRIORITY_LABEL[key])}</dt>
            <dd className="min-w-0"><CapacityBar count={workload[key]} limit={limits[key]} tone={levelTone(key)} /></dd>
            <dd className={cx('text-[12.5px] font-bold tabular-nums', level[key] === 'over' ? TONE.critical.text : level[key] === 'full' ? TONE.warning.text : 'text-navy')}>
              <AnimatedNumber value={workload[key]} /> / {limits[key] ?? '∞'}
            </dd>
          </div>
        ))}
        <div className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2.5">
          <dt className="text-[12px] font-semibold text-[#5A6C82]">{pick(PRIORITY_LABEL.planned)}</dt>
          <dd />
          <dd className="text-[12.5px] font-bold tabular-nums text-navy"><AnimatedNumber value={workload.planned} /></dd>
        </div>
      </dl>

      <dl className="mt-3.5 grid grid-cols-3 gap-2 border-t border-[#EEF2F7] pt-3.5 text-center">
        <div>
          <dt className="text-[10.5px] font-semibold leading-4 text-[#5A6C82]">{t('أُغلق هذا الشهر', 'Closed this month')}</dt>
          <dd className="mt-1 text-[16px] font-bold text-navy"><AnimatedNumber value={card.completedThisMonth} /></dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-semibold leading-4 text-[#5A6C82]">{t('نجاح الـSLA', 'SLA success')}</dt>
          <dd className="mt-1 text-[16px] font-bold text-navy">{card.slaSuccess.percent === null ? '—' : <AnimatedNumber value={card.slaSuccess.percent} suffix="%" />}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-semibold leading-4 text-[#5A6C82]">KPI</dt>
          <dd className="mt-1 text-[16px] font-bold text-navy">{card.kpi.percent === null ? '—' : <AnimatedNumber value={card.kpi.percent} suffix="%" />}</dd>
        </div>
      </dl>

      <div className="mt-3.5 flex items-center justify-between gap-2 rounded-xl bg-[#F6F8FB] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[#5A6C82]">{t('تقدم المكافأة', 'Reward progress')}</p>
          <p className="mt-0.5 truncate text-[12px] font-bold text-navy">
            {card.reward.ready > 0
              ? t('دفعة مكافأة جاهزة', 'Reward batch ready')
              : t(`${card.reward.done} / ${card.reward.of} وظائف`, `${card.reward.done} / ${card.reward.of} jobs`)}
            {card.reward.category ? <span className="font-medium text-ink-faint"> · {pick(card.reward.category)}</span> : null}
          </p>
        </div>
        <ProgressDots done={card.reward.ready > 0 ? card.reward.of : card.reward.done} of={card.reward.of} label={t(`${card.reward.done} من ${card.reward.of}`, `${card.reward.done} of ${card.reward.of}`)} />
      </div>
      {card.overdue > 0 && (
        <p className={cx('mt-2.5 text-[11.5px] font-semibold', TONE.critical.text)}>{t(`${card.overdue} وظيفة متأخرة`, `${card.overdue} overdue`)}</p>
      )}
    </motion.button>
  );
}
