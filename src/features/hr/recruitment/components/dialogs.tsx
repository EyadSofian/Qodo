/**
 * The recruitment actions that change a job. Each is its own small dialog
 * because each needs something different before it may happen — a reason, a
 * recruiter with room, a target inside the band — and the server re-checks
 * every one of them.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarPlus, Check, Link2, Search, ShieldAlert, Unlink } from 'lucide-react';
import { addWorkingDays } from '@shared/recruitment/sla';
import { ApiError, errorMessage } from '../../../../lib/api';
import { cx } from '../../../../lib/utils';
import { Modal, Spinner, useToast } from '../../../../components/ui';
import { errorPayload, hrApi, hrMutate, useHRQuery } from '../../api';
import { date, num, shortName, useHRText, workingDays } from '../../format';
import { PRIORITY_LABEL, PRIORITY_ORDER } from '../../labels';
import type { CapacityCheck, JobRequest, OdooOverview, Priority, RecruitmentContext, RequestDetailData, TeamMember } from '../../types';
import { PersonAvatar } from '../../ui/primitives';
import { PRIORITY_TONE, TONE } from '../../ui/tones';

type Done = (detail: RequestDetailData) => void;

function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return <span className="label">{children}{required && <span className="text-red-600"> *</span>}</span>;
}

/** The capacity picture a 409 carries, and — for those allowed — the override. */
export function CapacityWarning({ capacity, canOverride, reason, onReason }: { capacity: CapacityCheck; canOverride: boolean; reason: string; onReason: (value: string) => void }) {
  const { t, lang, pick } = useHRText();
  const name = shortName(capacity.recruiterName, lang) || `#${capacity.recruiterCode}`;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4" role="alert">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-amber-700"><AlertTriangle size={18} aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-navy">{t('تجاوز السعة', 'Capacity exceeded')}</p>
          <p className="mt-1 text-[12.5px] leading-6 text-[#5A6C82]">
            {t(`${name} يحمل حالياً:`, `${name} already owns:`)}
          </p>
          <ul className="mt-1 flex flex-wrap gap-2 text-[12.5px] font-semibold">
            {(['critical', 'required', 'planned'] as const).map((key) => (
              <li key={key} className={cx('rounded-lg bg-white px-2.5 py-1', capacity.exceeded.includes(key) ? TONE.critical.text : 'text-navy')}>
                {num(capacity.current[key], lang)}{capacity.limits[key] !== null ? ` / ${capacity.limits[key]}` : ''} {pick(PRIORITY_LABEL[key])}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {canOverride ? (
        <label className="mt-4 block">
          <Label required>{t('سبب تجاوز السعة (يُسجل في سجل التدقيق)', 'Reason to override (recorded in the audit log)')}</Label>
          <textarea className="field min-h-20" value={reason} onChange={(event) => onReason(event.target.value)} placeholder={t('لماذا يجب إسنادها رغم امتلاء السعة؟', 'Why must this go ahead despite the limit?')} />
        </label>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-amber-800"><ShieldAlert size={14} aria-hidden="true" />{t('تجاوز السعة يحتاج صلاحية مخصصة. اختر مسؤولاً آخر أو اطلب ذلك من صاحب الصلاحية.', 'Overriding needs a dedicated permission. Choose another recruiter or ask someone who holds it.')}</p>
      )}
    </div>
  );
}

function useSubmit() {
  const { push } = useToast();
  const { lang } = useHRText();
  const [saving, setSaving] = useState(false);
  const [capacity, setCapacity] = useState<{ capacity: CapacityCheck; canOverride: boolean } | null>(null);
  const run = async <T,>(work: () => Promise<T>, success?: string): Promise<T | null> => {
    setSaving(true);
    try {
      const result = await work();
      if (success) push(success);
      return result;
    } catch (error) {
      const payload = errorPayload<{ capacity?: CapacityCheck; canOverride?: boolean }>(error);
      if (error instanceof ApiError && error.code === 'recruitment_capacity_exceeded' && payload?.capacity) {
        setCapacity({ capacity: payload.capacity, canOverride: Boolean(payload.canOverride) });
      } else {
        push(errorMessage(error, lang), 'bad');
      }
      return null;
    } finally {
      setSaving(false);
    }
  };
  return { saving, capacity, setCapacity, run };
}

function DialogFooter({ saving, onClose, onConfirm, label, disabled, tone = 'primary' }: { saving: boolean; onClose: () => void; onConfirm: () => void; label: string; disabled?: boolean; tone?: 'primary' | 'danger' | 'navy' }) {
  const { t } = useHRText();
  return (
    <>
      <button type="button" className="btn-ghost" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
      <button type="button" className={tone === 'danger' ? 'btn-danger' : tone === 'navy' ? 'btn-navy' : 'btn-primary'} onClick={onConfirm} disabled={saving || disabled}>
        {saving ? <Spinner size={16} /> : <Check size={16} />}
        {label}
      </button>
    </>
  );
}

/* ── Assign ───────────────────────────────────────────────────── */

function MemberOption({ member, priority, requestId, selected, onSelect }: { member: TeamMember; priority: Priority | null; requestId: string; selected: boolean; onSelect: () => void }) {
  const { lang, t, pick } = useHRText();
  const { data } = useHRQuery<{ capacity: CapacityCheck }>(priority ? hrApi.recruitment.capacityCheck(member.employeeCode, priority, requestId) : null);
  const check = data?.capacity;
  const name = lang === 'en' ? member.nameEnglish || member.nameArabic : member.nameArabic || member.nameEnglish;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-start transition-colors', selected ? 'border-brand-300 bg-brand-50/60' : 'border-[#E6ECF3] hover:bg-[#F7FAFD]')}
    >
      <PersonAvatar name={name} photoUrl={member.photoUrl} size={36} />
      <span className="min-w-0 flex-1">
        <span className="hr-bidi block truncate text-[13px] font-bold text-navy">{shortName(member.shortName, lang)}</span>
        <span className="hr-bidi block truncate text-[11.5px] text-ink-faint">{member.title}</span>
      </span>
      {check && (
        <span className={cx('shrink-0 text-end text-[11.5px] font-semibold', check.ok ? 'text-[#5A6C82]' : TONE.critical.text)}>
          {priority && check.limits[priority] !== null
            ? `${check.current[priority]} / ${check.limits[priority]} ${pick(PRIORITY_LABEL[priority])}`
            : priority ? `${check.current[priority]} ${pick(PRIORITY_LABEL[priority])}` : ''}
          {!check.ok && <span className="block">{t('ممتلئ', 'Full')}</span>}
        </span>
      )}
      {selected && <Check size={16} className="shrink-0 text-brand-600" aria-hidden="true" />}
    </button>
  );
}

export function AssignDialog({ request, context, onClose, onDone }: { request: JobRequest; context: RecruitmentContext; onClose: () => void; onDone: Done }) {
  const { t } = useHRText();
  const [recruiterCode, setRecruiterCode] = useState<string | null>(request.recruiterCode);
  const [reason, setReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const { saving, capacity, setCapacity, run } = useSubmit();
  const submit = async (override = false) => {
    if (!recruiterCode) return;
    const result = await run(
      () => hrMutate<RequestDetailData>('post', `${hrApi.recruitment.request(request.id)}/assign`, { recruiterCode, reason, override, overrideReason: override ? overrideReason : '' }),
      t('تم الإسناد.', 'Recruiter assigned.')
    );
    if (result) onDone(result);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('إسناد مسؤول التوظيف', 'Assign a recruiter')}
      footer={capacity ? (
        <>
          <button type="button" className="btn-ghost" onClick={() => setCapacity(null)}>{t('اختيار مسؤول آخر', 'Choose someone else')}</button>
          {capacity.canOverride && <button type="button" className="btn-navy" disabled={saving || overrideReason.trim().length < 10} onClick={() => void submit(true)}>{saving ? <Spinner size={16} /> : <ShieldAlert size={16} />}{t('إسناد رغم ذلك', 'Assign anyway')}</button>}
        </>
      ) : (
        <DialogFooter saving={saving} onClose={onClose} onConfirm={() => void submit(false)} label={t('إسناد', 'Assign')} disabled={!recruiterCode || recruiterCode === request.recruiterCode} />
      )}
    >
      {capacity ? (
        <CapacityWarning capacity={capacity.capacity} canOverride={capacity.canOverride} reason={overrideReason} onReason={setOverrideReason} />
      ) : (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-6 text-[#5A6C82]">{t('يُعرض بجانب كل اسم حمله الحالي من نفس الأولوية. السعة تُراجع على الخادم قبل الحفظ.', 'Each name shows their current load at this priority. Capacity is re-checked on the server before saving.')}</p>
          <div className="space-y-2">
            {context.team.map((member) => (
              <MemberOption key={member.employeeCode} member={member} priority={request.priority} requestId={request.id} selected={recruiterCode === member.employeeCode} onSelect={() => setRecruiterCode(member.employeeCode)} />
            ))}
          </div>
          <label className="block">
            <Label>{t('ملاحظة الإسناد (اختياري)', 'Assignment note (optional)')}</Label>
            <input className="field" value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        </div>
      )}
    </Modal>
  );
}

/* ── Priority ─────────────────────────────────────────────────── */

export function PriorityDialog({ request, context, onClose, onDone }: { request: JobRequest; context: RecruitmentContext; onClose: () => void; onDone: Done }) {
  const { t, pick, lang } = useHRText();
  const [priority, setPriority] = useState<Priority>(request.priority ?? 'required');
  const band = context.policy.bands[priority];
  const [target, setTarget] = useState<number>(request.priority === priority && request.targetWorkingDays ? request.targetWorkingDays : band.default);
  const [reason, setReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const { saving, capacity, setCapacity, run } = useSubmit();
  const live = ['hiring', 'on_hold'].includes(request.status);
  useEffect(() => {
    const next = context.policy.bands[priority];
    setTarget((value) => (value >= next.min && value <= next.max ? value : next.default));
  }, [priority, context.policy.bands]);
  const submit = async (override = false) => {
    const result = await run(
      () => hrMutate<RequestDetailData>('post', `${hrApi.recruitment.request(request.id)}/priority`, { priority, targetWorkingDays: target, reason, override, overrideReason: override ? overrideReason : '' }),
      t('تم تحديث الأولوية.', 'Priority updated.')
    );
    if (result) onDone(result);
  };
  const newDue = live && request.sla?.startDate ? addWorkingDays(request.sla.startDate, target + (request.sla.extendedWorkingDays ?? 0) + (request.sla.pausedWorkingDays ?? 0), { weekend: context.policy.weekend }) : null;
  return (
    <Modal
      open
      onClose={onClose}
      title={t('تغيير الأولوية', 'Change priority')}
      footer={capacity ? (
        <>
          <button type="button" className="btn-ghost" onClick={() => setCapacity(null)}>{t('رجوع', 'Back')}</button>
          {capacity.canOverride && <button type="button" className="btn-navy" disabled={saving || overrideReason.trim().length < 10} onClick={() => void submit(true)}>{saving ? <Spinner size={16} /> : <ShieldAlert size={16} />}{t('تغيير رغم ذلك', 'Change anyway')}</button>}
        </>
      ) : (
        <DialogFooter saving={saving} onClose={onClose} onConfirm={() => void submit(false)} label={t('حفظ', 'Save')} disabled={live && reason.trim().length < 5} />
      )}
    >
      {capacity ? (
        <CapacityWarning capacity={capacity.capacity} canOverride={capacity.canOverride} reason={overrideReason} onReason={setOverrideReason} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('الأولوية', 'Priority')}>
            {PRIORITY_ORDER.map((key) => (
              <button key={key} type="button" role="radio" aria-checked={priority === key} onClick={() => setPriority(key)} className={cx('rounded-xl border px-3 py-2.5 text-[13px] font-bold transition-colors', priority === key ? `${TONE[PRIORITY_TONE[key]].border} ${TONE[PRIORITY_TONE[key]].bg} ${TONE[PRIORITY_TONE[key]].text}` : 'border-[#E6ECF3] text-navy hover:bg-surface-sunken')}>
                {pick(PRIORITY_LABEL[key])}
                <span className="mt-0.5 block text-[11px] font-semibold opacity-80">{context.policy.bands[key].min === context.policy.bands[key].max ? num(context.policy.bands[key].max, lang) : `${num(context.policy.bands[key].min, lang)}–${num(context.policy.bands[key].max, lang)}`} {t('يوم عمل', 'WD')}</span>
              </button>
            ))}
          </div>
          <label className="block">
            <Label required>{t(`مدة الـSLA (من ${band.min} إلى ${band.max} يوم عمل)`, `SLA target (${band.min}–${band.max} working days)`)}</Label>
            <input className="field" type="number" min={band.min} max={band.max} value={target} onChange={(event) => setTarget(Number(event.target.value))} />
          </label>
          {live && (
            <>
              {newDue && <p className="rounded-xl bg-[#F6F8FB] px-3 py-2 text-[12.5px] text-[#5A6C82]">{t('الموعد الجديد بعد التغيير:', 'New due date after the change:')} <b className="text-navy">{date(newDue, lang)}</b></p>}
              <label className="block">
                <Label required>{t('سبب التغيير', 'Reason for the change')}</Label>
                <textarea className="field min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
            </>
          )}
          {request.recruiterCode && <p className="text-[12px] text-ink-faint">{t('ستُراجع سعة المسؤول الحالي قبل الحفظ.', 'The current recruiter\'s capacity is re-checked before saving.')}</p>}
        </div>
      )}
    </Modal>
  );
}

/* ── Extend ───────────────────────────────────────────────────── */

export function ExtendDialog({ request, context, onClose, onDone }: { request: JobRequest; context: RecruitmentContext; onClose: () => void; onDone: Done }) {
  const { t, lang } = useHRText();
  const [days, setDays] = useState(5);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const { saving, run } = useSubmit();
  const sla = request.sla!;
  const snapshot = request.slaSnapshot;
  const newDue = useMemo(() => {
    if (!Number.isInteger(days) || days < 1) return null;
    return addWorkingDays(sla.startDate, (sla.targetWorkingDays ?? 0) + (sla.extendedWorkingDays ?? 0) + days + (snapshot.pausedWorkingDays ?? 0), { weekend: context.policy.weekend });
  }, [days, sla, snapshot.pausedWorkingDays, context.policy.weekend]);
  const submit = async () => {
    const result = await run(
      () => hrMutate<RequestDetailData>('post', `${hrApi.recruitment.request(request.id)}/extend`, { addWorkingDays: days, reason, note }),
      t('تم مد المهلة وحُفظ السجل.', 'Deadline extended and recorded.')
    );
    if (result) onDone(result);
  };
  return (
    <Modal open onClose={onClose} title={t('مد المهلة', 'Extend deadline')} footer={<DialogFooter saving={saving} onClose={onClose} onConfirm={() => void submit()} label={t('تأكيد المد', 'Confirm extension')} disabled={reason.trim().length < 5 || !newDue} tone="navy" />}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-[#F6F8FB] p-3">
            <dt className="text-[11.5px] font-semibold text-[#5A6C82]">{t('الموعد الأصلي', 'Original due date')}</dt>
            <dd className="mt-0.5 text-[14px] font-bold text-navy">{date(snapshot.originalDueDate, lang)}</dd>
          </div>
          <div className="rounded-xl bg-[#F6F8FB] p-3">
            <dt className="text-[11.5px] font-semibold text-[#5A6C82]">{t('الموعد الحالي', 'Current due date')}</dt>
            <dd className="mt-0.5 text-[14px] font-bold text-navy">{date(snapshot.dueDate, lang)}</dd>
          </div>
        </dl>
        <label className="block">
          <Label required>{t('أيام عمل مضافة', 'Add working days')}</Label>
          <input className="field" type="number" min={1} max={60} value={days} onChange={(event) => setDays(Number(event.target.value))} />
        </label>
        <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-3.5 py-3">
          <CalendarPlus size={18} className="text-brand-600" aria-hidden="true" />
          <div>
            <p className="text-[11.5px] font-semibold text-[#5A6C82]">{t('الموعد الجديد', 'New due date')}</p>
            <p className="text-[15px] font-bold text-navy">{newDue ? date(newDue, lang) : '—'}</p>
          </div>
          <span className="ms-auto text-[12px] font-semibold text-brand-700">+{workingDays(Number.isInteger(days) ? days : 0, lang)}</span>
        </div>
        <label className="block">
          <Label required>{t('السبب', 'Reason')}</Label>
          <textarea className="field min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <label className="block">
          <Label>{t('ملاحظة إضافية', 'Additional note')}</Label>
          <textarea className="field min-h-16" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <p className="text-[11.5px] leading-5 text-ink-faint">{t('المد لا يغيّر الموعد الأصلي ولا يُحذف — يُحفظ كسجل دائم باسمك.', 'An extension never changes the original date and is never deleted — it is kept as a permanent record in your name.')}</p>
      </div>
    </Modal>
  );
}

/* ── Review / final approval ──────────────────────────────────── */

export function DecisionDialog({ request, stage, onClose, onDone }: { request: JobRequest; stage: 'review' | 'approve'; onClose: () => void; onDone: Done }) {
  const { t } = useHRText();
  const [decision, setDecision] = useState<'approve' | 'return' | 'reject'>('approve');
  const [comment, setComment] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const { saving, capacity, setCapacity, run } = useSubmit();
  const needsReason = decision !== 'approve';
  const submit = async (override = false) => {
    const result = await run(
      () => hrMutate<RequestDetailData>('post', `${hrApi.recruitment.request(request.id)}/${stage}`, { decision, comment, override, overrideReason: override ? overrideReason : '' }),
      decision === 'approve' ? (stage === 'approve' ? t('اعتُمدت الوظيفة وبدأ الـSLA.', 'Approved — the SLA clock has started.') : t('تمت مراجعة القسم.', 'Department review recorded.')) : t('تم حفظ القرار.', 'Decision saved.')
    );
    if (result) onDone(result);
  };
  const options: Array<{ id: 'approve' | 'return' | 'reject'; label: string; tone: string }> = [
    { id: 'approve', label: stage === 'approve' ? t('اعتماد وبدء التوظيف', 'Approve & start hiring') : t('موافقة وتحويل للاعتماد', 'Approve & forward'), tone: 'success' },
    { id: 'return', label: t('إعادة للتعديل', 'Return for changes'), tone: 'warning' },
    { id: 'reject', label: t('رفض', 'Reject'), tone: 'critical' },
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title={stage === 'approve' ? t('الاعتماد النهائي', 'Final approval') : t('مراجعة القسم', 'Department review')}
      footer={capacity ? (
        <>
          <button type="button" className="btn-ghost" onClick={() => setCapacity(null)}>{t('رجوع', 'Back')}</button>
          {capacity.canOverride && <button type="button" className="btn-navy" disabled={saving || overrideReason.trim().length < 10} onClick={() => void submit(true)}>{saving ? <Spinner size={16} /> : <ShieldAlert size={16} />}{t('اعتماد رغم ذلك', 'Approve anyway')}</button>}
        </>
      ) : (
        <DialogFooter saving={saving} onClose={onClose} onConfirm={() => void submit(false)} label={t('حفظ القرار', 'Save decision')} disabled={needsReason && comment.trim().length < 3} tone={decision === 'reject' ? 'danger' : 'primary'} />
      )}
    >
      {capacity ? (
        <CapacityWarning capacity={capacity.capacity} canOverride={capacity.canOverride} reason={overrideReason} onReason={setOverrideReason} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('القرار', 'Decision')}>
            {options.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={decision === option.id} onClick={() => setDecision(option.id)} className={cx('rounded-xl border px-3 py-2.5 text-[12.5px] font-bold transition-colors', decision === option.id ? `${TONE[option.tone as 'success'].border} ${TONE[option.tone as 'success'].bg} ${TONE[option.tone as 'success'].text}` : 'border-[#E6ECF3] text-navy hover:bg-surface-sunken')}>
                {option.label}
              </button>
            ))}
          </div>
          {stage === 'approve' && decision === 'approve' && (
            <p className="rounded-xl bg-[#F6F8FB] px-3 py-2 text-[12.5px] leading-6 text-[#5A6C82]">{t(`الـSLA يبدأ اليوم: ${request.targetWorkingDays ?? '—'} يوم عمل.`, `The SLA starts today: ${request.targetWorkingDays ?? '—'} working days.`)}</p>
          )}
          <label className="block">
            <Label required={needsReason}>{t('التعليق', 'Comment')}</Label>
            <textarea className="field min-h-24" value={comment} onChange={(event) => setComment(event.target.value)} placeholder={needsReason ? t('اكتب السبب ليعرفه صاحب الطلب.', 'Write the reason so the requester knows.') : ''} />
          </label>
        </div>
      )}
    </Modal>
  );
}

/* ── Accepted candidates ──────────────────────────────────────── */

export function AcceptedDialog({ request, odooAccepted, onClose, onDone }: { request: JobRequest; odooAccepted: number | null; onClose: () => void; onDone: Done }) {
  const { t, lang } = useHRText();
  const [accepted, setAccepted] = useState(request.accepted);
  const [note, setNote] = useState('');
  const [completedAt, setCompletedAt] = useState('');
  const { saving, run } = useSubmit();
  const closing = request.headcount > 0 && accepted >= request.headcount;
  const submit = async () => {
    const result = await run(
      () => hrMutate<RequestDetailData>('post', `${hrApi.recruitment.request(request.id)}/accepted`, { accepted, note, completedAt: closing && completedAt ? completedAt : null }),
      closing ? t('اكتمل العدد وأُغلقت الوظيفة.', 'Headcount reached — the job is closed.') : t('تم تحديث العدد.', 'Count updated.')
    );
    if (result) onDone(result);
  };
  return (
    <Modal open onClose={onClose} title={t('تسجيل المرشحين المقبولين', 'Record accepted candidates')} footer={<DialogFooter saving={saving} onClose={onClose} onConfirm={() => void submit()} label={closing ? t('حفظ وإغلاق الوظيفة', 'Save & close job') : t('حفظ', 'Save')} disabled={accepted === request.accepted} />}>
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-4">
          <button type="button" className="btn-ghost h-11 w-11 !px-0 text-lg" onClick={() => setAccepted((value) => Math.max(0, value - 1))} aria-label={t('إنقاص', 'Decrease')}>−</button>
          <div className="text-center">
            <p className="text-[34px] font-bold tabular-nums text-navy">{num(accepted, lang)}<span className="text-[18px] text-ink-faint"> / {num(request.headcount, lang)}</span></p>
            <p className="text-[12px] text-[#5A6C82]">{t('مقبولون من العدد المطلوب', 'accepted of the headcount')}</p>
          </div>
          <button type="button" className="btn-ghost h-11 w-11 !px-0 text-lg" onClick={() => setAccepted((value) => Math.min(500, value + 1))} aria-label={t('زيادة', 'Increase')}>+</button>
        </div>
        {odooAccepted !== null && odooAccepted !== accepted && (
          <button type="button" className="w-full rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-2.5 text-start text-[12.5px] font-semibold text-brand-700" onClick={() => setAccepted(odooAccepted)}>
            {t(`Odoo يُظهر ${odooAccepted} مقبولين منذ بدء التوظيف — استخدم هذا الرقم`, `Odoo shows ${odooAccepted} accepted since hiring started — use this number`)}
          </button>
        )}
        {closing && (
          <label className="block">
            <Label>{t('تاريخ الإغلاق (اليوم إن تُرك فارغاً)', 'Completion date (today if left empty)')}</Label>
            <input className="field ltr" type="date" value={completedAt} min={request.sla?.startDate ?? undefined} onChange={(event) => setCompletedAt(event.target.value)} />
          </label>
        )}
        <label className="block">
          <Label>{t('ملاحظة', 'Note')}</Label>
          <input className="field" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {closing && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-700">{t('بالوصول للعدد المطلوب تُغلق الوظيفة تلقائياً، ويُحسب الـSLA، وتُفتح تهيئة الموظفين الجدد، وتُراجع المكافآت.', 'Reaching the headcount closes the job, settles its SLA, opens onboarding for the new hires and updates rewards.')}</p>}
      </div>
    </Modal>
  );
}

/* ── Odoo link ────────────────────────────────────────────────── */

export function OdooLinkDialog({ request, onClose, onDone }: { request: JobRequest; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useHRText();
  const { data, loading } = useHRQuery<OdooOverview>(hrApi.recruitment.odoo);
  const [query, setQuery] = useState('');
  const { saving, run } = useSubmit();
  const options = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return data.suggestions[request.id] ?? [];
    return data.jobOptions.filter((job) => `${job.name} ${job.department} ${job.jobId}`.toLowerCase().includes(needle)).slice(0, 30);
  }, [data, query, request.id]);
  const current = request.odooLink;
  const suggestion = data?.links[request.id];
  const save = async (jobId: number | null) => {
    const result = await run(() => hrMutate('put', `${hrApi.recruitment.request(request.id)}/odoo-link`, { jobId }), jobId === null ? t('فُك الربط.', 'Link removed.') : t('تم ربط وظيفة Odoo.', 'Odoo job linked.'));
    if (result !== null) onDone();
  };
  return (
    <Modal open onClose={onClose} title={t('ربط وظيفة Odoo', 'Link an Odoo job')} width="lg" footer={<button type="button" className="btn-primary" onClick={onClose}>{t('تم', 'Done')}</button>}>
      {loading && !data ? <div className="grid place-items-center py-10"><Spinner /></div> : !data?.configured ? (
        <p className="text-[13px] text-[#5A6C82]">{t('Odoo غير مُعد على هذا الخادم.', 'Odoo is not configured on this server.')}</p>
      ) : !data.connected ? (
        <p className="text-[13px] text-amber-700">{t('تعذّر الوصول إلى Odoo الآن. حاول بعد قليل.', 'Odoo is unreachable right now. Try again shortly.')}</p>
      ) : (
        <div className="space-y-3">
          {current ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-3">
              <Link2 size={16} className="text-emerald-700" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-navy">{current.name || `#${current.jobId}`}</p>
                <p className="text-[11.5px] text-[#5A6C82]">{t('ربط مؤكد', 'Confirmed link')} · #{current.jobId}</p>
              </div>
              <button type="button" className="btn-quiet btn-sm !min-h-8 text-red-700" disabled={saving} onClick={() => void save(null)}><Unlink size={14} />{t('فك الربط', 'Unlink')}</button>
            </div>
          ) : suggestion && !suggestion.stale && (
            <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-semibold text-brand-700">{t('مطابقة تلقائية مؤكدة الاسم — تحتاج تأكيدك', 'Confident automatic match — needs your confirmation')}</p>
                <p className="truncate text-[13px] font-bold text-navy">{suggestion.name} · #{suggestion.jobId}</p>
              </div>
              <button type="button" className="btn-primary btn-sm !min-h-8" disabled={saving} onClick={() => void save(suggestion.jobId)}>{t('تأكيد', 'Confirm')}</button>
            </div>
          )}
          <label className="block">
            <span className="sr-only">{t('ابحث في وظائف Odoo', 'Search Odoo jobs')}</span>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
              <input className="field ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('اسم الوظيفة أو رقمها في Odoo…', 'Job title or Odoo id…')} autoFocus />
            </div>
          </label>
          {!query && <p className="text-[11.5px] text-ink-faint">{t('الاقتراحات بالاسم فقط ولا تُحفظ إلا باختيارك.', 'Suggestions are by title only and are never saved without your choice.')}</p>}
          <ul className="max-h-[45dvh] space-y-1.5 overflow-y-auto">
            {options.map((job) => (
              <li key={job.jobId}>
                <button type="button" disabled={saving || current?.jobId === job.jobId} onClick={() => void save(job.jobId)} className="flex w-full items-center gap-3 rounded-xl border border-[#E6ECF3] px-3 py-2.5 text-start hover:border-brand-200 hover:bg-[#F7FAFD] disabled:opacity-60">
                  <span className="grid h-8 min-w-10 place-items-center rounded-lg bg-[#F2F5F9] px-1 text-[10.5px] font-bold text-brand-700">{job.jobId}</span>
                  <span className="min-w-0 flex-1">
                    <span className="hr-bidi block truncate text-[13px] font-semibold text-navy">{job.name}</span>
                    <span className="block text-[11px] text-ink-faint">{job.active ? t('نشطة', 'Active') : t('مؤرشفة', 'Archived')} · {job.applicantCount === null ? '—' : t(`${num(job.applicantCount, lang)} مرشح`, `${num(job.applicantCount, lang)} applicants`)}</span>
                  </span>
                </button>
              </li>
            ))}
            {!options.length && <li className="py-6 text-center text-[12.5px] text-ink-faint">{query ? t('لا توجد نتائج.', 'No results.') : t('لا توجد اقتراحات؛ ابحث بالاسم.', 'No suggestions — search by title.')}</li>}
          </ul>
        </div>
      )}
    </Modal>
  );
}

