/**
 * Course settings: the basics, the production rules, the video QA checklist,
 * and archiving.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { lp, paths, uploads } from '../../../lib/learningProduction/api';
import { invalidate, useLpQuery } from '../../../lib/learningProduction/hooks';
import { lpErrorKey, priorityKey } from '../../../lib/learningProduction/format';
import type { ChecklistItem, CourseSettings as Settings, Priority } from '../../../lib/learningProduction/types';
import { Spinner, useToast } from '../../../components/ui';
import { ConfirmDialog, PersonSelect, Section, usePeople } from '../../../components/learning-production/kit';
import { useCourse } from '../CourseWorkspace';

export function CourseSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { detail } = useCourse();
  const { course, capabilities } = detail;
  const people = usePeople(capabilities.edit);

  const [basics, setBasics] = useState({
    name: course.name,
    code: course.code ?? '',
    description: course.description,
    managerUserId: course.managerUserId,
    status: course.status,
    priority: course.priority,
    startDate: course.startDate ?? '',
    targetDate: course.targetDate ?? '',
  });
  const [settings, setSettings] = useState<Settings>(detail.settings);
  const [busy, setBusy] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const run = async (key: string, work: () => Promise<unknown>, message = t('lp.toast.saved')) => {
    setBusy(key);
    try {
      await work();
      invalidate();
      toast.push(message);
      return true;
    } catch (error) {
      toast.push(t(lpErrorKey(error)), 'bad');
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {capabilities.edit && (
        <Section title={t('lp.settings.basics')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="label">{t('lp.course.name')}</span>
              <input className="field" value={basics.name} onChange={(event) => setBasics({ ...basics, name: event.target.value })} />
            </label>
            <label className="block">
              <span className="label">{t('lp.course.code')}</span>
              <input className="field ltr" value={basics.code} onChange={(event) => setBasics({ ...basics, code: event.target.value })} />
            </label>
            <label className="block">
              <span className="label">{t('lp.course.manager')}</span>
              <PersonSelect value={basics.managerUserId} onChange={(value) => setBasics({ ...basics, managerUserId: value })} people={people} />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">{t('lp.course.description')}</span>
              <textarea className="field min-h-[80px]" value={basics.description} onChange={(event) => setBasics({ ...basics, description: event.target.value })} />
            </label>
            <label className="block">
              <span className="label">{t('lp.course.startDate')}</span>
              <input type="date" className="field" value={basics.startDate} onChange={(event) => setBasics({ ...basics, startDate: event.target.value })} />
            </label>
            <label className="block">
              <span className="label">{t('lp.course.targetDate')}</span>
              <input type="date" className="field" value={basics.targetDate} onChange={(event) => setBasics({ ...basics, targetDate: event.target.value })} />
            </label>
            <label className="block">
              <span className="label">{t('lp.course.status')}</span>
              <select className="field" value={basics.status} onChange={(event) => setBasics({ ...basics, status: event.target.value as typeof basics.status })}>
                <option value="ACTIVE">{t('lp.course.active')}</option>
                <option value="ON_HOLD">{t('lp.course.onHold')}</option>
              </select>
            </label>
            <label className="block">
              <span className="label">{t('lp.priority')}</span>
              <select className="field" value={basics.priority} onChange={(event) => setBasics({ ...basics, priority: event.target.value as Priority })}>
                {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(priorityKey(value))}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="label">{t('lp.course.cover')}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="field !py-2 text-[12.5px]"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void run('cover', () => uploads.cover(course.id, file).promise);
                }}
              />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy === 'basics' || !basics.name.trim()}
              onClick={() =>
                void run('basics', () =>
                  lp.updateCourse(course.id, {
                    ...basics,
                    code: basics.code.trim() || null,
                    startDate: basics.startDate || null,
                    targetDate: basics.targetDate || null,
                  })
                )
              }
            >
              {busy === 'basics' && <Spinner size={14} />}
              {t('common.save')}
            </button>
          </div>
        </Section>
      )}

      {capabilities.edit && (
        <Section title={t('lp.settings.rules')}>
          <div className="space-y-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={settings.enforceDependencies} onChange={(event) => setSettings({ ...settings, enforceDependencies: event.target.checked })} />
              <span>
                <span className="block text-[13.5px] font-semibold text-ink">{t('lp.settings.enforce')}</span>
                <span className="block text-[12.5px] text-ink-muted">{t('lp.settings.enforceHint')}</span>
              </span>
            </label>
            <NumberField label={t('lp.settings.wpm')} hint={t('lp.settings.wpmHint')} value={settings.wordsPerMinute} min={60} max={300} onChange={(value) => setSettings({ ...settings, wordsPerMinute: value })} />
            <NumberField label={t('lp.settings.riskGap')} hint={t('lp.settings.riskGapHint')} value={settings.atRiskProgressGap} min={1} max={100} onChange={(value) => setSettings({ ...settings, atRiskProgressGap: value })} />
            <NumberField label={t('lp.settings.riskDays')} hint={t('lp.settings.riskDaysHint')} value={settings.atRiskDaysBeforeTarget} min={0} max={90} onChange={(value) => setSettings({ ...settings, atRiskDaysBeforeTarget: value })} />
            <NumberField label={t('lp.settings.delayedShare')} hint={t('lp.settings.delayedShareHint')} value={Math.round(settings.delayedOverdueShare * 100)} min={1} max={100} onChange={(value) => setSettings({ ...settings, delayedOverdueShare: value / 100 })} />
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" className="btn-primary btn-sm" disabled={busy === 'rules'} onClick={() => void run('rules', () => lp.saveSettings(course.id, settings))}>
              {busy === 'rules' && <Spinner size={14} />}
              {t('common.save')}
            </button>
          </div>
        </Section>
      )}

      {capabilities.edit && <ChecklistTemplate courseId={course.id} />}

      {capabilities.archive && (
        <Section title={t('lp.settings.archiveTitle')}>
          <p className="mb-3 text-[13px] text-ink-muted">{course.archivedAt ? t('lp.settings.restoreBody') : t('lp.settings.archiveBody')}</p>
          {course.archivedAt ? (
            <button type="button" className="btn-ghost btn-sm" onClick={() => void run('archive', () => lp.restoreCourse(course.id), t('lp.toast.courseRestored'))}>
              <ArchiveRestore size={14} />
              {t('lp.restore')}
            </button>
          ) : (
            <button type="button" className="btn-danger btn-sm" onClick={() => setArchiveOpen(true)}>
              <Archive size={14} />
              {t('lp.settings.archive')}
            </button>
          )}
        </Section>
      )}

      <ConfirmDialog
        open={archiveOpen}
        title={t('lp.settings.archiveConfirmTitle', { name: course.name })}
        body={t('lp.settings.archiveBody')}
        confirmLabel={t('lp.settings.archive')}
        tone="danger"
        busy={busy === 'archive'}
        onClose={() => setArchiveOpen(false)}
        onConfirm={async () => {
          if (await run('archive', () => lp.archiveCourse(course.id), t('lp.toast.courseArchived'))) navigate('/learning-production/courses');
        }}
      />
    </div>
  );
}

function NumberField({ label, hint, value, min, max, onChange }: { label: string; hint: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="grid items-center gap-2 sm:grid-cols-[1fr_96px]">
      <span>
        <span className="block text-[13.5px] font-semibold text-ink">{label}</span>
        <span className="block text-[12.5px] text-ink-muted">{hint}</span>
      </span>
      <input type="number" className="field tabular-nums" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ChecklistTemplate({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data } = useLpQuery<{ items: ChecklistItem[]; canEdit: boolean }>(paths.checklistTemplate(courseId));
  const [items, setItems] = useState<Array<Partial<ChecklistItem> & { label: string }>>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setItems(data.items.map((item) => ({ ...item, label: item.category ? t(`lp.check.${item.category}` as never) : item.label })));
  }, [data, t]);

  const move = (index: number, delta: number) =>
    setItems((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = async () => {
    setBusy(true);
    try {
      await lp.saveChecklistTemplate(courseId, items.filter((item) => item.label.trim()));
      invalidate(paths.checklistTemplate(courseId));
      toast.push(t('lp.toast.saved'));
    } catch (error) {
      toast.push(t(lpErrorKey(error)), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('lp.settings.checklist')}>
      <p className="mb-3 text-[12.5px] text-ink-muted">{t('lp.settings.checklistHint')}</p>
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={item.id ?? `new-${index}`} className="flex items-center gap-1.5">
            <input
              className="field !min-h-9 !py-1.5"
              value={item.label}
              onChange={(event) => setItems((list) => list.map((entry, position) => (position === index ? { ...entry, label: event.target.value, category: null } : entry)))}
              aria-label={t('lp.settings.checkItem', { n: index + 1 })}
            />
            <label className="flex shrink-0 items-center gap-1 text-[12px] text-ink-muted" title={t('lp.settings.required')}>
              <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={item.required !== false} onChange={(event) => setItems((list) => list.map((entry, position) => (position === index ? { ...entry, required: event.target.checked } : entry)))} />
              <span className="hidden sm:inline">{t('lp.settings.required')}</span>
            </label>
            <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1" onClick={() => move(index, -1)} aria-label={t('lp.lessons.moveUp')} disabled={index === 0}>
              <ArrowUp size={13} />
            </button>
            <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1" onClick={() => move(index, 1)} aria-label={t('lp.lessons.moveDown')} disabled={index === items.length - 1}>
              <ArrowDown size={13} />
            </button>
            <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1" onClick={() => setItems((list) => list.filter((_, position) => position !== index))} aria-label={t('common.delete')}>
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" className="btn-ghost btn-sm" onClick={() => setItems((list) => [...list, { label: '', required: true }])}>
          <Plus size={14} />
          {t('lp.settings.addItem')}
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy}>
          {busy && <Spinner size={14} />}
          {t('common.save')}
        </button>
      </div>
    </Section>
  );
}
