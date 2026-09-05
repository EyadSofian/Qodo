/**
 * Create a task, or a subtask of one.
 *
 * The same dialog for both, because the only difference is a parent id the
 * caller already knows — a separate "add subtask" form would be the same fields
 * twice with one extra hidden field, and the second copy is where the two
 * would drift.
 */

import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/api';
import { projectTasksApi } from '../../lib/projects/api';
import type { TaskList } from '../../lib/projects/types';
import { Field, Modal, Spinner } from '../ui';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export function TaskCreateDialog({
  open,
  projectId,
  taskLists,
  parentTaskId,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  taskLists: TaskList[];
  parentTaskId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, lang } = useI18n();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [taskListId, setTaskListId] = useState('');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('normal');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [durationDays, setDurationDays] = useState('1');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setTitle('');
    setDescription('');
    setTaskListId('');
    setPriority('normal');
    setStartDate('');
    setEndDate('');
    setDurationDays('1');
    setEstimatedHours('');
    setError(null);
  }, [open]);

  const datesInverted = Boolean(startDate && endDate && endDate < startDate);
  const canSubmit = title.trim().length > 0 && !datesInverted && !saving;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await projectTasksApi.create(projectId, {
        title: title.trim(),
        description: description.trim(),
        taskListId: taskListId || null,
        parentTaskId: parentTaskId ?? null,
        priority,
        startDate: startDate || null,
        endDate: endDate || null,
        durationDays: Math.max(1, Number(durationDays) || 1),
        estimatedHours: estimatedHours ? Number(estimatedHours) : null,
      });
      onCreated();
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={parentTaskId ? t('projectTasks.newSubtask') : t('projectTasks.new')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="task-create" className="btn-primary btn-sm" disabled={!canSubmit}>
            {saving && <Spinner size={15} />}
            {t('common.add')}
          </button>
        </>
      }
    >
      <form id="task-create" onSubmit={submit} className="grid gap-4">
        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}

        <Field label={t('projectTasks.field.title')} required>
          <input
            className="field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
            required
            maxLength={200}
          />
        </Field>

        <Field label={t('projects.field.description')}>
          <textarea
            className="field min-h-[72px] resize-y"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4000}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('projectTasks.field.list')}>
            <select
              className="field"
              value={taskListId}
              onChange={(event) => setTaskListId(event.target.value)}
            >
              <option value="">{t('taskLists.unfiled')}</option>
              {taskLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('projectTasks.field.priority')}>
            <select
              className="field"
              value={priority}
              onChange={(event) => setPriority(event.target.value as (typeof PRIORITIES)[number])}
            >
              {PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {t(`priority.${option}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('projects.field.startDate')}>
            <input
              type="date"
              className="field"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field
            label={t('projects.field.endDate')}
            error={datesInverted ? t('projects.error.endBeforeStart') : undefined}
          >
            <input
              type="date"
              className="field"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              min={startDate || undefined}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('projectTasks.field.duration')}
            // Working days, not calendar days — a five-day task starting
            // Thursday does not finish on Monday. Worth saying on the form,
            // because the number looks like calendar days.
            hint={lang === 'en' ? 'Working days, Sunday to Thursday.' : 'أيام عمل، من الأحد للخميس.'}
          >
            <input
              type="number"
              min={1}
              max={999}
              className="field"
              value={durationDays}
              onChange={(event) => setDurationDays(event.target.value)}
            />
          </Field>
          <Field label={t('projectTasks.field.estimated')}>
            <input
              type="number"
              min={0}
              step="0.25"
              className="field"
              value={estimatedHours}
              onChange={(event) => setEstimatedHours(event.target.value)}
            />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