/* ── Comment-only actions ─────────────────────────────────────── */

export function CommentActionDialog({ request, action, onClose, onDone }: { request: JobRequest; action: 'submit' | 'hold' | 'resume' | 'cancel'; onClose: () => void; onDone: Done }) {
  const { t } = useHRText();
  const [comment, setComment] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const { saving, capacity, setCapacity, run } = useSubmit();
  const required = action === 'hold' || action === 'cancel';
  const labels = {
    submit: { title: t('إرسال الطلب', 'Submit request'), cta: t('إرسال', 'Submit'), done: t('أُرسل الطلب للمراجعة.', 'Request submitted for review.') },
    hold: { title: t('تعليق الوظيفة', 'Put on hold'), cta: t('تعليق', 'Hold'), done: t('عُلّقت الوظيفة وتوقف الـSLA.', 'Job held — the SLA clock is paused.') },
    resume: { title: t('استئناف التوظيف', 'Resume hiring'), cta: t('استئناف', 'Resume'), done: t('استُؤنف التوظيف.', 'Hiring resumed.') },
    cancel: { title: t('إلغاء الوظيفة', 'Cancel job'), cta: t('إلغاء الوظيفة', 'Cancel job'), done: t('أُلغيت الوظيفة.', 'Job cancelled.') },
  }[action];
  const submit = async (override = false) => {
    const result = await run(
      () => hrMutate<RequestDetailData>('post', `${hrApi.recruitment.request(request.id)}/${action}`, { comment, override, overrideReason: override ? overrideReason : '' }),
      labels.done
    );
    if (result) onDone(result);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={labels.title}
      footer={capacity ? (
        <>
          <button type="button" className="btn-ghost" onClick={() => setCapacity(null)}>{t('رجوع', 'Back')}</button>
          {capacity.canOverride && <button type="button" className="btn-navy" disabled={saving || overrideReason.trim().length < 10} onClick={() => void submit(true)}>{t('استئناف رغم ذلك', 'Resume anyway')}</button>}
        </>
      ) : (
        <DialogFooter saving={saving} onClose={onClose} onConfirm={() => void submit(false)} label={labels.cta} disabled={required && comment.trim().length < 3} tone={action === 'cancel' ? 'danger' : 'primary'} />
      )}
    >
      {capacity ? (
        <CapacityWarning capacity={capacity.capacity} canOverride={capacity.canOverride} reason={overrideReason} onReason={setOverrideReason} />
      ) : (
        <label className="block">
          <Label required={required}>{t('التعليق', 'Comment')}</Label>
          <textarea className="field min-h-24" value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
      )}
    </Modal>
  );
}
