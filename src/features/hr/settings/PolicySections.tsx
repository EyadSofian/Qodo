/**
 * The recruitment policy HR can tune without a deploy: SLA bands and the
 * working calendar, classifications, capacity, the recruitment team, the Odoo
 * funnel, and the personnel checklists and review criteria.
 */

import { useState } from 'react';
import { Plus, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { date, useHRText } from '../format';
import { FUNNEL_LABEL, OWNER_LABEL, PRIORITY_LABEL, PRIORITY_ORDER, TEAM_REASON_LABEL, WEEKDAY_LABEL } from '../labels';
import type { ChecklistDefinition, Classification, HRSettings, ReviewCriterion, SettingsView } from '../types';
import { Badge, PersonAvatar } from '../ui/primitives';
import { NumberInput, SaveBar, SettingsCard, Toggle, newId, useDraft, useSettingsSave } from './common';

type Recruitment = HRSettings['recruitment'];

export function SlaSection({ view }: { view: SettingsView }) {
  const { t, pick, lang } = useHRText();
  const source = view.settings.recruitment;
  const slice = { calendar: source.calendar, sla: source.sla, waits: source.waits, approvals: source.approvals ?? { finalApproverUserId: null } };
  const { draft, setDraft, dirty, reset } = useDraft(slice, view.revision);
  const { save, saving } = useSettingsSave(view);
  const [holiday, setHoliday] = useState('');
  const disabled = !view.canEdit;
  const bandProblem = PRIORITY_ORDER.find((priority) => {
    const band = draft.sla.bands[priority];
    return !(band.min >= 1 && band.min <= band.default && band.default <= band.max && band.max <= 365);
  });
  const problem = bandProblem ? t(`نطاق "${PRIORITY_LABEL[bandProblem].ar}" غير صحيح: الأدنى ≤ الافتراضي ≤ الأعلى.`, `The "${PRIORITY_LABEL[bandProblem].en}" band is invalid: min ≤ default ≤ max.`) : draft.calendar.weekend.length > 5 ? t('اترك يومي عمل على الأقل.', 'Leave at least two working days.') : null;
  const setBand = (priority: keyof typeof draft.sla.bands, key: 'min' | 'default' | 'max', value: number | null) => setDraft((current) => ({ ...current, sla: { ...current.sla, bands: { ...current.sla.bands, [priority]: { ...current.sla.bands[priority], [key]: value ?? 0 } } } }));
  const toggleWeekend = (day: number) => setDraft((current) => ({ ...current, calendar: { ...current.calendar, weekend: current.calendar.weekend.includes(day) ? current.calendar.weekend.filter((item) => item !== day) : [...current.calendar.weekend, day].sort() } }));

  return (
    <div className="space-y-5">
      <SettingsCard title={t('نطاقات الـSLA بأيام العمل', 'SLA bands in working days')} hint={t('الساعة تبدأ عند الاعتماد النهائي فقط. يوم الاعتماد هو اليوم صفر.', 'The clock starts only at final approval. The approval day is day zero.')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[17rem] text-[13px]">
            <thead><tr className="text-[11.5px] text-[#5A6C82]"><th className="py-2 text-start font-semibold">{t('الأولوية', 'Priority')}</th><th className="py-2 font-semibold">{t('الأدنى', 'Min')}</th><th className="py-2 font-semibold">{t('الافتراضي', 'Default')}</th><th className="py-2 font-semibold">{t('الأعلى', 'Max')}</th></tr></thead>
            <tbody className="divide-y divide-[#EEF2F7]">
              {PRIORITY_ORDER.map((priority) => (
                <tr key={priority}>
                  <td className="py-2.5 font-semibold text-navy">{pick(PRIORITY_LABEL[priority])}</td>
                  {(['min', 'default', 'max'] as const).map((key) => <td key={key} className="py-2.5 text-center"><NumberInput value={draft.sla.bands[priority][key]} min={1} max={365} disabled={disabled} label={`${pick(PRIORITY_LABEL[priority])} ${key}`} onChange={(value) => setBand(priority, key, value)} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#EEF2F7] px-3.5 py-3">
            <span className="text-[13px] font-semibold text-navy">{t('"قريبة الاستحقاق" قبل', '"Due soon" within')}</span>
            <NumberInput value={draft.sla.dueSoonWorkingDays} min={0} max={30} disabled={disabled} label={t('أيام قريبة الاستحقاق', 'Due soon days')} suffix={t('يوم عمل', 'WD')} onChange={(value) => setDraft((current) => ({ ...current, sla: { ...current.sla, dueSoonWorkingDays: value ?? 0 } }))} />
          </div>
          <Toggle checked={draft.sla.holdPausesClock} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, sla: { ...current.sla, holdPausesClock: value } }))} label={t('التعليق يوقف الساعة', 'Hold pauses the clock')} hint={t('أيام التعليق لا تُحسب على المسؤول.', 'Days on hold do not count against the recruiter.')} />
        </div>
      </SettingsCard>

      <SettingsCard title={t('أيام العمل والإجازات', 'Working days & holidays')} hint={t('الجمعة والسبت عطلة افتراضياً. الإجازات الرسمية لا تُحسب أيام عمل.', 'Friday and Saturday are the default weekend. Public holidays never count as working days.')}>
        <fieldset>
          <legend className="label">{t('العطلة الأسبوعية', 'Weekend')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABEL.map((label, day) => (
              <button key={day} type="button" disabled={disabled} aria-pressed={draft.calendar.weekend.includes(day)} onClick={() => toggleWeekend(day)} className={cx('rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors', draft.calendar.weekend.includes(day) ? 'border-navy bg-navy text-white' : 'border-[#E6ECF3] bg-white text-[#5A6C82] hover:text-navy')}>{pick(label)}</button>
            ))}
          </div>
        </fieldset>
        <div className="mt-4">
          <span className="label">{t('الإجازات الرسمية', 'Public holidays')}</span>
          <div className="flex flex-wrap gap-1.5">
            {draft.calendar.holidays.length ? [...draft.calendar.holidays].sort().map((day) => (
              <span key={day} className="inline-flex items-center gap-1 rounded-full bg-[#F1F5FA] px-2.5 py-1 text-[12px] font-semibold text-navy">
                {date(day, lang)}
                {!disabled && <button type="button" className="text-ink-faint hover:text-red-600" onClick={() => setDraft((current) => ({ ...current, calendar: { ...current.calendar, holidays: current.calendar.holidays.filter((item) => item !== day) } }))} aria-label={t(`حذف ${day}`, `Remove ${day}`)}>✕</button>}
              </span>
            )) : <span className="text-[12.5px] text-ink-faint">{t('لا توجد إجازات مسجلة.', 'No holidays recorded.')}</span>}
          </div>
          {!disabled && (
            <div className="mt-2 flex gap-2">
              <input type="date" className="field !w-48 !py-2" value={holiday} onChange={(event) => setHoliday(event.target.value)} aria-label={t('تاريخ الإجازة', 'Holiday date')} />
              <button type="button" className="btn-ghost btn-sm" disabled={!holiday || draft.calendar.holidays.includes(holiday)} onClick={() => { setDraft((current) => ({ ...current, calendar: { ...current.calendar, holidays: [...current.calendar.holidays, holiday] } })); setHoliday(''); }}><Plus size={15} />{t('إضافة', 'Add')}</button>
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title={t('مهل الانتظار والتنبيهات', 'Waiting windows & alerts')} hint={t('بعدها يظهر تنبيه لمن ينتظر قراره.', 'After these, an alert goes to whoever the decision waits on.')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {([['reviewWorkingDays', t('مراجعة القسم', 'Department review')], ['approvalWorkingDays', t('الاعتماد النهائي', 'Final approval')], ['odooLinkWorkingDays', t('ربط وظيفة Odoo', 'Odoo job link')]] as const).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[#EEF2F7] px-3.5 py-3">
              <span className="text-[13px] font-semibold text-navy">{label}</span>
              <NumberInput value={draft.waits[key]} min={0} max={60} disabled={disabled} label={label} suffix={t('يوم', 'WD')} onChange={(value) => setDraft((current) => ({ ...current, waits: { ...current.waits, [key]: value ?? 0 } }))} />
            </div>
          ))}
        </div>
        <label className="mt-4 block">
          <span className="label">{t('من يُبلَّغ بطلبات الاعتماد النهائي', 'Who is told a request awaits final approval')}</span>
          <select className="field md:w-96" disabled={disabled} value={draft.approvals.finalApproverUserId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, approvals: { finalApproverUserId: event.target.value || null } }))}>
            <option value="">{t('كل من لديه صلاحية الاعتماد', 'Everyone who can approve')}</option>
            {view.approvers.map((approver) => <option key={approver.id} value={approver.id}>{approver.name}</option>)}
          </select>
          <span className="mt-1 block text-[11.5px] text-ink-faint">{t('يحدد من يصله التنبيه فقط — الاعتماد نفسه متاح لكل من يملك الصلاحية.', 'This only chooses who is notified — anyone with the permission can still approve.')}</span>
        </label>
      </SettingsCard>
      <SaveBar dirty={dirty} saving={saving} problem={problem} onReset={reset} onSave={() => void save({ recruitment: draft as Partial<Recruitment> })} />
    </div>
  );
}

export function ClassificationsSection({ view }: { view: SettingsView }) {
  const { t } = useHRText();
  const { draft, setDraft, dirty, reset } = useDraft<Classification[]>(view.settings.recruitment.classifications, view.revision);
  const { save, saving } = useSettingsSave(view);
  const [adding, setAdding] = useState({ ar: '', en: '' });
  const disabled = !view.canEdit;
  const existing = new Set(view.settings.recruitment.classifications.map((item) => item.id));
  const problem = draft.some((item) => !item.ar.trim() || !item.en.trim()) ? t('كل تصنيف يحتاج اسماً بالعربي والإنجليزي.', 'Every classification needs an Arabic and an English name.') : null;
  const update = (id: string, patch: Partial<Classification>) => setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  return (
    <div className="space-y-5">
      <SettingsCard title={t('تصنيفات الوظائف', 'Job classifications')} hint={t('التصنيف منفصل عن الأولوية، وهو ما تُبنى عليه بنود المكافآت. التصنيف المستخدم يُعطَّل ولا يُحذف.', 'Classification is separate from priority and drives the reward lines. A classification in use is deactivated, never deleted.')}>
        <ul className="space-y-2">
          {draft.map((item) => (
            <li key={item.id} className={cx('grid grid-cols-1 gap-2 rounded-xl border px-3 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center', item.active ? 'border-[#EEF2F7]' : 'border-dashed border-slate-300 bg-[#F9FBFD]')}>
              <code className="ltr truncate text-[12px] text-[#5A6C82]">{item.id}</code>
              <input className="field !py-1.5" disabled={disabled} value={item.ar} onChange={(event) => update(item.id, { ar: event.target.value })} aria-label={t('الاسم بالعربي', 'Arabic name')} dir="rtl" />
              <input className="field !py-1.5" disabled={disabled} value={item.en} onChange={(event) => update(item.id, { en: event.target.value })} aria-label={t('الاسم بالإنجليزي', 'English name')} dir="ltr" />
              <span className="flex items-center gap-2">
                <button type="button" disabled={disabled} onClick={() => update(item.id, { active: !item.active })} className={cx('rounded-full px-2.5 py-1 text-[11.5px] font-semibold', item.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>{item.active ? t('مفعّل', 'Active') : t('معطّل', 'Inactive')}</button>
                {!existing.has(item.id) && !disabled && <button type="button" onClick={() => setDraft((current) => current.filter((row) => row.id !== item.id))} className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint hover:bg-red-50 hover:text-red-600" aria-label={t('حذف', 'Remove')}><Trash2 size={15} /></button>}
              </span>
            </li>
          ))}
        </ul>
        {!disabled && (
          <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl bg-[#F6F8FB] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input className="field !py-1.5" value={adding.ar} onChange={(event) => setAdding((current) => ({ ...current, ar: event.target.value }))} placeholder={t('الاسم بالعربي', 'Arabic name')} dir="rtl" />
            <input className="field !py-1.5" value={adding.en} onChange={(event) => setAdding((current) => ({ ...current, en: event.target.value }))} placeholder={t('الاسم بالإنجليزي', 'English name')} dir="ltr" />
            <button type="button" className="btn-ghost btn-sm" disabled={!adding.ar.trim() || !adding.en.trim()} onClick={() => { setDraft((current) => [...current, { id: newId(adding.en, current.map((item) => item.id)), ar: adding.ar.trim(), en: adding.en.trim(), active: true }]); setAdding({ ar: '', en: '' }); }}><Plus size={15} />{t('إضافة تصنيف', 'Add classification')}</button>
          </div>
        )}
      </SettingsCard>
      <SaveBar dirty={dirty} saving={saving} problem={problem} onReset={reset} onSave={() => void save({ recruitment: { classifications: draft } })} />
    </div>
  );
}

export function CapacitySection({ view }: { view: SettingsView }) {
  const { t, pick } = useHRText();
  const { draft, setDraft, dirty, reset } = useDraft(view.settings.recruitment.capacity, view.revision);
  const { save, saving } = useSettingsSave(view);
  const disabled = !view.canEdit;
  return (
    <div className="space-y-5">
      <SettingsCard title={t('سعة كل مسؤول توظيف', 'Capacity per recruiter')} hint={t('يُفرض على الخادم عند الإسناد وعند تغيير الأولوية. التجاوز يحتاج صلاحية خاصة وسبباً مكتوباً ويُسجَّل.', 'Enforced on the server at assignment and on every priority change. An override needs its own permission and a written reason, and is audited.')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {PRIORITY_ORDER.map((priority) => {
            const limit = draft[priority];
            return (
              <div key={priority} className="rounded-xl border border-[#EEF2F7] p-3.5">
                <p className="text-[13px] font-bold text-navy">{pick(PRIORITY_LABEL[priority])}</p>
                <div className="mt-2 flex items-center gap-2">
                  <NumberInput value={limit} min={0} max={50} disabled={disabled || limit === null} label={pick(PRIORITY_LABEL[priority])} suffix={t('وظيفة', 'jobs')} allowEmpty onChange={(value) => setDraft((current) => ({ ...current, [priority]: value }))} />
                </div>
                <label className="mt-2 flex items-center gap-2 text-[12px] text-[#5A6C82]">
                  <input type="checkbox" className="h-4 w-4 accent-[#1D6FB8]" disabled={disabled} checked={limit === null} onChange={(event) => setDraft((current) => ({ ...current, [priority]: event.target.checked ? null : priority === 'critical' ? 2 : 5 }))} />
                  {t('بلا حد', 'No limit')}
                </label>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <Toggle checked={draft.countOnHold} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, countOnHold: value }))} label={t('الوظائف المعلّقة تُحسب من السعة', 'Jobs on hold count toward capacity')} hint={t('إن أُطفئ، تحرر الوظيفة المعلّقة مكانها حتى تُستأنف.', 'When off, a held job frees its slot until it resumes.')} />
        </div>
      </SettingsCard>
      <SaveBar dirty={dirty} saving={saving} onReset={reset} onSave={() => void save({ recruitment: { capacity: draft } })} />
    </div>
  );
}

export function TeamSection({ view }: { view: SettingsView }) {
  const { t, lang, pick } = useHRText();
  const { draft, setDraft, dirty, reset } = useDraft(view.settings.recruitment.team, view.revision);
  const { save, saving } = useSettingsSave(view);
  const disabled = !view.canEdit;
  const excluded = new Set(draft.exclude);
  const included = new Set(draft.include);
  const toggleExclude = (code: string) => setDraft((current) => ({ ...current, exclude: current.exclude.includes(code) ? current.exclude.filter((item) => item !== code) : [...current.exclude, code] }));
  const toggleInclude = (code: string) => setDraft((current) => ({ ...current, include: current.include.includes(code) ? current.include.filter((item) => item !== code) : [...current.include, code], exclude: current.exclude.filter((item) => item !== code) }));
  const name = (member: { nameArabic: string; nameEnglish?: string; name?: string }) => (lang === 'en' ? member.nameEnglish || member.name || member.nameArabic : member.nameArabic || member.nameEnglish || member.name || '');
  return (
    <div className="space-y-5">
      <SettingsCard title={t('فريق التوظيف', 'Recruitment team')} hint={t('يُستنتج الفريق من بيانات حقيقية: المسمى الوظيفي، وقسم التوظيف في Odoo، ومن يملك طلبات. هنا تستبعد أحداً أو تضيف من لم يُستنتج.', 'The team is derived from real data: job title, the Odoo recruiting department, and who owns requests. Here you exclude someone or add someone the rules missed.')}>
        <ul className="divide-y divide-[#EEF2F7]">
          {view.team.map((member) => {
            const out = excluded.has(member.employeeCode);
            return (
              <li key={member.employeeCode} className={cx('flex flex-wrap items-center gap-3 py-2.5', out && 'opacity-60')}>
                <PersonAvatar name={name(member)} photoUrl={member.photoUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-navy">{name(member)} <span className="font-mono text-[11px] text-ink-faint">#{member.employeeCode}</span></p>
                  <p className="hr-bidi truncate text-[11.5px] text-[#5A6C82]">{member.title || '—'}</p>
                </div>
                <span className="flex flex-wrap gap-1">{member.reasons.map((reason) => <Badge key={reason} tone="neutral">{pick(TEAM_REASON_LABEL[reason])}</Badge>)}</span>
                {!disabled && (
                  included.has(member.employeeCode) && member.reasons.length === 1 && member.reasons[0] === 'manual'
                    ? <button type="button" className="btn-quiet btn-sm !min-h-8" onClick={() => toggleInclude(member.employeeCode)}><UserMinus size={14} />{t('إزالة', 'Remove')}</button>
                    : <button type="button" className={cx('btn-sm !min-h-8', out ? 'btn-ghost' : 'btn-quiet')} onClick={() => toggleExclude(member.employeeCode)}>{out ? <><UserPlus size={14} />{t('إرجاع', 'Bring back')}</> : <><UserMinus size={14} />{t('استبعاد', 'Exclude')}</>}</button>
                )}
              </li>
            );
          })}
        </ul>
        {view.teamCandidates.length > 0 && (
          <div className="mt-4 rounded-xl bg-[#F6F8FB] p-3">
            <p className="text-[12.5px] font-semibold text-navy">{t('موظفو قسم الموارد البشرية خارج الفريق', 'HR department staff outside the team')}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {view.teamCandidates.map((candidate) => {
                const on = included.has(candidate.employeeCode);
                return (
                  <li key={candidate.employeeCode}>
                    <button type="button" disabled={disabled} aria-pressed={on} onClick={() => toggleInclude(candidate.employeeCode)} className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold', on ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-[#E6ECF3] bg-white text-[#5A6C82] hover:text-navy')}>
                      {on ? <UserMinus size={13} /> : <UserPlus size={13} />}{lang === 'en' ? candidate.name : candidate.nameArabic || candidate.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </SettingsCard>
      <SaveBar dirty={dirty} saving={saving} onReset={reset} onSave={() => void save({ recruitment: { team: draft } })} />
    </div>
  );
}

export function OdooSection({ view }: { view: SettingsView }) {
  const { t, pick, lang } = useHRText();
  const { draft, setDraft, dirty, reset } = useDraft(view.settings.recruitment.odoo.funnel, view.revision);
  const { save, saving } = useSettingsSave(view);
  const disabled = !view.canEdit;
  return (
    <div className="space-y-5">
      <SettingsCard title={t('حالة الربط مع Odoo', 'Odoo connection')}>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-[#F6F8FB] p-3"><dt className="text-[11.5px] font-semibold text-[#5A6C82]">{t('الإعداد', 'Configured')}</dt><dd className="mt-1"><Badge tone={view.odoo.configured ? 'success' : 'warning'}>{view.odoo.configured ? t('مهيأ', 'Configured') : t('غير مهيأ', 'Not configured')}</Badge></dd></div>
          <div className="rounded-xl bg-[#F6F8FB] p-3"><dt className="text-[11.5px] font-semibold text-[#5A6C82]">{t('دليل الموظفين', 'Employee index')}</dt><dd className="mt-1"><Badge tone={view.odoo.indexLoaded ? 'success' : 'neutral'}>{view.odoo.indexLoaded ? t('محمّل', 'Loaded') : t('غير محمّل بعد', 'Not loaded yet')}</Badge></dd></div>
          <div className="rounded-xl bg-[#F6F8FB] p-3"><dt className="text-[11.5px] font-semibold text-[#5A6C82]">{t('موظفو Odoo', 'Odoo employees')}</dt><dd className="mt-1 text-[18px] font-bold tabular-nums text-navy">{new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ar-EG-u-nu-latn').format(view.odoo.employees)}</dd></div>
        </dl>
        <p className="mt-3 text-[12.5px] leading-6 text-[#5A6C82]">{t('Qodo يملك تشغيل التوظيف، وOdoo يملك المرشحين. المطابقة التلقائية اقتراح فقط؛ الربط المؤكد وحده يُحسب في الإغلاق التلقائي. الصور من صورة الموظف في Odoo فقط.', 'Qodo owns recruitment operations; Odoo owns candidates. Automatic matches are suggestions only; only a confirmed link counts toward auto-closing. Photos come only from the employee photo in Odoo.')}</p>
      </SettingsCard>
      <SettingsCard title={t('مراحل القمع', 'Funnel stages')} hint={t('أسماء مراحل Odoo كما هي، سطر لكل مرحلة. المرفوضون يُحسبون في "مستلمون" و"بعد الفرز" و"مقابلات" فقط.', 'Odoo stage names exactly as written, one per line. Refused applicants count only toward received, filtered and interviewed.')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Object.keys(draft).map((key) => (
            <label key={key} className="block">
              <span className="label">{FUNNEL_LABEL[key] ? pick(FUNNEL_LABEL[key]) : key}</span>
              <textarea className="field ltr min-h-[92px] font-mono !text-[12px]" disabled={disabled} value={draft[key].join('\n')} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) }))} />
            </label>
          ))}
        </div>
      </SettingsCard>
      <SaveBar dirty={dirty} saving={saving} onReset={reset} onSave={() => void save({ recruitment: { odoo: { funnel: draft } } })} />
    </div>
  );
}

function ChecklistEditor({ items, onChange, disabled }: { items: ChecklistDefinition[]; onChange: (items: ChecklistDefinition[]) => void; disabled: boolean }) {
  const { t, pick } = useHRText();
  const [adding, setAdding] = useState<{ ar: string; en: string; owner: ChecklistDefinition['owner'] }>({ ar: '', en: '', owner: 'personnel' });
  return (
    <div>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={item.id} className="grid grid-cols-1 gap-2 rounded-xl border border-[#EEF2F7] px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_auto] sm:items-center">
            <input className="field !py-1.5" disabled={disabled} value={item.ar} dir="rtl" aria-label={t('بالعربي', 'Arabic')} onChange={(event) => onChange(items.map((row, position) => (position === index ? { ...row, ar: event.target.value } : row)))} />
            <input className="field !py-1.5" disabled={disabled} value={item.en} dir="ltr" aria-label={t('بالإنجليزي', 'English')} onChange={(event) => onChange(items.map((row, position) => (position === index ? { ...row, en: event.target.value } : row)))} />
            <select className="field !py-1.5" disabled={disabled} value={item.owner} aria-label={t('المسؤول', 'Owner')} onChange={(event) => onChange(items.map((row, position) => (position === index ? { ...row, owner: event.target.value as ChecklistDefinition['owner'] } : row)))}>
              {(['personnel', 'manager', 'it'] as const).map((owner) => <option key={owner} value={owner}>{pick(OWNER_LABEL[owner])}</option>)}
            </select>
            {!disabled && <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint hover:bg-red-50 hover:text-red-600" onClick={() => onChange(items.filter((_, position) => position !== index))} aria-label={t('حذف البند', 'Remove item')}><Trash2 size={15} /></button>}
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className="mt-2 grid grid-cols-1 gap-2 rounded-xl bg-[#F6F8FB] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_auto]">
          <input className="field !py-1.5" value={adding.ar} dir="rtl" placeholder={t('البند بالعربي', 'Item in Arabic')} onChange={(event) => setAdding((current) => ({ ...current, ar: event.target.value }))} />
          <input className="field !py-1.5" value={adding.en} dir="ltr" placeholder={t('البند بالإنجليزي', 'Item in English')} onChange={(event) => setAdding((current) => ({ ...current, en: event.target.value }))} />
          <select className="field !py-1.5" value={adding.owner} aria-label={t('المسؤول', 'Owner')} onChange={(event) => setAdding((current) => ({ ...current, owner: event.target.value as ChecklistDefinition['owner'] }))}>
            {(['personnel', 'manager', 'it'] as const).map((owner) => <option key={owner} value={owner}>{pick(OWNER_LABEL[owner])}</option>)}
          </select>
          <button type="button" className="btn-ghost btn-sm" disabled={!adding.ar.trim() || !adding.en.trim()} onClick={() => { onChange([...items, { id: newId(adding.en, items.map((item) => item.id)), ar: adding.ar.trim(), en: adding.en.trim(), owner: adding.owner }]); setAdding({ ar: '', en: '', owner: 'personnel' }); }}><Plus size={15} />{t('إضافة', 'Add')}</button>
        </div>
      )}
    </div>
  );
}

export function ChecklistsSection({ view }: { view: SettingsView }) {
  const { t, pick } = useHRText();
  const slice = { personnel: view.settings.personnel, performance: view.settings.performance };
  const { draft, setDraft, dirty, reset } = useDraft(slice, view.revision);
  const { save, saving } = useSettingsSave(view);
  const disabled = !view.canEdit;
  const criteria = draft.performance.quarterlyCriteria;
  const setCriteria = (next: ReviewCriterion[]) => setDraft((current) => ({ ...current, performance: { quarterlyCriteria: next } }));
  const [adding, setAdding] = useState({ ar: '', en: '', max: 10 });
  const problem = criteria.some((item) => !item.ar.trim() || !item.en.trim() || !(item.max >= 1 && item.max <= 100)) ? t('كل معيار يحتاج اسمين ودرجة قصوى بين 1 و100.', 'Every criterion needs both names and a maximum between 1 and 100.') : null;
  return (
    <div className="space-y-5">
      <SettingsCard title={t('قائمة تهيئة الموظف الجديد', 'New hire onboarding checklist')} hint={t('تُنسخ لكل طلب تهيئة جديد؛ تعديلها لا يغيّر طلبات مفتوحة بالفعل.', 'Copied into every new onboarding case; editing it does not change cases already open.')}>
        <ChecklistEditor items={draft.personnel.onboardingChecklist} disabled={disabled} onChange={(items) => setDraft((current) => ({ ...current, personnel: { ...current.personnel, onboardingChecklist: items } }))} />
      </SettingsCard>
      <SettingsCard title={t('قائمة إخلاء الطرف', 'Clearance checklist')}>
        <ChecklistEditor items={draft.personnel.clearanceChecklist} disabled={disabled} onChange={(items) => setDraft((current) => ({ ...current, personnel: { ...current.personnel, clearanceChecklist: items } }))} />
      </SettingsCard>
      <SettingsCard title={t('معايير التقييم الربع سنوي', 'Quarterly review criteria')} hint={t('كل تقييم يحفظ المعايير التي بدأ بها، فتعديلها لا يعيد حساب ربع سابق.', 'Each review keeps the criteria it started with, so editing them never rescores a past quarter.')}>
        <ul className="space-y-2">
          {criteria.map((item, index) => (
            <li key={item.id} className="grid grid-cols-1 gap-2 rounded-xl border border-[#EEF2F7] px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center">
              <input className="field !py-1.5" disabled={disabled} value={item.ar} dir="rtl" aria-label={t('بالعربي', 'Arabic')} onChange={(event) => setCriteria(criteria.map((row, position) => (position === index ? { ...row, ar: event.target.value } : row)))} />
              <input className="field !py-1.5" disabled={disabled} value={item.en} dir="ltr" aria-label={t('بالإنجليزي', 'English')} onChange={(event) => setCriteria(criteria.map((row, position) => (position === index ? { ...row, en: event.target.value } : row)))} />
              <NumberInput value={item.max} min={1} max={100} disabled={disabled} label={t('الدرجة القصوى', 'Maximum')} suffix={t('درجة', 'pts')} onChange={(value) => setCriteria(criteria.map((row, position) => (position === index ? { ...row, max: value ?? 0 } : row)))} />
              {!disabled && criteria.length > 1 && <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint hover:bg-red-50 hover:text-red-600" onClick={() => setCriteria(criteria.filter((_, position) => position !== index))} aria-label={t('حذف المعيار', 'Remove criterion')}><Trash2 size={15} /></button>}
            </li>
          ))}
        </ul>
        {!disabled && (
          <div className="mt-2 grid grid-cols-1 gap-2 rounded-xl bg-[#F6F8FB] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
            <input className="field !py-1.5" value={adding.ar} dir="rtl" placeholder={t('المعيار بالعربي', 'Criterion in Arabic')} onChange={(event) => setAdding((current) => ({ ...current, ar: event.target.value }))} />
            <input className="field !py-1.5" value={adding.en} dir="ltr" placeholder={t('المعيار بالإنجليزي', 'Criterion in English')} onChange={(event) => setAdding((current) => ({ ...current, en: event.target.value }))} />
            <NumberInput value={adding.max} min={1} max={100} label={t('الدرجة القصوى', 'Maximum')} onChange={(value) => setAdding((current) => ({ ...current, max: value ?? 0 }))} />
            <button type="button" className="btn-ghost btn-sm" disabled={!adding.ar.trim() || !adding.en.trim() || !(adding.max >= 1 && adding.max <= 100)} onClick={() => { setCriteria([...criteria, { id: newId(adding.en, criteria.map((item) => item.id)), ar: adding.ar.trim(), en: adding.en.trim(), max: adding.max }]); setAdding({ ar: '', en: '', max: 10 }); }}><Plus size={15} />{t('إضافة', 'Add')}</button>
          </div>
        )}
        <p className="mt-2 text-[12px] text-[#5A6C82]">{t(`المجموع ${criteria.reduce((sum, item) => sum + (Number(item.max) || 0), 0)} درجة.`, `Total ${criteria.reduce((sum, item) => sum + (Number(item.max) || 0), 0)} points.`)}{' '}{pick({ ar: 'النتيجة تُعرض كنسبة من المجموع.', en: 'The result shows as a share of the total.' })}</p>
      </SettingsCard>
      <SaveBar dirty={dirty} saving={saving} problem={problem} onReset={reset} onSave={() => void save({ personnel: draft.personnel, performance: draft.performance })} />
    </div>
  );
}
