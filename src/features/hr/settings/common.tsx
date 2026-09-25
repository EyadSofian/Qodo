/**
 * What every HR Settings section shares: a draft that resets when the saved
 * revision moves, a save bar that appears only when something changed, and a
 * save that carries the revision so two editors get a conflict instead of
 * silently overwriting each other.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, RotateCcw } from 'lucide-react';
import { errorMessage } from '../../../lib/api';
import { cx } from '../../../lib/utils';
import { Spinner, useToast } from '../../../components/ui';
import { hrMutate, isForbidden } from '../api';
import { useHRText } from '../format';
import type { HRSettings, SettingsView } from '../types';
import { Card, SectionTitle } from '../ui/primitives';
import { useMotion } from '../ui/motion';

/** A local copy of one slice of the settings, reset whenever a new revision arrives. */
export function useDraft<T>(source: T, revision: number) {
  const [draft, setDraft] = useState<T>(() => structuredClone(source));
  const snapshot = JSON.stringify(source);
  useEffect(() => {
    setDraft(JSON.parse(snapshot) as T);
  }, [snapshot, revision]);
  const dirty = useMemo(() => JSON.stringify(draft) !== snapshot, [draft, snapshot]);
  return { draft, setDraft, dirty, reset: () => setDraft(JSON.parse(snapshot) as T) };
}

/** Save one patch of the settings document. */
export function useSettingsSave(view: SettingsView) {
  const { t, lang } = useHRText();
  const { push } = useToast();
  const [saving, setSaving] = useState(false);
  const save = async (patch: Partial<{ [K in keyof HRSettings]: unknown }>) => {
    setSaving(true);
    try {
      await hrMutate('patch', '/hr/settings', { patch, revision: view.revision });
      push(t('حُفظت الإعدادات. تُطبَّق من الآن على كل الشاشات.', 'Settings saved. They apply everywhere from now on.'));
      return true;
    } catch (error) {
      push(isForbidden(error) ? t('تعديل الإعدادات يحتاج صلاحية إعدادات HR.', 'Changing settings needs the HR settings permission.') : errorMessage(error, lang), 'bad');
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}

export function SettingsCard({ title, hint, children, action }: { title: ReactNode; hint?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <SectionTitle title={title} hint={hint} action={action} />
      {children}
    </Card>
  );
}

export function SaveBar({ dirty, saving, onSave, onReset, disabled = false, problem }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void; disabled?: boolean; problem?: string | null }) {
  const { t } = useHRText();
  const motionPresets = useMotion();
  return (
    <AnimatePresence initial={false}>
      {dirty && (
        <motion.div
          initial={motionPresets.reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={motionPresets.reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={motionPresets.ease}
          className="sticky bottom-20 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-white/95 px-4 py-3 shadow-[0_12px_30px_-18px_rgba(11,37,69,0.45)] backdrop-blur md:bottom-4"
          role="region"
          aria-label={t('تغييرات غير محفوظة', 'Unsaved changes')}
        >
          <span className={cx('text-[12.5px] font-semibold', problem ? 'text-red-700' : 'text-[#5A6C82]')}>{problem ?? t('تغييرات غير محفوظة', 'Unsaved changes')}</span>
          <span className="flex gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onReset} disabled={saving}><RotateCcw size={14} />{t('تراجع', 'Discard')}</button>
            <button type="button" className="btn-primary btn-sm" onClick={onSave} disabled={saving || disabled || Boolean(problem)}>{saving ? <Spinner size={15} /> : <Check size={15} />}{t('حفظ', 'Save')}</button>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-start justify-between gap-4 rounded-xl border border-[#EEF2F7] px-3.5 py-3', disabled ? 'opacity-70' : 'cursor-pointer hover:bg-[#F9FBFD]')}>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-navy">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-5 text-[#5A6C82]">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span className="h-6 w-10 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-300" aria-hidden="true" />
        <span className="absolute start-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" aria-hidden="true" />
      </span>
    </label>
  );
}

export function NumberInput({ value, onChange, min, max, disabled, label, suffix, allowEmpty = false }: { value: number | null; onChange: (value: number | null) => void; min?: number; max?: number; disabled?: boolean; label: string; suffix?: ReactNode; allowEmpty?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        className="field !w-16 !px-2 !py-1.5 text-center tabular-nums sm:!w-24"
        value={value === null || value === undefined ? '' : value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const text = event.target.value;
          if (text === '') onChange(allowEmpty ? null : 0);
          else onChange(Number(text));
        }}
      />
      {suffix && <span className="text-[12px] text-[#5A6C82]">{suffix}</span>}
    </span>
  );
}

export const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/** A lower-case id unique among `taken`, made from an English name. */
export function newId(base: string, taken: string[]) {
  let id = slugify(base);
  if (!/^[a-z]/.test(id)) id = `item_${id || '1'}`;
  if (id.length < 2) id = `${id}_x`;
  let candidate = id;
  for (let index = 2; taken.includes(candidate); index += 1) candidate = `${id}_${index}`;
  return candidate;
}
