/**
 * /hr/recruitment/requests/new — asking for a hire, inside Qodo.
 *
 * Four steps — the position, why it is needed, how fast and by whom, then a
 * summary to check — and one submit. Nothing here starts a clock: the SLA
 * begins at final approval, and the review step says so.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Save, Send, ShieldAlert } from 'lucide-react';
import { DEPARTMENTS } from '@shared/departments';
import { ApiError, errorMessage } from '../../../../lib/api';
import { cx } from '../../../../lib/utils';
import { Spinner, useToast } from '../../../../components/ui';
import { errorPayload, hrApi, hrMutate, useHRQuery } from '../../api';
import { money, num, shortName, useHRText, workingDays } from '../../format';
import { LOCATION_LABEL, PRIORITY_LABEL, PRIORITY_ORDER, REASON_LABEL } from '../../labels';
import type { CapacityCheck, JobRequest, Priority, RecruitmentContext, RequestDetailData } from '../../types';
import { useMotion } from '../../ui/motion';
import { Card, PageHeader, PersonAvatar } from '../../ui/primitives';
import { ErrorBlock, PageSkeleton } from '../../ui/states';
import { PRIORITY_TONE, TONE } from '../../ui/tones';
import { CapacityWarning } from '../components/dialogs';

interface Form {
  title: string;
  department: string;
  departmentId: string;
  location: string;
  locationCode: 'EG' | 'KSA' | null;
  headcount: number;
  classification: string;
  reason: string;
  reasonNote: string;
  responsibilities: string;
  tasks: string;
  successIndicators: string;
  requirements: string;
  requirementChecks: { demo: boolean; technicalTest: boolean; offer: boolean };
  presentationRequirement: string;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  priority: Priority | null;
  targetWorkingDays: number | null;
  recruiterCode: string;
  interviewManager: string;
}

function Field({ label, required, hint, children, error }: { label: string; required?: boolean; hint?: string; children: ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="label">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] font-semibold text-red-700">{error}</span> : hint ? <span className="mt-1 block text-[11.5px] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

function RecruiterPicker({ context, priority, value, onChange }: { context: RecruitmentContext; priority: Priority | null; value: string; onChange: (code: string) => void }) {
  const { t, lang, pick } = useHRText();
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <button type="button" onClick={() => onChange('')} className={cx('rounded-xl border px-3 py-2.5 text-start text-[12.5px] font-semibold', !value ? 'border-brand-300 bg-brand-50/60 text-brand-700' : 'border-[#E6ECF3] text-[#5A6C82] hover:bg-surface-sunken')}>
        {t('يُسند لاحقاً', 'Assign later')}
      </button>
      {context.team.map((member) => (
        <RecruiterChoice key={member.employeeCode} code={member.employeeCode} name={shortName(member.shortName, lang)} title={member.title} photoUrl={member.photoUrl} priority={priority} selected={value === member.employeeCode} onSelect={() => onChange(member.employeeCode)} labelFor={(key) => pick(PRIORITY_LABEL[key])} />
      ))}
    </div>
  );
}

function RecruiterChoice({ code, name, title, photoUrl, priority, selected, onSelect, labelFor }: { code: string; name: string; title: string; photoUrl: string | null; priority: Priority | null; selected: boolean; onSelect: () => void; labelFor: (key: Priority) => string }) {
  const { t } = useHRText();
  const { data } = useHRQuery<{ capacity: CapacityCheck }>(priority ? hrApi.recruitment.capacityCheck(code, priority) : null);
  const check = data?.capacity;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={cx('flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-start transition-colors', selected ? 'border-brand-300 bg-brand-50/60' : 'border-[#E6ECF3] hover:bg-[#F7FAFD]')}>
      <PersonAvatar name={name} photoUrl={photoUrl} size={32} />
      <span className="min-w-0 flex-1">
        <span className="hr-bidi block truncate text-[12.5px] font-bold text-navy">{name}</span>
        <span className="hr-bidi block truncate text-[11px] text-ink-faint">{title}</span>
      </span>
      {check && priority && (
        <span className={cx('shrink-0 text-[11px] font-semibold', check.ok ? 'text-[#5A6C82]' : TONE.critical.text)}>
          {check.current[priority]}{check.limits[priority] !== null ? ` / ${check.limits[priority]}` : ''} {labelFor(priority)}
          {!check.ok && <span className="block">{t('ممتلئ', 'Full')}</span>}
        </span>
      )}
    </button>
  );
}

export function NewJobRequest() {
  const { t, lang, pick, dir } = useHRText();
  const navigate = useNavigate();
  const { push } = useToast();
  const motionPresets = useMotion();
  const { data, error, loading, reload } = useHRQuery<{ requests: JobRequest[]; context: RecruitmentContext }>(hrApi.recruitment.requests());
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [saving, setSaving] = useState(false);
  const [capacity, setCapacity] = useState<{ capacity: CapacityCheck; canOverride: boolean } | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [form, setForm] = useState<Form>({
    title: '',
    department: '',
    departmentId: '',
    location: 'EG',
    locationCode: 'EG',
    headcount: 1,
    classification: '',
    reason: 'new',
    reasonNote: '',
    responsibilities: '',
    tasks: '',
    successIndicators: '',
    requirements: '',
    requirementChecks: { demo: false, technicalTest: false, offer: false },
    presentationRequirement: '',
    salaryMin: '',
    salaryMax: '',
    currency: 'EGP',
    priority: null,
    targetWorkingDays: null,
    recruiterCode: '',
    interviewManager: '',
  });
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  const context = data?.context;
  const band = form.priority && context ? context.policy.bands[form.priority] : null;
  const canAssign = Boolean(context?.perms.assign);

  const problems = useMemo(() => {
    const list: Record<number, string[]> = { 0: [], 1: [], 2: [] };
    if (!form.title.trim()) list[0].push('title');
    if (!form.department.trim()) list[0].push('department');
    if (!form.location.trim()) list[0].push('location');
    if (!(form.headcount >= 1)) list[0].push('headcount');
    if (!form.classification) list[0].push('classification');
    if (!form.reason) list[1].push('reason');
    if (!form.responsibilities.trim()) list[1].push('responsibilities');
    if (!form.requirements.trim()) list[1].push('requirements');
    if (form.salaryMin && form.salaryMax && Number(form.salaryMax) < Number(form.salaryMin)) list[1].push('salary');
    if (!form.priority) list[2].push('priority');
    if (band && (form.targetWorkingDays === null || form.targetWorkingDays < band.min || form.targetWorkingDays > band.max)) list[2].push('target');
    return list;
  }, [form, band]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={1} />;
  if (!context) return null;

  const steps = [t('الوظيفة', 'Position'), t('الاحتياج', 'Business need'), t('خطة التوظيف', 'Hiring plan'), t('المراجعة', 'Review')];
  const go = (next: number) => {
    setTouched(true);
    if (next > step && (problems[step] ?? []).length) return;
    setTouched(false);
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };
  const err = (key: string, index: number) => (touched && problems[index]?.includes(key) ? t('مطلوب', 'Required') : undefined);

  const payload = (submit: boolean, override = false) => ({
    title: form.title,
    department: form.department,
    ...(form.departmentId ? { departmentId: form.departmentId } : {}),
    location: form.location,
    locationCode: form.locationCode,
    headcount: form.headcount,
    classification: form.classification || null,
    reason: form.reason,
    reasonNote: form.reasonNote,
    responsibilities: form.responsibilities,
    tasks: form.tasks,
    successIndicators: form.successIndicators,
    requirements: form.requirements,
    requirementChecks: form.requirementChecks,
    presentationRequirement: form.presentationRequirement,
    salaryRange: { min: form.salaryMin === '' ? null : Number(form.salaryMin), max: form.salaryMax === '' ? null : Number(form.salaryMax), currency: form.currency },
    priority: form.priority,
    targetWorkingDays: form.targetWorkingDays,
    interviewManager: { name: form.interviewManager },
    ...(canAssign && form.recruiterCode ? { recruiterCode: form.recruiterCode, override, overrideReason: override ? overrideReason : '' } : {}),
    submit,
  });

  const save = async (submit: boolean, override = false) => {
    setSaving(true);
    try {
      const result = await hrMutate<RequestDetailData>('post', '/hr/recruitment/requests', payload(submit, override));
      push(submit ? t('أُرسل الطلب للمراجعة.', 'Request submitted for review.') : t('حُفظت المسودة.', 'Draft saved.'));
      navigate(`/hr/recruitment/requests/${encodeURIComponent(result.request.id)}`, { replace: true });
    } catch (failure) {
      const detail = errorPayload<{ capacity?: CapacityCheck; canOverride?: boolean }>(failure);
      if (failure instanceof ApiError && failure.code === 'recruitment_capacity_exceeded' && detail?.capacity) {
        setCapacity({ capacity: detail.capacity, canOverride: Boolean(detail.canOverride) });
      } else {
        push(errorMessage(failure, lang), 'bad');
      }
    } finally {
      setSaving(false);
    }
  };

  const Next = dir === 'rtl' ? ArrowLeft : ArrowRight;
  const Prev = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const travel = (dir === 'rtl' ? -direction : direction) * 16;
  const classificationLabel = context.policy.classifications.find((item) => item.id === form.classification);
  const recruiter = context.team.find((member) => member.employeeCode === form.recruiterCode);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow={t('التوظيف', 'Recruitment')} title={t('طلب وظيفة جديد', 'New job request')} description={t('يُراجَع الطلب من مدير القسم ثم يُعتمد نهائياً، وعندها فقط يبدأ الـSLA.', 'The request is reviewed by the department manager, then approved — only then does the SLA start.')} />

      <ol className="grid grid-cols-4 gap-2" aria-label={t('خطوات الطلب', 'Request steps')}>
        {steps.map((label, index) => (
          <li key={label}>
            <button type="button" onClick={() => index < step && go(index)} disabled={index > step} className="w-full text-start" aria-current={index === step ? 'step' : undefined}>
              <span className={cx('block h-1 rounded-full transition-colors duration-300', index <= step ? 'bg-brand-500' : 'bg-slate-200')} />
              <span className={cx('mt-2 flex items-center gap-1.5 text-[12px] font-semibold', index === step ? 'text-navy' : index < step ? 'text-brand-600' : 'text-ink-faint')}>
                {index < step ? <Check size={13} aria-hidden="true" /> : <span className="tabular-nums">{index + 1}.</span>}
                <span className="truncate">{label}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <Card className="overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} initial={motionPresets.reduce ? { opacity: 0 } : { opacity: 0, x: travel }} animate={{ opacity: 1, x: 0 }} exit={motionPresets.reduce ? { opacity: 0 } : { opacity: 0, x: -travel, transition: { duration: 0.12 } }} transition={motionPresets.ease}>
            {step === 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2"><Field label={t('المسمى الوظيفي', 'Job title')} required error={err('title', 0)}><input className="field" value={form.title} onChange={(event) => set('title', event.target.value)} placeholder={t('مثال: Senior Mechanical Instructor', 'e.g. Senior Mechanical Instructor')} autoFocus /></Field></div>
                <Field label={t('القسم / الإدارة', 'Department')} required error={err('department', 0)}><input className="field" value={form.department} onChange={(event) => set('department', event.target.value)} placeholder={t('مثال: إدارة المدربين', 'e.g. Instructor Department')} /></Field>
                <Field label={t('قسم المراجعة في Qodo', 'Reviewing department in Qodo')} hint={t('مدير هذا القسم هو من يراجع الطلب.', "This department's manager reviews the request.")}>
                  <select className="field" value={form.departmentId} onChange={(event) => set('departmentId', event.target.value)}>
                    <option value="">{t('قسمي (افتراضي)', 'My department (default)')}</option>
                    {DEPARTMENTS.map((department) => <option key={department.id} value={department.id}>{lang === 'en' ? department.en : department.ar}</option>)}
                  </select>
                </Field>
                <Field label={t('الموقع', 'Location')} required error={err('location', 0)}>
                  <div className="flex gap-2">
                    {(['EG', 'KSA'] as const).map((code) => (
                      <button key={code} type="button" onClick={() => setForm((current) => ({ ...current, location: code, locationCode: code }))} className={cx('flex-1 rounded-xl border px-3 py-2.5 text-[13px] font-semibold', form.locationCode === code ? 'border-brand-300 bg-brand-50/60 text-brand-700' : 'border-[#E6ECF3] text-navy hover:bg-surface-sunken')}>{pick(LOCATION_LABEL[code])}</button>
                    ))}
                    <input className="field flex-1" value={form.locationCode ? '' : form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value, locationCode: null }))} placeholder={t('مكان آخر', 'Other')} aria-label={t('مكان آخر', 'Other location')} />
                  </div>
                </Field>
                <Field label={t('العدد المطلوب', 'Headcount')} required error={err('headcount', 0)}><input className="field" type="number" min={1} max={200} value={form.headcount} onChange={(event) => set('headcount', Number(event.target.value))} /></Field>
                <div className="sm:col-span-2">
                  <Field label={t('التصنيف', 'Classification')} required error={err('classification', 0)} hint={t('نوع الوظيفة — منفصل تماماً عن الأولوية.', 'The kind of role — separate from priority.')}>
                    <div className="flex flex-wrap gap-2">
                      {context.policy.classifications.filter((item) => item.active).map((item) => (
                        <button key={item.id} type="button" onClick={() => set('classification', item.id)} aria-pressed={form.classification === item.id} className={cx('rounded-xl border px-3.5 py-2 text-[13px] font-semibold', form.classification === item.id ? 'border-navy bg-navy text-white' : 'border-[#E6ECF3] text-navy hover:bg-surface-sunken')}>{pick(item)}</button>
                      ))}
                    </div>
                  </Field>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('سبب الاحتياج', 'Reason')} required error={err('reason', 1)}>
                  <select className="field" value={form.reason} onChange={(event) => set('reason', event.target.value)}>
                    {Object.entries(REASON_LABEL).map(([id, label]) => <option key={id} value={id}>{pick(label)}</option>)}
                  </select>
                </Field>
                <Field label={t('توضيح السبب', 'Reason note')}><input className="field" value={form.reasonNote} onChange={(event) => set('reasonNote', event.target.value)} /></Field>
                <div className="sm:col-span-2"><Field label={t('المسؤوليات', 'Responsibilities')} required error={err('responsibilities', 1)}><textarea className="field min-h-24" value={form.responsibilities} onChange={(event) => set('responsibilities', event.target.value)} /></Field></div>
                <div className="sm:col-span-2"><Field label={t('المهام', 'Tasks')}><textarea className="field min-h-20" value={form.tasks} onChange={(event) => set('tasks', event.target.value)} /></Field></div>
                <div className="sm:col-span-2"><Field label={t('مؤشرات النجاح (KPIs)', 'Success indicators (KPIs)')}><textarea className="field min-h-20" value={form.successIndicators} onChange={(event) => set('successIndicators', event.target.value)} /></Field></div>
                <Field label={t('الراتب من', 'Salary from')} error={touched && problems[1].includes('salary') ? t('الحد الأعلى أقل من الأدنى', 'Maximum is below minimum') : undefined}><input className="field ltr" type="number" min={0} value={form.salaryMin} onChange={(event) => set('salaryMin', event.target.value)} /></Field>
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  <Field label={t('إلى', 'To')}><input className="field ltr" type="number" min={0} value={form.salaryMax} onChange={(event) => set('salaryMax', event.target.value)} /></Field>
                  <Field label={t('العملة', 'Currency')}><select className="field" value={form.currency} onChange={(event) => set('currency', event.target.value)}>{['EGP', 'SAR', 'USD'].map((code) => <option key={code}>{code}</option>)}</select></Field>
                </div>
                <div className="sm:col-span-2"><Field label={t('المتطلبات', 'Requirements')} required error={err('requirements', 1)}><textarea className="field min-h-24" value={form.requirements} onChange={(event) => set('requirements', event.target.value)} /></Field></div>
                <fieldset className="sm:col-span-2">
                  <legend className="label">{t('متطلبات إلزامية للمرشح', 'Mandatory for the candidate')}</legend>
                  <div className="flex flex-wrap gap-4 text-[13px] font-semibold text-navy">
                    {([['demo', t('Demo', 'Demo')], ['technicalTest', t('اختبار فني', 'Technical test')], ['offer', t('عرض وظيفي مكتوب', 'Written offer')]] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form.requirementChecks[key]} onChange={(event) => set('requirementChecks', { ...form.requirementChecks, [key]: event.target.checked })} />{label}</label>
                    ))}
                  </div>
                </fieldset>
                <div className="sm:col-span-2">
                  <Field label={t('متطلب مظهر مهني خاص بالوظيفة (اختياري)', 'Role-specific professional presentation requirement (optional)')} hint={t('فقط إن كان مرتبطاً فعلاً بطبيعة الوظيفة (مثل تقديم محاضرات أمام العملاء). يُراجع يدوياً دائماً ولا يرتبط بأي صفة شخصية.', 'Only if genuinely tied to the role (e.g. presenting to clients). Always reviewed by a person and never tied to any personal attribute.')}>
                    <input className="field" value={form.presentationRequirement} onChange={(event) => set('presentationRequirement', event.target.value)} />
                  </Field>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <Field label={t('الأولوية', 'Priority')} required error={err('priority', 2)}>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup">
                    {PRIORITY_ORDER.map((key) => {
                      const keyBand = context.policy.bands[key];
                      const selected = form.priority === key;
                      return (
                        <button key={key} type="button" role="radio" aria-checked={selected} onClick={() => setForm((current) => ({ ...current, priority: key, targetWorkingDays: keyBand.default }))} className={cx('rounded-2xl border p-3.5 text-start transition-colors', selected ? `${TONE[PRIORITY_TONE[key]].border} ${TONE[PRIORITY_TONE[key]].bg}` : 'border-[#E6ECF3] hover:bg-surface-sunken')}>
                          <span className={cx('text-[14px] font-bold', selected ? TONE[PRIORITY_TONE[key]].text : 'text-navy')}>{pick(PRIORITY_LABEL[key])}</span>
                          <span className="mt-0.5 block text-[12px] text-[#5A6C82]">{keyBand.min === 1 ? t(`حتى ${keyBand.max} يوم عمل`, `Up to ${keyBand.max} working days`) : t(`${keyBand.min}–${keyBand.max} يوم عمل`, `${keyBand.min}–${keyBand.max} working days`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </Field>
                {band && (
                  <Field label={t(`مدة الـSLA المستهدفة (${band.min}–${band.max} يوم عمل)`, `Target SLA (${band.min}–${band.max} working days)`)} required error={err('target', 2)} hint={t('الجمعة والسبت لا يُحسبان. العدّ يبدأ من يوم الاعتماد النهائي.', 'Fridays and Saturdays never count. Counting starts at final approval.')}>
                    <div className="flex items-center gap-3">
                      <input type="range" min={band.min} max={band.max} value={form.targetWorkingDays ?? band.default} onChange={(event) => set('targetWorkingDays', Number(event.target.value))} className="flex-1 accent-brand-500" aria-label={t('المدة', 'Target')} />
                      <input className="field !w-24 text-center" type="number" min={band.min} max={band.max} value={form.targetWorkingDays ?? ''} onChange={(event) => set('targetWorkingDays', Number(event.target.value))} />
                    </div>
                  </Field>
                )}
                {canAssign ? (
                  <Field label={t('مسؤول التوظيف', 'Recruiter')} hint={t('يظهر حمل كل مسؤول من نفس الأولوية، وتُراجع السعة عند الإرسال.', "Each recruiter's load at this priority is shown; capacity is re-checked on submit.")}>
                    <RecruiterPicker context={context} priority={form.priority} value={form.recruiterCode} onChange={(code) => set('recruiterCode', code)} />
                  </Field>
                ) : (
                  <p className="rounded-xl bg-[#F6F8FB] px-3.5 py-2.5 text-[12.5px] text-[#5A6C82]">{t('يُسند فريق الموارد البشرية مسؤول التوظيف بعد الاعتماد.', 'HR assigns the recruiter after approval.')}</p>
                )}
                <Field label={t('مدير المقابلات', 'Interview manager')}><input className="field" value={form.interviewManager} onChange={(event) => set('interviewManager', event.target.value)} placeholder={t('من يجري المقابلة الفنية؟', 'Who runs the technical interview?')} /></Field>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                {capacity && <CapacityWarning capacity={capacity.capacity} canOverride={capacity.canOverride} reason={overrideReason} onReason={setOverrideReason} />}
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  {[
                    [t('الوظيفة', 'Job'), form.title],
                    [t('القسم', 'Department'), form.department],
                    [t('الموقع', 'Location'), form.locationCode ? pick(LOCATION_LABEL[form.locationCode]) : form.location],
                    [t('العدد', 'Headcount'), num(form.headcount, lang)],
                    [t('التصنيف', 'Classification'), classificationLabel ? pick(classificationLabel) : '—'],
                    [t('السبب', 'Reason'), pick(REASON_LABEL[form.reason] ?? { ar: form.reason, en: form.reason })],
                    [t('الأولوية', 'Priority'), form.priority ? pick(PRIORITY_LABEL[form.priority]) : '—'],
                    [t('مدة الـSLA', 'Target SLA'), form.targetWorkingDays ? workingDays(form.targetWorkingDays, lang) : '—'],
                    [t('نطاق الراتب', 'Salary range'), form.salaryMin || form.salaryMax ? `${money(form.salaryMin === '' ? null : Number(form.salaryMin), lang, form.currency)} – ${money(form.salaryMax === '' ? null : Number(form.salaryMax), lang, form.currency)}` : '—'],
                    [t('مسؤول التوظيف', 'Recruiter'), recruiter ? shortName(recruiter.shortName, lang) : t('يُسند لاحقاً', 'Assigned later')],
                    [t('مدير المقابلات', 'Interview manager'), form.interviewManager || '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0"><dt className="text-[11.5px] font-semibold text-[#5A6C82]">{label}</dt><dd className="mt-0.5 break-words text-[13.5px] font-semibold text-navy">{value}</dd></div>
                  ))}
                </dl>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-[#F6F8FB] p-3.5"><p className="text-[11.5px] font-semibold text-[#5A6C82]">{t('المسؤوليات', 'Responsibilities')}</p><p className="mt-1 whitespace-pre-line text-[12.5px] leading-6 text-navy">{form.responsibilities}</p></div>
                  <div className="rounded-xl bg-[#F6F8FB] p-3.5"><p className="text-[11.5px] font-semibold text-[#5A6C82]">{t('المتطلبات', 'Requirements')}</p><p className="mt-1 whitespace-pre-line text-[12.5px] leading-6 text-navy">{form.requirements}</p></div>
                </div>
                <p className="rounded-xl border border-brand-200 bg-brand-50/60 px-3.5 py-2.5 text-[12.5px] leading-6 text-brand-800">{t('بعد الإرسال: مراجعة مدير القسم ← الاعتماد النهائي ← بدء التوظيف. الـSLA يبدأ عند الاعتماد النهائي فقط.', 'After you submit: department review → final approval → hiring starts. The SLA begins at final approval only.')}</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {step > 0 && <button type="button" className="btn-ghost" onClick={() => go(step - 1)}><Prev size={16} />{t('السابق', 'Back')}</button>}
        <button type="button" className="btn-quiet" disabled={saving || !form.title.trim()} onClick={() => void save(false)}><Save size={16} />{t('حفظ كمسودة', 'Save draft')}</button>
        <span className="flex-1" />
        {step < 3 ? (
          <button type="button" className="btn-primary" onClick={() => go(step + 1)}>{t('التالي', 'Next')}<Next size={16} /></button>
        ) : capacity ? (
          capacity.canOverride ? <button type="button" className="btn-navy" disabled={saving || overrideReason.trim().length < 10} onClick={() => void save(true, true)}>{saving ? <Spinner size={16} /> : <ShieldAlert size={16} />}{t('إرسال رغم تجاوز السعة', 'Submit with override')}</button>
            : <button type="button" className="btn-ghost" onClick={() => { setCapacity(null); set('recruiterCode', ''); }}>{t('إرسال بدون مسؤول', 'Submit without a recruiter')}</button>
        ) : (
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void save(true)}>{saving ? <Spinner size={16} /> : <Send size={16} />}{t('إرسال الطلب', 'Submit request')}</button>
        )}
      </div>
    </div>
  );
}

export default NewJobRequest;
