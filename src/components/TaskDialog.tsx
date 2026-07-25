import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, Send, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { PERMISSIONS } from '@shared/permissions';
import {
  DEFAULT_DEPARTMENT,
  DEPARTMENTS,
  firstStage,
  getDepartment,
  getStages,
  translateStage,
} from '@shared/departments';
import { Avatar, Field, Modal, Spinner, useToast } from './ui';
import { ModuleIcon } from './ModuleIcon';
import { PRIORITY_META, PRIORITY_ORDER, cx, timeAgo } from '../lib/utils';
import type { Task, TaskComment, TaskPriority } from '../lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** `null` = create a new task; a task = edit it. */
  task: Task | null;
  defaultDepartment: string;
  /** Column the "+" was pressed in, so a new card lands where it was asked for. */
  defaultStage: string | null;
  onSaved: (task: Task) => void;
  onDeleted: (id: string) => void;
}

export function TaskDialog({
  open,
  onClose,
  task,
  defaultDepartment,
  defaultStage,
  onSaved,
  onDeleted,
}: Props) {
  const { user, can } = useAuth();
  const { t, lang } = useI18n();
  const { directory, apps } = useWorkspace();
  const { push } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState(defaultDepartment);
  const [stage, setStage] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [appId, setAppId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    const nextDepartment = task?.department ?? defaultDepartment ?? DEFAULT_DEPARTMENT;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setDepartment(nextDepartment);
    setStage(task?.stage ?? defaultStage ?? firstStage(nextDepartment));
    setPriority(task?.priority ?? 'normal');
    setAssigneeId(task?.assigneeId ?? '');
    setAppId(task?.appId ?? '');
    setDueDate(task?.dueDate ?? '');
  }, [open, task, defaultDepartment, defaultStage]);

  /**
   * Changing department mid-edit can't keep a stage id that doesn't exist over
   * there, so the stage moves to the closest equivalent instead of resetting.
   */
  const changeDepartment = (next: string) => {
    setStage((current) => translateStage(department, current, next));
    setDepartment(next);
  };

  const stages = getStages(department);

  const editable = useMemo(() => {
    if (!task) return true;
    if (can(PERMISSIONS.TASKS_EDIT_ANY)) return true;
    return task.createdBy === user?.id || task.assigneeId === user?.id;
  }, [task, can, user]);

  const deletable = task && (can(PERMISSIONS.TASKS_DELETE_ANY) || task.createdBy === user?.id);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError(t('tasks.titleRequired'));

    setSaving(true);
    setError('');
    const payload = {
      title: title.trim(),
      description: description.trim(),
      department,
      stage,
      priority,
      assigneeId: assigneeId || null,
      appId: appId || null,
      dueDate: dueDate || null,
    };

    try {
      const result = task
        ? await api.patch<{ task: Task }>(`/tasks/${task.id}`, payload)
        : await api.post<{ task: Task }>('/tasks', payload);
      onSaved(result.task);
      push(task ? t('tasks.updated') : t('tasks.added'));
      onClose();
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    if (!window.confirm(t('tasks.confirmDelete', { title: task.title }))) return;
    try {
      await api.delete(`/tasks/${task.id}`);
      onDeleted(task.id);
      push(t('tasks.deleted'));
      onClose();
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title={task ? t('tasks.detail') : t('tasks.new')}
      footer={
        <>
          {deletable && (
            <button type="button" onClick={remove} className="btn-danger btn-sm me-auto">
              <Trash2 size={15} />
              {t('common.delete')}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">
            {editable ? t('common.cancel') : t('common.close')}
          </button>
          {editable && (
            <button type="submit" form="task-form" className="btn-primary btn-sm" disabled={saving}>
              {saving && <Spinner size={15} />}
              {task ? t('common.save') : t('common.add')}
            </button>
          )}
        </>
      }
    >
      <form id="task-form" onSubmit={submit} className="grid gap-3.5">
        <Field label={t('tasks.titleField')} required>
          <input
            className="field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('tasks.titlePlaceholder')}
            disabled={!editable}
            autoFocus={!task}
            required
          />
        </Field>

        <Field label={t('tasks.descField')}>
          <textarea
            className="field min-h-[92px] resize-y"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('tasks.descPlaceholder')}
            disabled={!editable}
          />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label={t('tasks.department')} hint={t('tasks.departmentHint')}>
            <select
              className="field"
              value={department}
              onChange={(event) => changeDepartment(event.target.value)}
              disabled={!editable}
            >
              {DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {lang === 'en' ? d.en : d.ar}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('tasks.stage')}>
            <select
              className="field"
              value={stage}
              onChange={(event) => setStage(event.target.value)}
              disabled={!editable}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {lang === 'en' ? s.en : s.ar}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('tasks.priority')}>
            <select
              className="field"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
              disabled={!editable}
            >
              {PRIORITY_ORDER.map((key) => (
                <option key={key} value={key}>
                  {t(PRIORITY_META[key].key)}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('tasks.assignee')}>
            <select
              className="field"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              disabled={!editable}
            >
              <option value="">— {t('tasks.unassigned')} —</option>
              {directory.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('tasks.dueDate')}>
            <input
              type="date"
              className="field ltr text-start"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              disabled={!editable}
            />
          </Field>

          <Field label={t('tasks.relatedApp')} hint={t('tasks.relatedAppHint')}>
            <select
              className="field"
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              disabled={!editable}
            >
              <option value="">— {t('tasks.noRelatedApp')} —</option>
              {apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {lang === 'en' && app.nameEn ? app.nameEn : app.nameAr}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}
      </form>

      {task && <Comments taskId={task.id} />}
    </Modal>
  );
}

/* ── Comments ────────────────────────────────────────────────────── */

function Comments({ taskId }: { taskId: string }) {
  const { userById } = useWorkspace();
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const { push } = useToast();
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setComments(null);
    api
      .get<{ comments: TaskComment[] }>(`/tasks/${taskId}/comments`)
      .then((data) => setComments(data.comments))
      .catch(() => setComments([]));
  }, [taskId]);

  const send = async (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      const { comment } = await api.post<{ comment: TaskComment }>(`/tasks/${taskId}/comments`, {
        body: text,
      });
      setComments((list) => [...(list ?? []), comment]);
      setBody('');
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mt-6 border-t border-surface-line pt-4">
      <h3 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-ink">
        <MessageSquare size={15} className="text-brand-500" />
        {t('tasks.comments')}
        {comments && comments.length > 0 && (
          <span className="rounded-full bg-surface-sunken px-2 text-[11px] text-ink-muted">
            {comments.length}
          </span>
        )}
      </h3>

      {comments === null ? (
        <div className="skeleton h-14" />
      ) : comments.length === 0 ? (
        <p className="text-[12.5px] text-ink-faint">{t('tasks.noComments')}</p>
      ) : (
        <ul className="grid gap-3">
          {comments.map((comment) => {
            const author = userById(comment.userId);
            const mine = comment.userId === user?.id;
            return (
              <li key={comment.id} className="flex gap-2.5">
                <Avatar name={author?.name ?? '?'} color={author?.avatarColor} size={30} className="mt-0.5" />
                <div className={cx('min-w-0 flex-1 rounded-xl px-3 py-2', mine ? 'bg-brand-50' : 'bg-surface-sunken')}>
                  <p className="flex items-baseline gap-2 text-[12px]">
                    <span className="font-bold text-ink">{author?.name ?? t('common.removedUser')}</span>
                    <span className="text-ink-faint">{timeAgo(comment.createdAt, t)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">
                    {comment.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={send} className="mt-3 flex items-end gap-2">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter for a new line — the messaging default.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={t('tasks.commentPlaceholder')}
          className="field max-h-28 min-h-[44px] flex-1 resize-y py-3"
        />
        <button type="submit" className="btn-primary !min-h-[44px] px-3.5" disabled={sending || !body.trim()}>
          {sending ? <Spinner size={16} /> : <Send size={16} />}
        </button>
      </form>
    </section>
  );
}

/** Compact task summary — used by the board card and the app-tagged lists. */
export function TaskMeta({ task }: { task: Task }) {
  const { appById, userById } = useWorkspace();
  const { lang } = useI18n();
  const app = appById(task.appId);
  const assignee = userById(task.assigneeId);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
      {assignee && (
        <span className="inline-flex items-center gap-1">
          <Avatar name={assignee.name} color={assignee.avatarColor} size={16} />
          {assignee.name.split(/\s+/)[0]}
        </span>
      )}
      {app && (
        <span className="inline-flex items-center gap-1">
          <ModuleIcon name={app.icon} color={app.color} size={12} variant="plain" />
          {lang === 'en' && app.nameEn ? app.nameEn : app.nameAr}
        </span>
      )}
    </div>
  );
}

// Re-exported so the board can colour cards by department without a second import.
export { getDepartment };
