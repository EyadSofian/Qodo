/**
 * One personnel case, opened from any list as `?case=<id>`: who it is about,
 * what is being done, whose move each checklist item is, the new-hire form,
 * and everything that has happened to it.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, ClipboardCopy, ExternalLink, KeyRound, Pencil, ShieldCheck } from 'lucide-react';
import { errorMessage } from '../../../lib/api';
import { cx } from '../../../lib/utils';
import { useWorkspace } from '../../../lib/workspace';
import { Spinner, useToast } from '../../../components/ui';
import { hrApi, hrMutate, useHRQuery } from '../api';
import { date, dateTime, money, num, useHRText } from '../format';
import { DOCUMENT_LABEL, OWNER_LABEL, PERSONNEL_STATUS_LABEL, PERSONNEL_TYPE_LABEL } from '../labels';
import type { PersonnelCase, PersonnelStatus } from '../types';
import { Drawer } from '../ui/Drawer';
import { Badge, KeyValue } from '../ui/primitives';
import { ErrorBlock, Skeleton } from '../ui/states';
import type { Tone } from '../ui/tones';
import { DETAIL_FIELDS, FORM_FIELD_LABEL, NEXT_STATUS, TIMELINE_LABEL, checklistProgress, formPending, type DetailField, type PersonnelList } from './model';

export const CASE_STATUS_TONE: Record<PersonnelStatus, Tone> = { open: 'info', in_progress: 'warning', done: 'success', cancelled: 'neutral' };

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-[#EEF2F7] py-4 first:border-t-0 first:pt-0">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-bold text-navy">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function detailValue(field: DetailField, value: unknown, lang: 'ar' | 'en', pick: (value: { ar: string; en: string }) => string) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return '—';
  if (field.kind === 'date') return date(String(value), lang);
  if (field.kind === 'number') return field.key.toLowerCase().includes('salary') ? money(Number(value), lang) : num(Number(value), lang, 1);
  if (field.kind === 'select') {
    const option = field.options?.find((entry) => entry.value === value);
    return option ? pick(option.label) : String(value);
  }
  if (field.kind === 'documents' && Array.isArray(value)) return value.map((key) => (DOCUMENT_LABEL[key] ? pick(DOCUMENT_LABEL[key]) : key)).join('، ');
  return String(value);
}

/** Fields of one type, as inputs. Shared with the new-case dialog. */
export function DetailInputs({ fields, values, onChange }: { fields: DetailField[]; values: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  const { t, pick } = useHRText();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((field) => {
        const value = values[field.key];
        if (field.kind === 'documents') {
          const chosen = new Set(Array.isArray(value) ? (value as string[]) : []);
          return (
            <fieldset key={field.key} className="sm:col-span-2">
              <legend className="label">{pick(field.label)}</legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {Object.entries(DOCUMENT_LABEL).map(([key, label]) => (
                  <label key={key} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-[12px] font-semibold', chosen.has(key) ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-[#E6ECF3] text-[#5A6C82]')}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#1D6FB8]"
                      checked={chosen.has(key)}
                      onChange={(event) => {
                        const next = new Set(chosen);
                        if (event.target.checked) next.add(key);
                        else next.delete(key);
                        onChange(field.key, [...next]);
                      }}
                    />
                    {pick(label)}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        const common = { id: `detail-${field.key}`, value: value === null || value === undefined ? '' : String(value) };
        return (
          <label key={field.key} className={cx('block', field.kind === 'textarea' && 'sm:col-span-2')}>
            <span className="label">{pick(field.label)}</span>
            {field.kind === 'textarea' ? (
              <textarea {...common} className="field min-h-[84px]" onChange={(event) => onChange(field.key, event.target.value)} />
            ) : field.kind === 'select' ? (
              <select {...common} className="field" onChange={(event) => onChange(field.key, event.target.value)}>
                <option value="">{t('— اختر —', '— Choose —')}</option>
                {field.options?.map((option) => <option key={option.value} value={option.value}>{pick(option.label)}</option>)}
              </select>
            ) : (
              <input {...common} className="field" type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'} min={field.kind === 'number' ? 0 : undefined} step={field.kind === 'number' ? 'any' : undefined} onChange={(event) => onChange(field.key, field.kind === 'number' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}

function FormLinkPanel({ item, canManage }: { item: PersonnelCase; canManage: boolean }) {
  const { t, lang } = useHRText();
  const { push } = useToast();
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCreated(null);
  }, [item.id]);
  const pending = formPending(item);
  const create = async () => {
    setBusy(true);
    try {
      const result = await hrMutate<{ url: string; expiresAt: string }>('post', `/hr/personnel/${encodeURIComponent(item.id)}/form`, {});
      setCreated({ url: `${window.location.origin}${result.url}`, expiresAt: result.expiresAt });
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      push(t('نُسخ الرابط.', 'Link copied.'));
    } catch {
      push(t('انسخ الرابط يدوياً من الحقل.', 'Copy the link from the field.'), 'bad');
    }
  };
  if (item.form?.submittedAt) {
    return <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[12.5px] font-semibold text-emerald-800"><Check size={15} aria-hidden="true" />{t(`أرسل الموظف الجديد بياناته ${dateTime(item.form.submittedAt, lang)}.`, `The new hire sent their details ${dateTime(item.form.submittedAt, lang)}.`)}</p>;
  }
  return (
    <div className="space-y-2.5">
      <p className="text-[12.5px] leading-6 text-[#5A6C82]">
        {t('رابط آمن يفتحه الموظف الجديد بدون حساب ليكتب بياناته الشخصية. يُعرض مرة واحدة فقط، ويعمل لإرسال واحد، وتنتهي صلاحيته بعد 14 يوماً.', 'A secure link the new hire opens without an account to enter their personal details. It is shown once, accepts one submission and expires after 14 days.')}
      </p>
      {created ? (
        <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50 p-3">
          <label className="block">
            <span className="label !text-brand-800">{t('الرابط — أرسله للموظف الجديد فقط', 'The link — send it to the new hire only')}</span>
            <input className="field ltr !bg-white font-mono !text-[12px]" readOnly value={created.url} onFocus={(event) => event.target.select()} />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11.5px] text-brand-800">{t(`ينتهي ${date(created.expiresAt, lang)}`, `Expires ${date(created.expiresAt, lang)}`)}</span>
            <button type="button" className="btn-primary btn-sm" onClick={() => void copy()}><ClipboardCopy size={15} />{t('نسخ الرابط', 'Copy link')}</button>
          </div>
        </div>
      ) : pending ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[12.5px] leading-6 text-amber-800">{t(`يوجد رابط نشط حتى ${date(item.form!.expiresAt, lang)} لم يُستخدم بعد. إنشاء رابط جديد يُبطل القديم.`, `A link is active until ${date(item.form!.expiresAt, lang)} and has not been used. A new link retires the old one.`)}</p>
      ) : null}
      {canManage && !created && (
        <button type="button" className="btn-ghost btn-sm" disabled={busy || item.status === 'cancelled'} onClick={() => void create()}>
          {busy ? <Spinner size={15} /> : <KeyRound size={15} />}
          {pending ? t('إنشاء رابط جديد', 'Create a new link') : t('إنشاء رابط النموذج', 'Create form link')}
        </button>
      )}
    </div>
  );
}

function CaseEditor({ item, onDone }: { item: PersonnelCase; onDone: () => void }) {
  const { t, lang } = useHRText();
  const { push } = useToast();
  const { directory } = useWorkspace();
  const [form, setForm] = useState({
    title: item.title,
    candidate: item.candidate?.name ?? '',
    jobTitle: item.jobTitle,
    department: item.department,
    location: item.location,
    managerUserId: item.managerUserId ?? '',
    assignedTo: item.assignedTo ?? '',
  });
  const [details, setDetails] = useState<Record<string, unknown>>({ ...item.details });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await hrMutate('patch', `/hr/personnel/${encodeURIComponent(item.id)}`, {
        title: form.title,
        jobTitle: form.jobTitle,
        department: form.department,
        location: form.location,
        managerUserId: form.managerUserId || null,
        assignedTo: form.assignedTo || null,
        ...(item.type === 'onboarding' ? { candidate: { name: form.candidate } } : {}),
        details,
      });
      push(t('حُفظ الطلب.', 'Case saved.'));
      onDone();
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setSaving(false);
    }
  };
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">{t('عنوان الطلب', 'Case title')}</span><input className="field" value={form.title} onChange={(event) => set('title')(event.target.value)} /></label>
        {item.type === 'onboarding' && <label className="block sm:col-span-2"><span className="label">{t('اسم الموظف الجديد', 'New hire name')}</span><input className="field" value={form.candidate} onChange={(event) => set('candidate')(event.target.value)} /></label>}
        <label className="block"><span className="label">{t('المسمى الوظيفي', 'Job title')}</span><input className="field" value={form.jobTitle} onChange={(event) => set('jobTitle')(event.target.value)} /></label>
        <label className="block"><span className="label">{t('القسم', 'Department')}</span><input className="field" value={form.department} onChange={(event) => set('department')(event.target.value)} /></label>
        <label className="block"><span className="label">{t('الموقع', 'Location')}</span><input className="field" value={form.location} onChange={(event) => set('location')(event.target.value)} /></label>
        <label className="block">
          <span className="label">{t('المدير المباشر', 'Direct manager')}</span>
          <select className="field" value={form.managerUserId} onChange={(event) => set('managerUserId')(event.target.value)}>
            <option value="">—</option>
            {directory.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="label">{t('مسؤول شئون العاملين', 'Personnel owner')}</span>
          <select className="field" value={form.assignedTo} onChange={(event) => set('assignedTo')(event.target.value)}>
            <option value="">—</option>
            {directory.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </label>
      </div>
      <DetailInputs fields={DETAIL_FIELDS[item.type]} values={details} onChange={(key, value) => setDetails((current) => ({ ...current, [key]: value }))} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={onDone}>{t('إلغاء', 'Cancel')}</button>
        <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={() => void save()}>{saving ? <Spinner size={15} /> : <Check size={15} />}{t('حفظ', 'Save')}</button>
      </div>
    </div>
  );
}

function CaseBody({ item, access }: { item: PersonnelCase; access: PersonnelList['access'] }) {
  const { t, lang, pick } = useHRText();
  const { push } = useToast();
  const { directory } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<PersonnelStatus | null>(null);
  const [comment, setComment] = useState('');
  const [notes, setNotes] = useState(item.notes);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setEditing(false);
    setConfirming(null);
    setComment('');
    setNotes(item.notes);
  }, [item.id, item.notes]);

  const nameOf = useMemo(() => {
    const names = new Map(directory.map((user) => [user.id, user.name]));
    return (id: string | null | undefined) => (id ? names.get(id) ?? t('حساب غير معروف', 'Unknown account') : '—');
  }, [directory, t]);

  const closed = item.status === 'done' || item.status === 'cancelled';
  const progress = checklistProgress(item);
  const canManage = item.canManage;

  const move = async (to: PersonnelStatus) => {
    setBusy(`status:${to}`);
    try {
      await hrMutate('patch', `/hr/personnel/${encodeURIComponent(item.id)}`, { status: to, comment: comment.trim() || undefined });
      setConfirming(null);
      setComment('');
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setBusy(null);
    }
  };
  const tick = async (entryId: string, done: boolean) => {
    setBusy(`tick:${entryId}`);
    try {
      await hrMutate('post', `/hr/personnel/${encodeURIComponent(item.id)}/checklist/${encodeURIComponent(entryId)}`, { done });
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setBusy(null);
    }
  };
  const saveNotes = async () => {
    setBusy('notes');
    try {
      await hrMutate('patch', `/hr/personnel/${encodeURIComponent(item.id)}`, { notes });
      push(t('حُفظت الملاحظات.', 'Notes saved.'));
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={CASE_STATUS_TONE[item.status]} dot>{pick(PERSONNEL_STATUS_LABEL[item.status])}</Badge>
        <Badge tone="neutral">{pick(PERSONNEL_TYPE_LABEL[item.type])}</Badge>
        {item.hireCount && item.hireCount > 1 && <Badge tone="info">{t(`موظف ${item.hireIndex} من ${item.hireCount}`, `Hire ${item.hireIndex} of ${item.hireCount}`)}</Badge>}
      </div>

      {canManage && (
        <div className="mb-4 rounded-xl bg-[#F6F8FB] p-3">
          {confirming ? (
            <div className="space-y-2">
              <label className="block">
                <span className="label">{t('ملاحظة على التغيير (اختياري)', 'A note on this change (optional)')}</span>
                <input className="field" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} autoFocus />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(null)}>{t('رجوع', 'Back')}</button>
                <button type="button" className={confirming === 'cancelled' ? 'btn-danger btn-sm' : 'btn-primary btn-sm'} disabled={Boolean(busy)} onClick={() => void move(confirming)}>
                  {busy ? <Spinner size={15} /> : null}
                  {pick(NEXT_STATUS[item.status].find((entry) => entry.to === confirming)?.label ?? { ar: 'تأكيد', en: 'Confirm' })}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {NEXT_STATUS[item.status].map((entry) => (
                <button
                  key={entry.to}
                  type="button"
                  className={entry.primary ? 'btn-primary btn-sm' : entry.to === 'cancelled' ? 'btn-quiet btn-sm !text-red-700' : 'btn-ghost btn-sm'}
                  disabled={Boolean(busy)}
                  onClick={() => (entry.to === 'cancelled' || entry.to === 'done' ? setConfirming(entry.to) : void move(entry.to))}
                >
                  {busy === `status:${entry.to}` ? <Spinner size={15} /> : null}
                  {pick(entry.label)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Block title={t('بيانات الطلب', 'Case details')} action={canManage && !closed && !editing ? <button type="button" className="btn-quiet btn-sm !min-h-8" onClick={() => setEditing(true)}><Pencil size={14} />{t('تعديل', 'Edit')}</button> : null}>
        {editing ? (
          <CaseEditor item={item} onDone={() => setEditing(false)} />
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {item.employeeCode && <KeyValue label={t('الموظف', 'Employee')} value={<Link className="text-brand-700 hover:underline" to={`/hr/people/${encodeURIComponent(item.employeeCode)}`}>{item.title || `#${item.employeeCode}`} <span className="font-mono text-[11.5px] text-ink-faint">#{item.employeeCode}</span></Link>} />}
            {item.type === 'onboarding' && <KeyValue label={t('الموظف الجديد', 'New hire')} value={item.candidate?.name || <span className="text-ink-faint">{t('يُستكمل من النموذج', 'Filled in by the form')}</span>} />}
            <KeyValue label={t('المسمى الوظيفي', 'Job title')} value={item.jobTitle} />
            <KeyValue label={t('القسم', 'Department')} value={item.department} />
            <KeyValue label={t('الموقع', 'Location')} value={item.location} />
            <KeyValue label={t('المدير المباشر', 'Direct manager')} value={item.managerUserId ? nameOf(item.managerUserId) : null} />
            <KeyValue label={t('مسؤول شئون العاملين', 'Personnel owner')} value={item.assignedTo ? nameOf(item.assignedTo) : null} />
            {item.recruitmentRequestId && <KeyValue label={t('طلب التوظيف', 'Recruitment request')} value={<Link className="inline-flex items-center gap-1 text-brand-700 hover:underline" to={`/hr/recruitment/requests/${encodeURIComponent(item.recruitmentRequestId)}`}>{item.recruitmentReference || t('فتح', 'Open')}<ExternalLink size={12} aria-hidden="true" /></Link>} />}
            {DETAIL_FIELDS[item.type].map((field) => <KeyValue key={field.key} label={pick(field.label)} value={detailValue(field, item.details?.[field.key], lang, pick)} />)}
            <KeyValue label={t('أُنشئ', 'Created')} value={dateTime(item.createdAt, lang)} />
          </dl>
        )}
      </Block>

      {item.checklist.length > 0 && (
        <Block title={t(`قائمة التنفيذ · ${progress.done}/${progress.total}`, `Checklist · ${progress.done}/${progress.total}`)}>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><span className={cx('block h-full rounded-full transition-[width] duration-300', progress.done === progress.total ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
          <ul className="space-y-1.5">
            {item.checklist.map((entry) => {
              const allowed = Boolean(item.canTick[entry.id]) && !closed;
              return (
                <li key={entry.id} className="flex items-start gap-3 rounded-xl border border-[#EEF2F7] px-3 py-2.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={entry.done}
                    aria-label={pick(entry)}
                    disabled={!allowed || busy === `tick:${entry.id}`}
                    onClick={() => void tick(entry.id, !entry.done)}
                    className={cx('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors', entry.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white', allowed ? 'hover:border-brand-400' : 'cursor-not-allowed opacity-60')}
                  >
                    {busy === `tick:${entry.id}` ? <Spinner size={12} /> : entry.done ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cx('text-[13px] font-semibold', entry.done ? 'text-[#5A6C82] line-through decoration-slate-300' : 'text-navy')}>{pick(entry)}</p>
                    {entry.done && entry.doneAt && <p className="text-[11.5px] text-ink-faint">{nameOf(entry.doneBy)} · {dateTime(entry.doneAt, lang)}</p>}
                  </div>
                  <Badge tone={entry.owner === 'it' ? 'info' : entry.owner === 'manager' ? 'warning' : 'neutral'}>{pick(OWNER_LABEL[entry.owner])}</Badge>
                </li>
              );
            })}
          </ul>
        </Block>
      )}

      {item.type === 'onboarding' && (
        <Block title={t('نموذج بيانات الموظف الجديد', 'New employee form')} action={<ShieldCheck size={16} className="text-brand-600" aria-hidden="true" />}>
          <FormLinkPanel item={item} canManage={canManage} />
        </Block>
      )}

      {item.formSubmission && (
        <Block title={t('البيانات المرسلة', 'Submitted details')}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {Object.entries(FORM_FIELD_LABEL).map(([key, label]) => <KeyValue key={key} label={pick(label)} value={<span className={key === 'nationalId' || key === 'mobile' || key === 'bankAccount' || key === 'personalEmail' || key === 'emergencyContactPhone' ? 'ltr' : undefined}>{item.formSubmission?.[key] || '—'}</span>} />)}
          </dl>
          {!access.payroll && item.formSubmission.bankAccount && <p className="mt-2 text-[11.5px] text-ink-faint">{t('رقم الحساب البنكي يظهر لصلاحية الرواتب فقط.', 'The bank account is shown to payroll only.')}</p>}
        </Block>
      )}

      <Block title={t('ملاحظات', 'Notes')}>
        {canManage ? (
          <div className="space-y-2">
            <textarea className="field min-h-[84px]" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} aria-label={t('ملاحظات', 'Notes')} />
            <div className="flex justify-end"><button type="button" className="btn-ghost btn-sm" disabled={busy === 'notes' || notes === item.notes} onClick={() => void saveNotes()}>{busy === 'notes' ? <Spinner size={15} /> : <Check size={15} />}{t('حفظ الملاحظات', 'Save notes')}</button></div>
          </div>
        ) : <p className="whitespace-pre-wrap text-[13px] leading-6 text-navy">{item.notes || '—'}</p>}
      </Block>

      <Block title={t('السجل', 'History')}>
        <ol className="relative space-y-3 border-s border-[#E6ECF3] ps-4">
          {[...item.timeline].reverse().map((event, index) => {
            const entry = event.type === 'checked' || event.type === 'unchecked' ? item.checklist.find((row) => row.en === event.note) : null;
            return (
              <li key={`${event.at}-${index}`} className="relative">
                <span className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-400" aria-hidden="true" />
                <p className="text-[12.5px] font-semibold text-navy">{pick(TIMELINE_LABEL[event.type] ?? { ar: event.type, en: event.type })}{entry ? ` — ${pick(entry)}` : ''}</p>
                <p className="text-[11.5px] text-ink-faint">{event.type === 'form_submitted' ? t('الموظف الجديد', 'The new hire') : event.actorId ? nameOf(event.actorId) : t('النظام', 'System')} · {dateTime(event.at, lang)}</p>
                {event.note && !entry && event.type.startsWith('status.') && <p className="mt-0.5 text-[12px] text-[#5A6C82]">{event.note}</p>}
              </li>
            );
          })}
        </ol>
      </Block>
    </div>
  );
}

export function CaseDrawer({ caseId, onClose }: { caseId: string | null; onClose: () => void }) {
  const { t, pick } = useHRText();
  const { data, error, loading, reload } = useHRQuery<{ case: PersonnelCase; access: PersonnelList['access'] }>(caseId ? hrApi.personnelCase(caseId) : null);
  const item = data?.case && data.case.id === caseId ? data.case : null;
  return (
    <Drawer
      open={Boolean(caseId)}
      onClose={onClose}
      width={580}
      title={item ? item.candidate?.name || item.title || pick(PERSONNEL_TYPE_LABEL[item.type]) : t('طلب شئون العاملين', 'Personnel case')}
      subtitle={item ? [pick(PERSONNEL_TYPE_LABEL[item.type]), item.jobTitle, item.department].filter(Boolean).join(' · ') : undefined}
    >
      {item && data ? <CaseBody item={item} access={data.access} /> : error ? <ErrorBlock error={error} onRetry={reload} /> : loading ? (
        <div className="space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-28" /><Skeleton className="h-40" /></div>
      ) : null}
    </Drawer>
  );
}
