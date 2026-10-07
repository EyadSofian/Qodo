/**
 * One recruiter: who they are, what needs attention, what they carry against
 * their limits, how the month is going, what Odoo publishes under their name
 * and how close the next reward is.
 *
 * The flags come first — overdue jobs and a broken or full limit are the
 * reason somebody opens this page — and the card wears a red or amber edge to
 * match. A highlight, never a shake. The whole card opens their jobs.
 */

import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, CircleCheck, Flag, Gift, Globe2, Hourglass, TimerOff, TriangleAlert } from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { num, shortName, useHRText } from '../../format';
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
  const rewardReady = card.reward.ready > 0;
  const Open = lang === 'en' ? ChevronRight : ChevronLeft;

  const flags = [
    card.overdue > 0 && { key: 'overdue', tone: 'critical' as const, icon: TimerOff, label: t(`${num(card.overdue, lang)} متأخرة`, `${num(card.overdue, lang)} overdue`) },
    over && { key: 'over', tone: 'critical' as const, icon: TriangleAlert, label: t('فوق الحد', 'Over limit') },
    full && { key: 'full', tone: 'warning' as const, icon: TriangleAlert, label: t('السعة ممتلئة', 'At limit') },
    workload.unclassified > 0 && { key: 'unclassified', tone: 'warning' as const, icon: Flag, label: t(`${num(workload.unclassified, lang)} بدون أولوية`, `${num(workload.unclassified, lang)} with no priority`) },
    card.pipeline > 0 && { key: 'pipeline', tone: 'info' as const, icon: Hourglass, label: t(`${num(card.pipeline, lang)} قيد الاعتماد`, `${num(card.pipeline, lang)} pending approval`) },
  ].filter(Boolean) as Array<{ key: string; tone: 'critical' | 'warning' | 'info'; icon: typeof TimerOff; label: string }>;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      animate={motionPresets.reduce ? undefined : { y: active ? -4 : 0 }}
      transition={motionPresets.spring}
      className={cx(
        'group relative flex h-full w-full flex-col overflow-hidden rounded-3xl border bg-white/90 p-4 text-start outline-none backdrop-blur transition-[box-shadow,border-color] duration-200 focus-visible:ring-2 focus-visible:ring-[rgb(var(--hr-a1)/0.5)]',
        active ? 'shadow-[0_22px_44px_-24px_rgb(var(--hr-a1)/0.65)]' : 'shadow-[0_1px_2px_rgba(11,37,69,0.05)] hover:shadow-[0_16px_32px_-22px_rgb(var(--hr-a1)/0.55)]',
        over || card.overdue > 0 ? 'border-red-300' : full ? 'border-amber-300' : 'border-white/90'
      )}
      aria-label={t(`فتح وظائف ${name}`, `Open ${name}'s jobs`)}
    >
      <span
        aria-hidden="true"
        className={cx('absolute inset-x-0 top-0 h-1.5', over || card.overdue > 0 ? 'bg-gradient-to-r from-red-500 to-rose-400' : full ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-[linear-gradient(90deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))]')}
      />

      <div className="mt-1.5 flex items-center gap-3">
        <PersonAvatar name={name} photoUrl={member.photoUrl} size={52} />
        <div className="min-w-0 flex-1">
          <p className="hr-bidi truncate text-[14.5px] font-bold text-navy" title={name}>{shortName(member.shortName, lang) || name}</p>
          <p className="hr-bidi truncate text-[12px] text-[#5A6C82]" title={member.title}>{member.title || t('فريق التوظيف', 'Recruitment team')}</p>
        </div>
      </div>

      <div className="mt-3 flex min-h-[1.625rem] flex-wrap items-center gap-1.5">
        {flags.length ? flags.map((flag) => (
          <span key={flag.key} className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold', TONE[flag.tone].bg, TONE[flag.tone].text, TONE[flag.tone].border)}>
            <flag.icon size={12} aria-hidden="true" />
            {flag.label}
          </span>
        )) : (
          <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold', TONE.success.bg, TONE.success.text, TONE.success.border)}>
            <CircleCheck size={12} aria-hidden="true" />
            {t('لا شيء متأخر', 'Nothing overdue')}
          </span>
        )}
      </div>

      <dl className="mt-3 space-y-2.5 border-t border-[#EEF2F7] pt-3.5">
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

      {card.odoo && (
        <div className="mt-3.5 flex items-center gap-2.5 rounded-2xl bg-violet-50 px-3 py-2.5 ring-1 ring-violet-100">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-600 text-white"><Globe2 size={14} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-violet-700">{t('منشور في Odoo', 'Published in Odoo')}</p>
            <p className="mt-0.5 truncate text-[12px] font-bold text-navy">{t(`${num(card.odoo.jobs, lang)} وظيفة · ${num(card.odoo.toRecruit, lang)} مقعد`, `${num(card.odoo.jobs, lang)} jobs · ${num(card.odoo.toRecruit, lang)} seats`)}</p>
          </div>
          {card.odoo.newApplications > 0 && <span className="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-bold text-white">{t(`${num(card.odoo.newApplications, lang)} جديد`, `${num(card.odoo.newApplications, lang)} new`)}</span>}
        </div>
      )}

      <div className={cx('mt-2.5 flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 ring-1', rewardReady ? 'bg-emerald-50 ring-emerald-200' : 'bg-[#F6F8FB] ring-transparent')}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white', rewardReady ? 'bg-emerald-600' : 'bg-slate-400')}><Gift size={14} aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className={cx('text-[11px] font-semibold', rewardReady ? 'text-emerald-700' : 'text-[#5A6C82]')}>{t('المكافأة', 'Reward')}</p>
            <p className="mt-0.5 truncate text-[12px] font-bold text-navy">
              {rewardReady
                ? t('دفعة مكافأة جاهزة', 'Reward batch ready')
                : t(`${card.reward.done} / ${card.reward.of} وظائف`, `${card.reward.done} / ${card.reward.of} jobs`)}
              {card.reward.category ? <span className="font-medium text-ink-faint"> · {pick(card.reward.category)}</span> : null}
            </p>
          </div>
        </div>
        <ProgressDots done={rewardReady ? card.reward.of : card.reward.done} of={card.reward.of} label={t(`${card.reward.done} من ${card.reward.of}`, `${card.reward.done} of ${card.reward.of}`)} />
      </div>

      <span className="mt-auto flex items-center justify-center gap-1 pt-3.5 text-[12px] font-bold text-[rgb(var(--hr-a1))]">
        {t('افتح الوظائف', 'Open jobs')}
        <Open size={14} className="transition-transform duration-200 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
      </span>
    </motion.button>
  );
}
