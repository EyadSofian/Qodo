/**
 * Recruitment KPI pieces: the four-category bar, "Why this score?", and the
 * deduction form. Every point lost is shown with its rule, its reason, who
 * recorded it and when — a score nobody can explain is a score nobody trusts.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Ban, Bot, ClipboardList } from 'lucide-react';
import { errorMessage } from '../../../../lib/api';
import { cx } from '../../../../lib/utils';
import { Modal, Spinner, useToast } from '../../../../components/ui';
import { hrApi, hrMutate, idempotencyKey, useHRQuery } from '../../api';
import { date, num, useHRText } from '../../format';
import type { JobRequest, KpiCategoryResult, KpiDetailData, KpiEvent, KpiRule } from '../../types';
import { Drawer } from '../../ui/Drawer';
import { useMotion } from '../../ui/motion';
import { Badge } from '../../ui/primitives';
import { EmptyBlock, Skeleton } from '../../ui/states';

const CATEGORY_TONE: Record<string, string> = {
  hr_review: 'bg-brand-500',
  hiring_target: 'bg-navy',
  commitment: 'bg-brand-300',
  system_quality: 'bg-slate-400',
};

export function scoreTone(percent: number | null) {
  if (percent === null) return 'text-ink-faint';
  if (percent >= 85) return 'text-emerald-700';
  if (percent >= 70) return 'text-navy';
  if (percent >= 60) return 'text-amber-700';
  return 'text-red-700';
}

/** Four segments, each as wide as its weight, filled to its score. */
export function KPIBar({ categories }: { categories: Array<{ id: string; weight: number; score: number | null; measured: boolean }> }) {
  const motionPresets = useMotion();
  const total = categories.reduce((sum, category) => sum + category.weight, 0) || 100;
  return (
    <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
      {categories.map((category) => (
        <span key={category.id} className="relative h-full overflow-hidden rounded-full bg-slate-100" style={{ width: `${(category.weight / total) * 100}%` }}>
          {category.measured && (
            <motion.span className={cx('absolute inset-y-0 start-0 rounded-full', CATEGORY_TONE[category.id] ?? 'bg-brand-500')} initial={false} animate={{ width: `${Math.max(0, Math.min(100, ((category.score ?? 0) / category.weight) * 100))}%` }} transition={motionPresets.ease} />
          )}
        </span>
      ))}
    </div>
  );
}

function ruleText(rule: KpiEvent['rule'], pick: (value: { ar: string; en: string }) => string) {
  return typeof rule === 'string' ? rule : pick(rule);
}

