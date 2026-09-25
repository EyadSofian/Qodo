/**
 * /hr/recruitment/rewards — every three qualifying jobs, one reward batch.
 *
 * Progress is shown per reward line (● ● ○), the jobs that do not qualify say
 * why, and a batch is approved inside the amount range of the rule version it
 * was priced under. Amounts live in Settings → Reward rules, never in code.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Gift, Settings2 } from 'lucide-react';
import { errorMessage } from '../../../../lib/api';
import { cx } from '../../../../lib/utils';
import { Modal, Spinner, useToast } from '../../../../components/ui';
import { hrApi, hrMutate, useHRQuery } from '../../api';
import { date, money, shortName, useHRText } from '../../format';
import { REWARD_REASON_LABEL } from '../../labels';
import type { RewardBatch, RewardsData } from '../../types';
import { useMotion } from '../../ui/motion';
import { Badge, Card, PageHeader, PersonAvatar, ProgressDots, SectionTitle } from '../../ui/primitives';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../../ui/states';

const BATCH_TONE = { ready: 'info', approved: 'success', paid: 'success', rejected: 'critical', cancelled: 'neutral' } as const;
const BATCH_LABEL = {
  ready: { ar: 'جاهزة للاعتماد', en: 'Ready for approval' },
  approved: { ar: 'معتمدة', en: 'Approved' },
  paid: { ar: 'مدفوعة', en: 'Paid' },
  rejected: { ar: 'مرفوضة', en: 'Rejected' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled' },
} as const;

function DecisionModal({ batch, decision, onClose, onDone }: { batch: RewardBatch; decision: 'approve' | 'reject' | 'pay' | 'cancel'; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useHRText();
  const { push } = useToast();
  const [amount, setAmount] = useState(String(batch.amountMax));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const needsNote = decision === 'reject' || decision === 'cancel';
  const numeric = Number(amount);
  const inRange = Number.isFinite(numeric) && numeric >= batch.amountMin && numeric <= batch.amountMax;
  const titles = { approve: t('اعتماد الدفعة', 'Approve batch'), reject: t('رفض الدفعة', 'Reject batch'), pay: t('تسجيل الدفع', 'Mark as paid'), cancel: t('إلغاء الدفعة', 'Cancel batch') };
  const submit = async () => {
    setSaving(true);
    try {
      await hrMutate('post', `/hr/recruitment/rewards/batches/${encodeURIComponent(batch.id)}/decision`, { decision, note, amountApproved: decision === 'approve' ? numeric : undefined });
      push(t('تم الحفظ.', 'Saved.'));
      onDone();
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={titles[decision]} footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('رجوع', 'Back')}</button><button type="button" className={decision === 'reject' || decision === 'cancel' ? 'btn-danger' : 'btn-primary'} disabled={saving || (needsNote && note.trim().length < 5) || (decision === 'approve' && !inRange)} onClick={() => void submit()}>{saving ? <Spinner size={16} /> : null}{titles[decision]}</button></>}>
      <div className="space-y-4">
        <ul className="space-y-1.5">
          {batch.jobs.map((job) => <li key={job.id} className="rounded-xl bg-[#F6F8FB] px-3 py-2 text-[12.5px]"><b className="text-navy">{job.reference}</b> · {job.title} · {date(job.completedAt, lang)}</li>)}
        </ul>
        {decision === 'approve' && (
          <label className="block">
            <span className="label">{t(`المبلغ المعتمد (${batch.amountMin}–${batch.amountMax} ${batch.currency})`, `Approved amount (${batch.amountMin}–${batch.amountMax} ${batch.currency})`)}</span>
            <input className="field" type="number" min={batch.amountMin} max={batch.amountMax} value={amount} onChange={(event) => setAmount(event.target.value)} />
            {!inRange && <span className="mt-1 block text-[12px] font-semibold text-red-700">{t('خارج نطاق القاعدة', 'Outside the rule\'s range')}</span>}
          </label>
        )}
        <label className="block">
          <span className="label">{t('ملاحظة', 'Note')}{needsNote && <span className="text-red-600"> *</span>}</span>
          <textarea className="field min-h-20" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

export function RecruitmentRewards() {
  const { t, lang, pick } = useHRText();
  const motionPresets = useMotion();
  const [params] = useSearchParams();
  const focus = params.get('recruiter');
  const { data, error, loading, reload } = useHRQuery<RewardsData>(hrApi.recruitment.rewards);
  const [deciding, setDeciding] = useState<{ batch: RewardBatch; decision: 'approve' | 'reject' | 'pay' | 'cancel' } | null>(null);

  useEffect(() => {
    if (!focus || !data) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`reward-${focus}`)?.scrollIntoView({ behavior: motionPresets.reduce ? 'auto' : 'smooth', block: 'center' });
    });
  }, [focus, data, motionPresets.reduce]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={2} />;
  if (!data) return null;
  const rules = data.rules;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('التوظيف', 'Recruitment')}
        title={t('المكافآت', 'Rewards')}
        description={t(`كل ${rules.jobsPerBatch} وظائف مؤهلة تكوّن دفعة مكافأة. الوظيفة تُحسب مرة واحدة فقط.`, `Every ${rules.jobsPerBatch} qualifying jobs form one reward batch. A job counts once.`)}
        actions={data.canEditRules ? <Link to="/hr/settings?section=rewards" className="btn-ghost btn-sm"><Settings2 size={15} />{t('قواعد المكافآت', 'Reward rules')}</Link> : undefined}
      />

      <Card>
        <SectionTitle title={t(`القاعدة الحالية — الإصدار ${rules.version}`, `Current rules — version ${rules.version}`)} hint={t('شروط الأهلية: مكتملة، داخل الـSLA، بلا خصم جودة، وليست ضمن دفعة أخرى.', 'Eligibility: completed, within SLA, no quality deduction, not already in a batch.')} />
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {rules.categories.map((category) => (
            <li key={category.id} className="rounded-xl border border-[#EEF2F7] px-3 py-2.5">
              <p className="text-[12px] font-semibold text-[#5A6C82]">{pick(category)}</p>
              <p className="mt-0.5 text-[15px] font-bold text-navy">{category.amountMin === category.amountMax ? money(category.amountMin, lang, rules.currency) : `${money(category.amountMin, lang, rules.currency)} – ${money(category.amountMax, lang, rules.currency)}`}</p>
            </li>
          ))}
        </ul>
      </Card>

      <section>
        <SectionTitle title={t('تقدم الفريق', 'Team progress')} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.recruiters.map((row) => {
            const name = shortName(row.member.shortName, lang);
            const ready = data.batches.filter((batch) => batch.employeeCode === row.member.employeeCode && batch.status === 'ready').length;
            return (
              <Card key={row.member.employeeCode} className={cx(focus === row.member.employeeCode && 'ring-2 ring-brand-300')}>
                <div id={`reward-${row.member.employeeCode}`} className="flex items-center gap-3">
                  <PersonAvatar name={name} photoUrl={row.member.photoUrl} size={42} />
                  <div className="min-w-0 flex-1"><p className="hr-bidi truncate text-[14px] font-bold text-navy">{name}</p><p className="hr-bidi truncate text-[12px] text-[#5A6C82]">{row.member.title}</p></div>
                </div>
                <AnimatePresence initial={false}>
                  {ready > 0 && (
                    <motion.p {...motionPresets.pop} className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[12.5px] font-bold text-emerald-700"><Gift size={15} aria-hidden="true" />{t('دفعة مكافأة جاهزة', 'Reward batch ready')}</motion.p>
                  )}
                </AnimatePresence>
                <ul className="mt-3 space-y-2">
                  {row.progress.length ? row.progress.map((pool) => (
                    <li key={pool.categoryId} className="rounded-xl bg-[#F6F8FB] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12.5px] font-semibold text-navy">{pool.category ? pick(pool.category) : t('مختلطة', 'Mixed')}</span>
                        <span className="flex items-center gap-2"><ProgressDots done={pool.done} of={pool.of} /><span className="text-[12px] font-bold tabular-nums text-navy">{pool.done} / {pool.of}</span></span>
                      </div>
                      {pool.jobs.length > 0 && <p className="mt-1 truncate text-[11.5px] text-ink-faint">{pool.jobs.map((job) => job.reference).join(' · ')}</p>}
                    </li>
                  )) : <li className="text-[12.5px] text-ink-faint">{t('لا توجد وظائف مؤهلة بعد.', 'No qualifying jobs yet.')}</li>}
                </ul>
                {row.ineligible.length > 0 && (
                  <details className="mt-3 text-[12px]">
                    <summary className="cursor-pointer font-semibold text-[#5A6C82]">{t(`${row.ineligible.length} وظيفة مكتملة لا تُحسب`, `${row.ineligible.length} completed jobs do not count`)}</summary>
                    <ul className="mt-2 space-y-1">
                      {row.ineligible.map((item) => <li key={item.requestId} className="text-[#5A6C82]"><b className="text-navy">{item.job?.reference}</b> · {item.reasons.map((reason) => pick(REWARD_REASON_LABEL[reason] ?? { ar: reason, en: reason })).join('، ')}</li>)}
                    </ul>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
        {!data.recruiters.length && <EmptyBlock title={t('لا يوجد فريق توظيف بعد', 'No recruitment team yet')} />}
      </section>

      <Card>
        <SectionTitle title={t('دفعات المكافآت', 'Reward batches')} />
        {data.batches.length ? (
          <ul className="space-y-2.5">
            {data.batches.map((batch) => {
              const name = batch.member ? shortName(batch.member.shortName, lang) : `#${batch.employeeCode}`;
              const category = rules.categories.find((item) => item.id === batch.categoryId);
              return (
                <li key={batch.id} className="rounded-2xl border border-[#E6ECF3] p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <PersonAvatar name={name} photoUrl={batch.member?.photoUrl} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-bold text-navy">{name} · {category ? pick(category) : batch.categoryId}</p>
                      <p className="text-[12px] text-[#5A6C82]">
                        {batch.amountApproved !== null ? money(batch.amountApproved, lang, batch.currency) : batch.amountMin === batch.amountMax ? money(batch.amountMin, lang, batch.currency) : `${money(batch.amountMin, lang, batch.currency)} – ${money(batch.amountMax, lang, batch.currency)}`}
                        {' · '}v{batch.ruleVersion} · {date(batch.createdAt, lang)}
                        {batch.approverName && <> · {t('اعتمدها', 'by')} {batch.approverName}</>}
                      </p>
                    </div>
                    <Badge tone={BATCH_TONE[batch.status]}>{pick(BATCH_LABEL[batch.status])}</Badge>
                  </div>
                  <p className="mt-2 text-[12px] text-ink-faint">{batch.jobs.map((job) => `${job.reference} ${job.title}`).join(' · ')}</p>
                  {batch.decisionNote && <p className="mt-1 text-[12px] text-[#3F5068]">{batch.decisionNote}</p>}
                  {data.canManage && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {batch.status === 'ready' && <button type="button" className="btn-primary btn-sm !min-h-8" onClick={() => setDeciding({ batch, decision: 'approve' })}>{t('اعتماد', 'Approve')}</button>}
                      {batch.status === 'ready' && <button type="button" className="btn-ghost btn-sm !min-h-8" onClick={() => setDeciding({ batch, decision: 'reject' })}>{t('رفض', 'Reject')}</button>}
                      {batch.status === 'approved' && <button type="button" className="btn-primary btn-sm !min-h-8" onClick={() => setDeciding({ batch, decision: 'pay' })}>{t('تسجيل الدفع', 'Mark paid')}</button>}
                      {(batch.status === 'ready' || batch.status === 'approved') && <button type="button" className="btn-quiet btn-sm !min-h-8" onClick={() => setDeciding({ batch, decision: 'cancel' })}>{t('إلغاء', 'Cancel')}</button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <EmptyBlock icon={<Gift size={24} />} title={t('لا توجد دفعات بعد', 'No batches yet')} body={t('تتكوّن الدفعة تلقائياً عند اكتمال العدد المطلوب من الوظائف المؤهلة.', 'A batch forms automatically when enough qualifying jobs close.')} />}
      </Card>

      {deciding && <DecisionModal batch={deciding.batch} decision={deciding.decision} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); void reload(); }} />}
    </div>
  );
}

export default RecruitmentRewards;
