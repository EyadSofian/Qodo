/**
 * The two scoring policies: KPI weights and per-rule deductions, and the
 * versioned reward rules. Reward rules are never edited in place — saving
 * writes a new version, and a batch keeps the version it was built under.
 */

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { errorMessage } from '../../../lib/api';
import { cx } from '../../../lib/utils';
import { useToast } from '../../../components/ui';
import { hrMutate } from '../api';
import { dateTime, money, useHRText } from '../format';
import { LOCATION_LABEL } from '../labels';
import type { CustomKpiRule, RewardCategory, RewardRules, SettingsView } from '../types';
import { Badge } from '../ui/primitives';
import { NumberInput, SaveBar, SettingsCard, Toggle, newId, useDraft, useSettingsSave } from './common';

const DEDUCTION_CATEGORIES = ['hr_review', 'commitment', 'system_quality'] as const;

export function KpiSection({ view }: { view: SettingsView }) {
  const { t, pick } = useHRText();
  const slice = view.settings.kpi;
  const { draft, setDraft, dirty, reset } = useDraft(slice, view.revision);
  const { save, saving } = useSettingsSave(view);
  const [adding, setAdding] = useState<Omit<CustomKpiRule, 'id'>>({ category: 'commitment', ar: '', en: '', points: 2 });
  const disabled = !view.canEdit;
  const total = Object.values(draft.weights).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const categoryName = (id: string) => pick(view.kpi.categories.find((category) => category.id === id) ?? { ar: id, en: id });
  const builtIn = view.kpi.rules.filter((rule) => !rule.custom);
  const ruleProblem = builtIn.find((rule) => {
    const points = draft.rules[rule.id]?.points;
    return points !== undefined && !(points > 0 && points <= (draft.weights[rule.category] ?? 0));
  }) ?? null;
  const problem = total !== 100
    ? t(`مجموع الأوزان ${total} — يجب أن يكون 100.`, `The weights total ${total} — they must total 100.`)
    : ruleProblem
      ? t(`نقاط "${ruleProblem.ar}" يجب أن تكون بين 0 ووزن محورها.`, `"${ruleProblem.en}" points must be above 0 and within its category weight.`)
      : null;
  const setRule = (id: string, patch: { points?: number; enabled?: boolean }) => setDraft((current) => ({ ...current, rules: { ...current.rules, [id]: { ...(current.rules[id] ?? {}), ...patch } } }));

  return (
    <div className="space-y-5">
      <SettingsCard title={t('أوزان المحاور', 'Category weights')} hint={t('مجموعها 100. محور غير مقاس في شهر ما يُستبعد من القسمة بدلاً من احتسابه صفراً.', 'They total 100. A category not measured in a month is left out of the division rather than counted as zero.')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {view.kpi.categories.map((category) => (
            <div key={category.id} className="rounded-xl border border-[#EEF2F7] p-3">
              <p className="text-[12.5px] font-semibold text-navy">{pick(category)}</p>
              <p className="text-[11px] text-ink-faint">{category.mode === 'computed' ? t('محسوب آلياً', 'Computed') : t('خصومات', 'Deductions')}</p>
              <div className="mt-2"><NumberInput value={draft.weights[category.id] ?? 0} min={0} max={100} disabled={disabled} label={pick(category)} suffix="%" onChange={(value) => setDraft((current) => ({ ...current, weights: { ...current.weights, [category.id]: value ?? 0 } }))} /></div>
            </div>
          ))}
        </div>
        <p className={cx('mt-2 text-[12.5px] font-semibold', total === 100 ? 'text-emerald-700' : 'text-red-700')}>{t(`المجموع: ${total}`, `Total: ${total}`)}</p>
      </SettingsCard>

      <SettingsCard title={t('قواعد الخصم', 'Deduction rules')} hint={t('لا قرارات آلية على المظهر أو أي صفة محمية. القواعد اليدوية تحتاج مراجعاً وسبباً وتاريخاً، والقواعد الآلية تُفحص يومياً.', 'No automated decision on appearance or any protected attribute. Manual rules need a reviewer, a reason and a date; automatic rules are checked daily.')}>
        <ul className="divide-y divide-[#EEF2F7]">
          {builtIn.map((rule) => {
            const override = draft.rules[rule.id] ?? {};
            const points = override.points ?? rule.points;
            const enabled = override.enabled ?? rule.enabled;
            return (
              <li key={rule.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-navy">{pick(rule)}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#5A6C82]">
                    <span>{categoryName(rule.category)}</span>
                    <Badge tone={rule.automatic ? 'info' : 'neutral'}>{rule.automatic ? t('آلي', 'Automatic') : t('يدوي بمراجع', 'Manual, reviewed')}</Badge>
                    {rule.humanReviewOnly && <Badge tone="warning">{t('مراجعة بشرية فقط', 'Human review only')}</Badge>}
                  </p>
                </div>
                <NumberInput value={points} min={0.5} max={draft.weights[rule.category] ?? 30} disabled={disabled} label={t(`نقاط ${rule.ar}`, `${rule.en} points`)} suffix={t('نقطة', 'pts')} onChange={(value) => setRule(rule.id, { points: value ?? 0 })} />
                <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#3F5068]">
                  <input type="checkbox" className="h-4 w-4 accent-[#1D6FB8]" disabled={disabled} checked={enabled} onChange={(event) => setRule(rule.id, { enabled: event.target.checked })} />
                  {t('مفعّلة', 'Enabled')}
                </label>
              </li>
            );
          })}
        </ul>
      </SettingsCard>

      <SettingsCard title={t('قواعد مخصصة', 'Custom rules')} hint={t('قواعد يدوية إضافية داخل محاور الخصم.', 'Extra manual rules inside the deduction categories.')}>
        {draft.customRules.length ? (
          <ul className="space-y-2">
            {draft.customRules.map((rule, index) => (
              <li key={rule.id} className="grid grid-cols-1 gap-2 rounded-xl border border-[#EEF2F7] px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center">
                <select className="field !py-1.5" disabled={disabled} value={rule.category} aria-label={t('المحور', 'Category')} onChange={(event) => setDraft((current) => ({ ...current, customRules: current.customRules.map((row, position) => (position === index ? { ...row, category: event.target.value as CustomKpiRule['category'] } : row)) }))}>
                  {DEDUCTION_CATEGORIES.map((id) => <option key={id} value={id}>{categoryName(id)}</option>)}
                </select>
                <input className="field !py-1.5" disabled={disabled} value={rule.ar} dir="rtl" aria-label={t('بالعربي', 'Arabic')} onChange={(event) => setDraft((current) => ({ ...current, customRules: current.customRules.map((row, position) => (position === index ? { ...row, ar: event.target.value } : row)) }))} />
                <input className="field !py-1.5" disabled={disabled} value={rule.en} dir="ltr" aria-label={t('بالإنجليزي', 'English')} onChange={(event) => setDraft((current) => ({ ...current, customRules: current.customRules.map((row, position) => (position === index ? { ...row, en: event.target.value } : row)) }))} />
                <NumberInput value={rule.points} min={0.5} max={draft.weights[rule.category] ?? 30} disabled={disabled} label={t('النقاط', 'Points')} onChange={(value) => setDraft((current) => ({ ...current, customRules: current.customRules.map((row, position) => (position === index ? { ...row, points: value ?? 0 } : row)) }))} />
                {!disabled && <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint hover:bg-red-50 hover:text-red-600" onClick={() => setDraft((current) => ({ ...current, customRules: current.customRules.filter((_, position) => position !== index) }))} aria-label={t('حذف القاعدة', 'Remove rule')}><Trash2 size={15} /></button>}
              </li>
            ))}
          </ul>
        ) : <p className="text-[12.5px] text-ink-faint">{t('لا توجد قواعد مخصصة.', 'No custom rules.')}</p>}
        {!disabled && (
          <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl bg-[#F6F8FB] p-3 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
            <select className="field !py-1.5" value={adding.category} aria-label={t('المحور', 'Category')} onChange={(event) => setAdding((current) => ({ ...current, category: event.target.value as CustomKpiRule['category'] }))}>
              {DEDUCTION_CATEGORIES.map((id) => <option key={id} value={id}>{categoryName(id)}</option>)}
            </select>
            <input className="field !py-1.5" value={adding.ar} dir="rtl" placeholder={t('القاعدة بالعربي', 'Rule in Arabic')} onChange={(event) => setAdding((current) => ({ ...current, ar: event.target.value }))} />
            <input className="field !py-1.5" value={adding.en} dir="ltr" placeholder={t('القاعدة بالإنجليزي', 'Rule in English')} onChange={(event) => setAdding((current) => ({ ...current, en: event.target.value }))} />
            <NumberInput value={adding.points} min={0.5} max={30} label={t('النقاط', 'Points')} onChange={(value) => setAdding((current) => ({ ...current, points: value ?? 0 }))} />
            <button type="button" className="btn-ghost btn-sm" disabled={!adding.ar.trim() || !adding.en.trim() || !(adding.points > 0)} onClick={() => { setDraft((current) => ({ ...current, customRules: [...current.customRules, { ...adding, id: newId(adding.en, [...current.customRules.map((rule) => rule.id), ...builtIn.map((rule) => rule.id)]), ar: adding.ar.trim(), en: adding.en.trim(), enabled: true }] })); setAdding({ category: 'commitment', ar: '', en: '', points: 2 }); }}><Plus size={15} />{t('إضافة', 'Add')}</button>
          </div>
        )}
      </SettingsCard>
      <SaveBar dirty={dirty} saving={saving} problem={problem} onReset={reset} onSave={() => void save({ kpi: draft })} />
    </div>
  );
}

export function RewardsSection({ view }: { view: SettingsView }) {
  const { t, lang, pick } = useHRText();
  const { push } = useToast();
  const initial = view.rewardRules;
  const { draft, setDraft, dirty, reset } = useDraft<RewardRules>(initial, view.revision + initial.version * 1000);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const disabled = !view.canEdit;
  const classifications = view.settings.recruitment.classifications;
  const problem = draft.categories.find((category) => !(category.amountMin >= 0 && category.amountMin <= category.amountMax))
    ? t('الحد الأدنى لبند يتجاوز الأعلى.', 'A line\'s minimum is above its maximum.')
    : !(draft.jobsPerBatch >= 1 && draft.jobsPerBatch <= 20) ? t('عدد الوظائف لكل مكافأة بين 1 و20.', 'Jobs per reward must be 1–20.') : null;
  const setCategory = (index: number, patch: Partial<RewardCategory>) => setDraft((current) => ({ ...current, categories: current.categories.map((row, position) => (position === index ? { ...row, ...patch } : row)) }));

  const saveVersion = async () => {
    setSaving(true);
    try {
      await hrMutate('post', '/hr/settings/reward-rules', {
        jobsPerBatch: draft.jobsPerBatch,
        grouping: draft.grouping,
        currency: draft.currency,
        eligibility: draft.eligibility,
        categories: draft.categories,
        note: note.trim(),
      });
      setNote('');
      push(t('حُفظت نسخة جديدة من قواعد المكافآت. الدفعات القائمة تحتفظ بنسختها.', 'A new version of the reward rules was saved. Existing batches keep theirs.'));
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <SettingsCard title={t(`قواعد المكافآت — النسخة ${initial.version}`, `Reward rules — version ${initial.version}`)} hint={t('مكافأة لكل مجموعة وظائف مؤهلة. الوظيفة تُحسب مرة واحدة فقط، والدفعة تحتفظ بالنسخة التي بُنيت عليها.', 'One reward per group of eligible jobs. A job counts once, and a batch keeps the rule version it was built under.')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#EEF2F7] px-3.5 py-3">
            <span className="text-[13px] font-semibold text-navy">{t('وظائف لكل مكافأة', 'Jobs per reward')}</span>
            <NumberInput value={draft.jobsPerBatch} min={1} max={20} disabled={disabled} label={t('وظائف لكل مكافأة', 'Jobs per reward')} onChange={(value) => setDraft((current) => ({ ...current, jobsPerBatch: value ?? 0 }))} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-[#EEF2F7] px-3.5 py-3">
            <span className="text-[13px] font-semibold text-navy">{t('التجميع', 'Grouping')}</span>
            <select className="field !w-44 !py-1.5" disabled={disabled} value={draft.grouping} onChange={(event) => setDraft((current) => ({ ...current, grouping: event.target.value as RewardRules['grouping'] }))}>
              <option value="per_category">{t('لكل بند على حدة', 'Per reward line')}</option>
              <option value="mixed">{t('مختلط بين البنود', 'Mixed across lines')}</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-[#EEF2F7] px-3.5 py-3">
            <span className="text-[13px] font-semibold text-navy">{t('العملة', 'Currency')}</span>
            <input className="field ltr !w-24 !py-1.5 text-center uppercase" disabled={disabled} value={draft.currency} maxLength={3} onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} aria-label={t('العملة', 'Currency')} />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <Toggle checked={draft.eligibility.requireCompleted} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, eligibility: { ...current.eligibility, requireCompleted: value } }))} label={t('مكتملة بتاريخ معروف', 'Completed with a known date')} />
          <Toggle checked={draft.eligibility.requireWithinSla} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, eligibility: { ...current.eligibility, requireWithinSla: value } }))} label={t('داخل الـSLA', 'Within the SLA')} />
          <Toggle checked={draft.eligibility.requireQualityPassed} disabled={disabled} onChange={(value) => setDraft((current) => ({ ...current, eligibility: { ...current.eligibility, requireQualityPassed: value } }))} label={t('بلا خصم جودة', 'No quality deduction')} />
        </div>

        <h3 className="mb-2 mt-5 text-[13px] font-bold text-navy">{t('بنود المكافأة', 'Reward lines')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead><tr className="text-[11.5px] text-[#5A6C82]"><th className="py-2 text-start font-semibold">{t('بالعربي', 'Arabic')}</th><th className="py-2 text-start font-semibold">{t('بالإنجليزي', 'English')}</th><th className="py-2 text-start font-semibold">{t('التصنيف', 'Classification')}</th><th className="py-2 text-start font-semibold">{t('الموقع', 'Location')}</th><th className="py-2 font-semibold">{t('من', 'Min')}</th><th className="py-2 font-semibold">{t('إلى', 'Max')}</th><th /></tr></thead>
            <tbody className="divide-y divide-[#EEF2F7]">
              {draft.categories.map((category, index) => (
                <tr key={category.id}>
                  <td className="py-2 pe-2"><input className="field !py-1.5" disabled={disabled} dir="rtl" value={category.ar} onChange={(event) => setCategory(index, { ar: event.target.value })} aria-label={t('بالعربي', 'Arabic')} /></td>
                  <td className="py-2 pe-2"><input className="field !py-1.5" disabled={disabled} dir="ltr" value={category.en} onChange={(event) => setCategory(index, { en: event.target.value })} aria-label={t('بالإنجليزي', 'English')} /></td>
                  <td className="py-2 pe-2"><select className="field !py-1.5" disabled={disabled} value={category.classification} onChange={(event) => setCategory(index, { classification: event.target.value })} aria-label={t('التصنيف', 'Classification')}>{classifications.map((item) => <option key={item.id} value={item.id}>{pick(item)}</option>)}</select></td>
                  <td className="py-2 pe-2"><select className="field !py-1.5" disabled={disabled} value={category.location ?? ''} onChange={(event) => setCategory(index, { location: (event.target.value || null) as RewardCategory['location'] })} aria-label={t('الموقع', 'Location')}><option value="">{t('أي موقع', 'Any')}</option><option value="EG">{pick(LOCATION_LABEL.EG)}</option><option value="KSA">{pick(LOCATION_LABEL.KSA)}</option></select></td>
                  <td className="py-2 text-center"><NumberInput value={category.amountMin} min={0} disabled={disabled} label={t('من', 'Min')} onChange={(value) => setCategory(index, { amountMin: value ?? 0 })} /></td>
                  <td className="py-2 text-center"><NumberInput value={category.amountMax} min={0} disabled={disabled} label={t('إلى', 'Max')} onChange={(value) => setCategory(index, { amountMax: value ?? 0 })} /></td>
                  <td className="py-2 text-end">{!disabled && draft.categories.length > 1 && <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint hover:bg-red-50 hover:text-red-600" onClick={() => setDraft((current) => ({ ...current, categories: current.categories.filter((_, position) => position !== index) }))} aria-label={t('حذف البند', 'Remove line')}><Trash2 size={15} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!disabled && <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => setDraft((current) => ({ ...current, categories: [...current.categories, { id: newId(`line ${current.categories.length + 1}`, current.categories.map((item) => item.id)), ar: '', en: '', classification: classifications[0]?.id ?? 'agent', location: null, amountMin: 0, amountMax: 0 }] }))}><Plus size={15} />{t('إضافة بند', 'Add line')}</button>}
        {dirty && !disabled && (
          <label className="mt-4 block">
            <span className="label">{t('سبب التغيير (يُحفظ مع النسخة)', 'Reason for the change (saved with the version)')}</span>
            <input className="field" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
          </label>
        )}
      </SettingsCard>

      <SettingsCard title={t('سجل النسخ', 'Version history')}>
        <ul className="divide-y divide-[#EEF2F7]">
          {[...view.rewardVersions].sort((left, right) => right.version - left.version).map((version) => (
            <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]">
              <span className="flex items-center gap-2"><Badge tone={version.version === initial.version ? 'success' : 'neutral'}>v{version.version}</Badge><span className="text-[#5A6C82]">{version.note || '—'}</span></span>
              <span className="text-ink-faint">{dateTime(version.createdAt, lang)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11.5px] text-ink-faint">{t(`مثال: ${initial.jobsPerBatch} وظائف مؤهلة لوكيل = ${money(initial.categories.find((item) => item.classification === 'agent')?.amountMin ?? null, 'ar', initial.currency)}`, `Example: ${initial.jobsPerBatch} eligible Agent jobs = ${money(initial.categories.find((item) => item.classification === 'agent')?.amountMin ?? null, 'en', initial.currency)}`)}</p>
      </SettingsCard>
      <SaveBar dirty={dirty} saving={saving} problem={problem} onReset={() => { reset(); setNote(''); }} onSave={() => void saveVersion()} />
    </div>
  );
}