function EventRow({ event, canReview, onVoid }: { event: KpiEvent; canReview: boolean; onVoid: (event: KpiEvent) => void }) {
  const { t, lang, pick } = useHRText();
  const voided = Boolean(event.voidedAt);
  return (
    <li className={cx('rounded-xl border px-3.5 py-3', voided ? 'border-dashed border-[#D5DEE9] bg-[#FAFBFC]' : 'border-[#E6ECF3] bg-white')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cx('text-[13px] font-bold', voided ? 'text-ink-faint line-through' : 'text-navy')}>{ruleText(event.rule, pick)}</p>
          {event.job && <Link to={`/hr/recruitment/requests/${encodeURIComponent(event.requestId ?? '')}`} className="text-[11.5px] font-semibold text-brand-600 hover:underline">{event.job.reference} · {event.job.title}</Link>}
        </div>
        <span className={cx('shrink-0 text-[14px] font-bold tabular-nums', voided ? 'text-ink-faint line-through' : 'text-red-700')}>−{num(event.deduction, lang, 1)}</span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-6 text-[#3F5068]">{event.reason}</p>
      {event.evidence && <p className="mt-1 break-words text-[11.5px] text-ink-faint">{t('الدليل:', 'Evidence:')} {event.evidence}</p>}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-faint">
        {event.source === 'automatic' ? <span className="inline-flex items-center gap-1"><Bot size={12} aria-hidden="true" />{t('فحص تلقائي', 'Automatic check')}</span> : <span>{event.reviewerName || '—'}</span>}
        <span>· {date(event.occurredOn, lang)}</span>
        {event.count > 1 && <span>· ×{event.count}</span>}
      </p>
      {voided ? (
        <p className="mt-1.5 text-[11.5px] font-semibold text-[#5A6C82]">{t('أُلغي:', 'Voided:')} {event.voidReason} · {event.voidedByName}</p>
      ) : canReview && (
        <button type="button" onClick={() => onVoid(event)} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#5A6C82] hover:text-red-700"><Ban size={12} aria-hidden="true" />{t('إلغاء الخصم', 'Void deduction')}</button>
      )}
    </li>
  );
}

function CategoryBlock({ category, canReview, onVoid }: { category: KpiCategoryResult; canReview: boolean; onVoid: (event: KpiEvent) => void }) {
  const { t, lang, pick } = useHRText();
  return (
    <section className="rounded-2xl border border-[#E6ECF3] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13.5px] font-bold text-navy">{pick(category)}</h3>
        <p className="text-[15px] font-bold tabular-nums text-navy">{category.measured ? num(category.score, lang, 1) : '—'}<span className="text-[12px] font-semibold text-ink-faint"> / {category.weight}</span></p>
      </div>
      {category.mode === 'computed' && category.detail ? (
        category.detail.measured ? (
          <div className="mt-3 space-y-3">
            <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[
                [t('أُسندت هذا الشهر', 'Assigned this month'), category.detail.assignedThisMonth],
                [t('قُيّمت هذا الشهر', 'Evaluated this month'), category.detail.evaluated],
                [t('أُغلقت في الموعد', 'Closed on time'), category.detail.completedOnTime],
                [t('لم تُغلق', 'Not completed'), category.detail.notCompleted],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl bg-[#F6F8FB] px-2 py-2"><dt className="text-[10.5px] font-semibold leading-4 text-[#5A6C82]">{label}</dt><dd className="mt-0.5 text-[16px] font-bold tabular-nums text-navy">{num(Number(value), lang)}</dd></div>
              ))}
            </dl>
            <p className="rounded-xl bg-brand-50/60 px-3 py-2 text-[12.5px] text-brand-800">
              {t(`${category.weight} × ${category.detail.completedOnTime} ÷ ${category.detail.evaluated} = ${num(category.score, lang, 1)}`, `${category.weight} × ${category.detail.completedOnTime} ÷ ${category.detail.evaluated} = ${num(category.score, lang, 1)}`)}
            </p>
            <ul className="space-y-1.5">
              {category.detail.jobs.map((job) => (
                <li key={job.requestId} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <Link to={`/hr/recruitment/requests/${encodeURIComponent(job.requestId)}`} className="min-w-0 truncate font-semibold text-navy hover:underline">{job.reference} · {job.title}</Link>
                  <Badge tone={job.onTime ? 'success' : 'critical'}>{job.outcome === 'completed_on_time' ? t('في الموعد', 'On time') : job.outcome === 'completed_late' ? t('بعد الموعد', 'Late') : t('لم تُغلق', 'Not closed')}</Badge>
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] leading-5 text-ink-faint">{t('تُقيَّم الوظيفة في الشهر الذي تحسم فيه نتيجتها: يوم إغلاقها، أو يوم استحقاقها إن لم تُغلق.', 'A job is judged in the month its outcome is decided: the day it closed, or the day it fell due if it did not.')}</p>
          </div>
        ) : <p className="mt-2 text-[12.5px] text-ink-faint">{t('لا توجد وظيفة حُسمت نتيجتها هذا الشهر — المحور غير محتسب بدلاً من صفر.', 'No job was decided this month — this category is left out rather than read as zero.')}</p>
      ) : category.events.length ? (
        <ul className="mt-3 space-y-2">{category.events.map((event) => <EventRow key={event.id} event={event} canReview={canReview} onVoid={onVoid} />)}</ul>
      ) : (
        <p className="mt-2 text-[12.5px] text-emerald-700">{t('لا خصومات — الدرجة كاملة.', 'No deductions — full marks.')}</p>
      )}
    </section>
  );
}

export function WhyScoreDrawer({ employeeCode, period, onClose, onRecord }: { employeeCode: string | null; period: string; onClose: () => void; onRecord?: () => void }) {
  const { t, lang } = useHRText();
  const { push } = useToast();
  const { data, loading, reload } = useHRQuery<KpiDetailData>(employeeCode ? hrApi.recruitment.kpiDetail(employeeCode, period) : null);
  const [voiding, setVoiding] = useState<KpiEvent | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const name = data?.member ? (lang === 'en' ? data.member.nameEnglish : data.member.nameArabic) : '';
  const confirmVoid = async () => {
    if (!voiding) return;
    setSaving(true);
    try {
      await hrMutate('post', `/hr/recruitment/kpi/events/${encodeURIComponent(voiding.id)}/void`, { reason });
      push(t('أُلغي الخصم وسُجل السبب.', 'Deduction voided and recorded.'));
      setVoiding(null);
      setReason('');
      void reload();
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer open={Boolean(employeeCode)} onClose={onClose} title={t('لماذا هذه النتيجة؟', 'Why this score?')} subtitle={name} width={600} footer={data?.canReview && onRecord ? <button type="button" className="btn-primary btn-sm" onClick={onRecord}><ClipboardList size={15} />{t('تسجيل خصم', 'Record deduction')}</button> : undefined}>
      {loading && !data ? <Skeleton className="h-64" /> : !data ? null : (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#F6F8FB] p-4">
            <p className="text-[12px] font-semibold text-[#5A6C82]">{t('النتيجة', 'Score')}</p>
            <p className={cx('mt-0.5 text-[30px] font-bold tabular-nums', scoreTone(data.kpi.percent))}>{data.kpi.percent === null ? '—' : `${num(data.kpi.percent, lang, 1)}%`}</p>
            <p className="text-[12px] text-[#5A6C82]">{t(`${num(data.kpi.score, lang, 1)} من ${num(data.kpi.measuredWeight, lang)} نقطة محتسبة`, `${num(data.kpi.score, lang, 1)} of ${num(data.kpi.measuredWeight, lang)} measured points`)}{!data.kpi.complete && <> · {t('محور غير محتسب', 'a category is unmeasured')}</>}</p>
            <div className="mt-3"><KPIBar categories={data.kpi.categories} /></div>
          </div>
          {data.kpi.categories.map((category) => <CategoryBlock key={category.id} category={category} canReview={data.canReview} onVoid={setVoiding} />)}
          {voiding && (
            <Modal open onClose={() => setVoiding(null)} title={t('إلغاء خصم', 'Void deduction')} footer={<><button type="button" className="btn-ghost" onClick={() => setVoiding(null)}>{t('رجوع', 'Back')}</button><button type="button" className="btn-danger" disabled={saving || reason.trim().length < 10} onClick={() => void confirmVoid()}>{saving ? <Spinner size={16} /> : <Ban size={16} />}{t('إلغاء الخصم', 'Void')}</button></>}>
              <p className="mb-3 text-[12.5px] leading-6 text-[#5A6C82]">{t('الخصم لا يُحذف — يبقى ظاهراً مع سبب الإلغاء واسمك.', 'The deduction is never deleted — it stays visible with the reason and your name.')}</p>
              <textarea className="field min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('لماذا هذا الخصم غير صحيح؟ (10 أحرف على الأقل)', 'Why is this deduction wrong? (at least 10 characters)')} />
            </Modal>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function DeductionDialog({ employeeCode, rules, onClose, onDone }: { employeeCode: string; rules: KpiRule[]; onClose: () => void; onDone: () => void }) {
  const { t, lang, pick } = useHRText();
  const { push } = useToast();
  const { data } = useHRQuery<{ requests: JobRequest[] }>(hrApi.recruitment.requests());
  const [ruleId, setRuleId] = useState('');
  const [requestId, setRequestId] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [occurredOn, setOccurredOn] = useState('');
  const [count, setCount] = useState(1);
  const [saving, setSaving] = useState(false);
  const [key] = useState(() => idempotencyKey());
  const rule = rules.find((item) => item.id === ruleId);
  const jobs = useMemo(() => (data?.requests ?? []).filter((request) => request.recruiterCode === employeeCode || request.supportRecruiterCodes.includes(employeeCode)), [data, employeeCode]);
  const minimum = rule?.minReasonLength ?? 10;
  const groups = (['hr_review', 'commitment', 'system_quality'] as const).map((category) => ({ category, rules: rules.filter((item) => item.category === category) }));
  const categoryLabel = { hr_review: t('جودة مراجعة الموارد البشرية (30)', 'HR Review Quality (30)'), commitment: t('الالتزام والانضباط (20)', 'Commitment & Discipline (20)'), system_quality: t('جودة النظام والإجراءات (20)', 'System & Process Quality (20)') };
  const submit = async () => {
    setSaving(true);
    try {
      await hrMutate('post', '/hr/recruitment/kpi/events', { employeeCode, rule: ruleId, requestId: requestId || null, reason, evidence, occurredOn: occurredOn || undefined, count, idempotencyKey: key });
      push(t('سُجل الخصم.', 'Deduction recorded.'));
      onDone();
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={t('تسجيل خصم مؤشر أداء', 'Record a KPI deduction')} width="lg" footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('إلغاء', 'Cancel')}</button><button type="button" className="btn-primary" disabled={saving || !rule || reason.trim().length < minimum || (rule.requiresJob && !requestId)} onClick={() => void submit()}>{saving ? <Spinner size={16} /> : null}{t('تسجيل', 'Record')}</button></>}>
      <div className="space-y-4">
        <label className="block">
          <span className="label">{t('القاعدة', 'Rule')} <span className="text-red-600">*</span></span>
          <select className="field" value={ruleId} onChange={(event) => setRuleId(event.target.value)}>
            <option value="">{t('اختر القاعدة…', 'Choose a rule…')}</option>
            {groups.map((group) => (
              <optgroup key={group.category} label={categoryLabel[group.category]}>
                {group.rules.map((item) => <option key={item.id} value={item.id}>{pick(item)} (−{item.points}){item.automatic ? ` · ${t('تلقائي عادةً', 'usually automatic')}` : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {rule?.humanReviewOnly && <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">{t('قاعدة مراجعة بشرية: يجب أن يكون السبب مرتبطاً بمتطلبات الوظيفة المكتوبة، دون أي إشارة لصفة شخصية.', 'Human-review rule: the reason must tie to the written job requirements and never to a personal attribute.')}</p>}
        {(rule?.requiresJob || jobs.length > 0) && (
          <label className="block">
            <span className="label">{t('الوظيفة', 'Job')}{rule?.requiresJob && <span className="text-red-600"> *</span>}</span>
            <select className="field" value={requestId} onChange={(event) => setRequestId(event.target.value)}>
              <option value="">{t('— بدون —', '— None —')}</option>
              {jobs.map((job) => <option key={job.id} value={job.id}>{job.reference} · {job.title}</option>)}
            </select>
          </label>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">{t('تاريخ الواقعة', 'Date')}</span><input className="field ltr" type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label>
          <label className="block"><span className="label">{t('عدد المرات', 'Occurrences')}</span><input className="field" type="number" min={1} max={5} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>
        </div>
        <label className="block">
          <span className="label">{t('السبب', 'Reason')} <span className="text-red-600">*</span></span>
          <textarea className="field min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} />
          <span className="mt-1 block text-[11.5px] text-ink-faint">{t(`${reason.trim().length} / ${minimum} حرف على الأقل`, `${reason.trim().length} / at least ${minimum} characters`)}</span>
        </label>
        <label className="block"><span className="label">{t('الدليل أو الملاحظة', 'Evidence or note')}</span><input className="field" value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder={t('رابط أو رقم مرشح في Odoo…', 'A link or an Odoo applicant id…')} /></label>
        {rule && <p className="text-[12px] text-[#5A6C82]">{t(`يخصم ${num(rule.points * count, lang)} نقطة داخل المحور فقط — لا يخصم وزن المحور كاملاً.`, `Deducts ${num(rule.points * count, lang)} points inside its category — never the whole category weight.`)}</p>}
      </div>
    </Modal>
  );
}

export function RuleList({ rules }: { rules: KpiRule[] }) {
  const { pick, t } = useHRText();
  if (!rules.length) return <EmptyBlock title={t('لا توجد قواعد مفعلة', 'No rules enabled')} />;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rules.map((rule) => (
        <li key={rule.id} className="flex items-center justify-between gap-2 rounded-xl border border-[#EEF2F7] px-3 py-2 text-[12.5px]">
          <span className="min-w-0 truncate text-navy">{pick(rule)}</span>
          <span className="flex shrink-0 items-center gap-1.5">{rule.automatic && <Bot size={13} className="text-ink-faint" aria-label={t('تلقائي', 'Automatic')} />}<span className="font-bold tabular-nums text-red-700">−{rule.points}</span></span>
        </li>
      ))}
    </ul>
  );
}
