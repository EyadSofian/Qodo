/**
 * Two dialogs sharing one file, because they are two genuinely different jobs.
 *
 *   Creating  — a short brief. Who does it, by when, what "done" means. Nothing
 *               about outcomes, because none exist yet: no score field, no
 *               deliverables, no review. That absence is the point.
 *
 *   Open task — a workspace. A tracker across the top so the state is readable
 *               in one glance, the actions the viewer can actually take right
 *               under it, the work and its deliverables in the main column, and
 *               the editable properties on a rail to the side.
 *
 * The old dialog was one flat form with every field in it, score included, so a
 * manager filing a task was invited to grade work that had not happened. The
 * split is what fixes that.
 */

import { useEffect, useMemo, useState } from 'react';
import { Archive, CalendarClock, MessageSquare, Send, UserRound } from 'lucide-react';
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
  getSubteams,
  translateStage,
} from '@shared/departments';
import { isDoer, isReviewer } from '@shared/workflow';
import { Avatar, Field, Modal, Spinner, useToast } from './ui';
import { ModuleIcon } from './ModuleIcon';
import {
  Deliverables,
  ScoreChip,
  StateBadge,
  SubmissionSummary,
  WorkflowActions,
  WorkflowTracker,
  returnedLabel,
  stateOf,
} from './TaskWorkflow';
import { PRIORITY_META, PRIORITY_ORDER, cx, formatDate, timeAgo } from '../lib/utils';
import type { Task, TaskAttachment, TaskComment, TaskPriority } from '../lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** `null` = create a new task; a task = open it. */
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
  const { directory } = useWorkspace();
  const { push } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [objective, setObjective] = useState('');
  const [definitionOfDone, setDefinitionOfDone] = useState('');
  const [notes, setNotes] = useState('');
  const [department, setDepartment] = useState(defaultDepartment);
  const [subteam, setSubteam] = useState('');
  const [stage, setStage] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [effortPoints, setEffortPoints] = useState('');
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [live, setLive] = useState<Task | null>(task);
  const [attachments, setAttachments] = useState<TaskAttachment[] | null>(null);
  const [canAttach, setCanAttach] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setLive(task);
    const nextDepartment = task?.department ?? defaultDepartment ?? DEFAULT_DEPARTMENT;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setObjective(task?.objective ?? '');
    setDefinitionOfDone(task?.definitionOfDone ?? '');
    setNotes(task?.notes ?? '');
    setDepartment(nextDepartment);
    setSubteam(task?.subteam ?? '');
    setStage(task?.stage ?? defaultStage ?? firstStage(nextDepartment));
    setPriority(task?.priority ?? 'normal');
    setAssigneeId(task?.assigneeId ?? '');
    setTaskDate(task?.taskDate ?? new Date().toISOString().slice(0, 10));
    setDueDate(task?.dueDate ?? '');
    setEffortPoints(task?.effortPoints ? String(task.effortPoints) : '');
    setProgress(task?.progress ?? 0);
  }, [open, task, defaultDepartment, defaultStage]);

  // Deliverables are the evidence the review is based on, so they load with the
  // task rather than behind a tab — a reviewer should never have to go looking.
  useEffect(() => {
    if (!open || !task) {
      setAttachments(null);
      return;
    }
    setAttachments(null);
    api
      .get<{ attachments: TaskAttachment[]; canAttach: boolean }>(`/tasks/${task.id}/attachments`)
      .then((data) => {
        setAttachments(data.attachments);
        setCanAttach(data.canAttach);
      })
      .catch(() => setAttachments([]));
  }, [open, task]);

  const current = live ?? task;

  /**
   * Changing department mid-edit can't keep a stage id that doesn't exist over
   * there, so the stage moves to the closest equivalent instead of resetting.
   */
  const changeDepartment = (next: string) => {
    setStage((value) => translateStage(department, value, next));
    setDepartment(next);
    setSubteam('');
    setAssigneeId('');
  };

  const subteams = getSubteams(department);
  const availableDepartments = can(PERMISSIONS.TASKS_VIEW_ALL)
    ? DEPARTMENTS
    : DEPARTMENTS.filter((item) => item.id === (user?.department ?? DEFAULT_DEPARTMENT));
  const assignees = directory.filter(
    (person) =>
      person.department === department && (!subteam || !person.subteam || person.subteam === subteam)
  );

  const editable = useMemo(() => {
    if (!current) return true;
    if (can(PERMISSIONS.TASKS_EDIT_ANY)) return true;
    return current.createdBy === user?.id || current.assigneeId === user?.id;
  }, [current, can, user]);

  // The brief and the plan are the commissioning side of the contract. Having
  // filed the task grants nothing here — only `tasks.assign` does.
  const planEditable = useMemo(
    () => !current || can(PERMISSIONS.TASKS_ASSIGN),
    [current, can]
  );

  // Clearing a task away is archiving, not deleting: the card leaves the board
  // and the record of it stays. Permanent deletion is an administrator's
  // retention decision and does not belong on this dialog at all.
  const archivable = Boolean(current) && can(PERMISSIONS.TASKS_ARCHIVE);

  const applyTask = (updated: Task) => {
    setLive(updated);
    setStage(updated.stage);
    onSaved(updated);
  };

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!title.trim()) return setError(t('tasks.titleRequired'));

    setSaving(true);
    setError('');
    // The server splits the brief from the work, and so does this form: someone
    // who cannot re-plan the task sends back only what is theirs to move.
    //
    // Posting the whole form regardless would fail on nothing worse than a
    // rounding wobble — 350 minutes is shown as 5.8 hours and would come back as
    // 348 — and the assignee would be told the plan is not theirs to change when
    // all they touched was their own progress.
    const work = { notes: notes.trim(), progress };
    const payload = planEditable
      ? {
          ...work,
          title: title.trim(),
          description: description.trim(),
          objective: objective.trim(),
          definitionOfDone: definitionOfDone.trim(),
          department,
          subteam: subteam || null,
          stage,
          priority,
          assigneeId: assigneeId || null,
          taskDate,
          dueDate: dueDate || null,
          effortPoints: effortPoints ? Number(effortPoints) : null,
        }
      : work;

    try {
      const result = current
        ? await api.patch<{ task: Task }>(`/tasks/${current.id}`, payload)
        : await api.post<{ task: Task }>('/tasks', payload);
      if (current) applyTask(result.task);
      else onSaved(result.task);
      push(current ? t('tasks.updated') : t('tasks.added'));
      onClose();
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!current) return;
    if (!window.confirm(t('tasks.confirmArchive', { title: current.title }))) return;
    try {
      await api.post(`/tasks/${current.id}/archive`, {});
      // The board only carries live work, so the card goes — but unlike the old
      // delete this is reversible, and the toast says so.
      onDeleted(current.id);
      push(t('tasks.archived'));
      onClose();
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    }
  };

  const properties = (
    <div className="grid gap-3.5">
      <Field label={t('tasks.assignee')}>
        <select
          className="field"
          value={assigneeId}
          onChange={(event) => setAssigneeId(event.target.value)}
          disabled={!planEditable}
        >
          <option value="">— {t('tasks.unassigned')} —</option>
          {assignees.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('tasks.taskDate')}>
          <input
            type="date"
            className="field ltr text-start"
            value={taskDate}
            onChange={(event) => setTaskDate(event.target.value)}
            disabled={!planEditable}
            required
          />
        </Field>
        <Field label={t('tasks.dueDate')}>
          <input
            type="date"
            className="field ltr text-start"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            disabled={!planEditable}
          />
        </Field>
      </div>

      {/* Priority pairs with effort points, and effort points are now the only
          size estimate. Asking for hours as well was two units for one
          judgement, and the two had to survive a round-trip through the form or
          an ordinary save came back as a rejected plan change. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('tasks.priority')}>
          <select
            className="field"
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
            disabled={!planEditable}
          >
            {PRIORITY_ORDER.map((key) => (
              <option key={key} value={key}>
                {t(PRIORITY_META[key].key)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('tasks.effortPoints')}>
          <select
            className="field"
            value={effortPoints}
            onChange={(event) => setEffortPoints(event.target.value)}
            disabled={!planEditable}
          >
            <option value="">—</option>
            {[1, 2, 3, 5, 8, 13].map((points) => (
              <option key={points} value={points}>
                {points}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {current && (
        <Field label={t('tasks.progress')} hint={`${progress}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(event) => setProgress(Number(event.target.value))}
            disabled={!editable}
            className="ltr h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-sunken accent-brand-500"
          />
        </Field>
      )}

      <Field label={t('tasks.department')} hint={current ? undefined : t('tasks.departmentHint')}>
        <select
          className="field"
          value={department}
          onChange={(event) => changeDepartment(event.target.value)}
          disabled={!planEditable}
        >
          {availableDepartments.map((d) => (
            <option key={d.id} value={d.id}>
              {lang === 'en' ? d.en : d.ar}
            </option>
          ))}
        </select>
      </Field>

      {subteams.length > 0 && (
        <Field label={t('tasks.subteam')}>
          <select
            className="field"
            value={subteam}
            onChange={(event) => {
              setSubteam(event.target.value);
              setAssigneeId('');
            }}
            disabled={!planEditable}
          >
            <option value="">— {t('tasks.noSubteam')} —</option>
            {subteams.map((team: { id: string; ar: string; en: string }) => (
              <option key={team.id} value={team.id}>
                {lang === 'en' ? team.en : team.ar}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* No stage picker. The stage is the result of an action — start it, hand
          it in, review it — and the tracker above already says where the task
          is. For the person doing the work the dropdown listed exactly one
          option, which is a field that can only ever say what you already know. */}
    </div>
  );

  const errorBox = error ? (
    <p
      role="alert"
      className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad"
    >
      {error}
    </p>
  ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={current ? 'xl' : 'md'}
      title={current ? t('tasks.detail') : t('tasks.new')}
      footer={
        <>
          {archivable && (
            <button type="button" onClick={archive} className="btn-danger btn-sm me-auto">
              <Archive size={15} />
              {t('tasks.archive')}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">
            {editable ? t('common.cancel') : t('common.close')}
          </button>
          {editable && (
            <button
              type={current ? 'button' : 'submit'}
              form={current ? undefined : 'task-form'}
              onClick={current ? () => submit() : undefined}
              className="btn-primary btn-sm"
              disabled={saving}
            >
              {saving && <Spinner size={15} />}
              {current ? t('common.save') : t('common.add')}
            </button>
          )}
        </>
      }
    >
      {current ? (
        // `min-w-0` throughout: a grid track sizes to its widest child by
        // default, and one wide row would push the whole dialog sideways.
        <div className="grid min-w-0 gap-5">
          {/* The title is what the task *asks for*, so it belongs to the brief
              and not to whoever is carrying it — same rule the server applies
              through `PLAN_FIELDS`. */}
          <TaskHeading
            task={current}
            title={title}
            editable={planEditable}
            onTitle={setTitle}
          />

          <div className="min-w-0 rounded-2xl border border-surface-line bg-surface-sunken/40 p-3 sm:p-4">
            <WorkflowTracker task={current} />
            <div className="mt-4">
              <WorkflowActions
                task={current}
                attachmentCount={attachments?.length ?? current.attachmentCount ?? 0}
                onChanged={applyTask}
              />
            </div>
          </div>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="grid min-w-0 gap-5">
              <Field label={t('tasks.descField')}>
                <textarea
                  className="field min-h-[92px] resize-y"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t('tasks.descPlaceholder')}
                  disabled={!planEditable}
                />
              </Field>

              <Field label={t('tasks.objective')}>
                <textarea
                  className="field min-h-[72px] resize-y"
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                  placeholder={t('tasks.objectivePlaceholder')}
                  disabled={!planEditable}
                />
              </Field>

              <Field label={t('tasks.definitionOfDone')}>
                <textarea
                  className="field min-h-[72px] resize-y"
                  value={definitionOfDone}
                  onChange={(event) => setDefinitionOfDone(event.target.value)}
                  placeholder={t('tasks.definitionOfDonePlaceholder')}
                  disabled={!planEditable}
                />
              </Field>

              <Field label={t('tasks.notes')}>
                <textarea
                  className="field min-h-[64px] resize-y"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={t('tasks.notesPlaceholder')}
                  disabled={!editable}
                />
              </Field>

              {stateOf(current) === 'submitted' && <SubmissionSummary task={current} />}

              <Deliverables
                task={current}
                attachments={attachments}
                canAttach={canAttach}
                onChanged={(list) => {
                  setAttachments(list);
                  setLive((value) =>
                    value ? { ...value, attachmentCount: list.length } : value
                  );
                }}
              />

              {errorBox}
            </div>

            <aside className="grid gap-5 lg:border-s lg:border-surface-line lg:ps-5">
              <div>
                <h3 className="mb-3 text-[13px] font-bold text-ink">{t('flow.properties')}</h3>
                {properties}
              </div>
              <Timeline task={current} />
            </aside>
          </div>

          <Comments taskId={current.id} />
        </div>
      ) : (
        <form id="task-form" onSubmit={submit} className="grid gap-3.5">
          <p className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-brand-700">
            {t('tasks.newHint')}
          </p>

          <Field label={t('tasks.titleField')} required>
            <input
              className="field"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('tasks.titlePlaceholder')}
              autoFocus
              required
            />
          </Field>

          <Field label={t('tasks.descField')}>
            <textarea
              className="field min-h-[92px] resize-y"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('tasks.descPlaceholder')}
            />
          </Field>

          <Field label={t('tasks.objective')}>
            <textarea
              className="field min-h-[72px] resize-y"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder={t('tasks.objectivePlaceholder')}
            />
          </Field>

          <Field label={t('tasks.definitionOfDone')}>
            <textarea
              className="field min-h-[72px] resize-y"
              value={definitionOfDone}
              onChange={(event) => setDefinitionOfDone(event.target.value)}
              placeholder={t('tasks.definitionOfDonePlaceholder')}
            />
          </Field>

          {properties}

          <Field label={t('tasks.notes')}>
            <textarea
              className="field min-h-[64px] resize-y"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t('tasks.notesPlaceholder')}
            />
          </Field>

          {errorBox}
        </form>
      )}
    </Modal>
  );
}

/* ── heading ─────────────────────────────────────────────────────── */

function TaskHeading({
  task,
  title,
  editable,
  onTitle,
}: {
  task: Task;
  title: string;
  editable: boolean;
  onTitle: (value: string) => void;
}) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const department = getDepartment(task.department ?? DEFAULT_DEPARTMENT);
  const priority = PRIORITY_META[task.priority];

  return (
    <header>
      <input
        value={title}
        onChange={(event) => onTitle(event.target.value)}
        disabled={!editable}
        aria-label={t('tasks.titleField')}
        className={cx(
          'w-full rounded-lg border border-transparent bg-transparent px-1.5 py-1',
          'text-[18px] font-extrabold leading-snug text-ink sm:text-[21px]',
          'transition-colors focus:border-surface-line focus:bg-white focus:outline-none',
          editable && 'hover:border-surface-line'
        )}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1.5">
        {task.reference && (
          <span className="chip ltr bg-surface-sunken font-mono text-ink-muted">
            {task.reference}
          </span>
        )}
        <span
          className="chip"
          style={{ background: `${department.color}18`, color: department.color }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: department.color }} />
          {lang === 'en' ? department.en : department.ar}
        </span>
        <StateBadge task={task} forReviewer={isReviewer(user) && !isDoer(user, task)} />
        {task.priority !== 'normal' && (
          <span className={cx('chip', priority.className)}>{t(priority.key)}</span>
        )}
        {task.reworkCount > 0 && (
          <span className="chip bg-surface-sunken text-ink-muted">
            {returnedLabel(task.reworkCount, t)}
          </span>
        )}
        {task.score !== null && task.score !== undefined && <ScoreChip score={task.score} size="sm" />}
      </div>
    </header>
  );
}

/* ── timeline ────────────────────────────────────────────────────── */

/** Dates, in the order they happened. The audit trail a manager asks for. */
function Timeline({ task }: { task: Task }) {
  const { t, lang } = useI18n();
  const { userById } = useWorkspace();

  const rows = [
    { key: 'flow.createdOn' as const, at: task.createdAt, who: task.createdBy },
    { key: 'assignment.assignedOn' as const, at: task.assignedAt, who: task.assignedBy },
    { key: 'assignment.acceptedOn' as const, at: task.acceptedAt, who: task.assigneeId },
    { key: 'assignment.declinedOn' as const, at: task.declinedAt, who: task.assigneeId },
    { key: 'flow.startedOn' as const, at: task.startedAt, who: task.assigneeId },
    { key: 'flow.submittedOn' as const, at: task.submittedAt, who: task.submittedBy },
    { key: 'flow.reviewedOn' as const, at: task.reviewedAt, who: task.reviewedBy },
  ].filter((row) => row.at);

  return (
    <div>
      <h3 className="mb-2.5 text-[13px] font-bold text-ink">{t('flow.timeline')}</h3>
      <ul className="grid gap-2">
        {rows.map((row) => {
          const person = userById(row.who);
          return (
            <li key={row.key} className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="font-semibold text-ink-muted">{t(row.key)}</span>
              <span className="text-end text-ink-faint">
                <span className="block">{formatDate(row.at, lang)}</span>
                {person && <span className="block text-[11px]">{person.name}</span>}
              </span>
            </li>
          );
        })}
        {task.dueDate && (
          <li className="flex items-baseline justify-between gap-2 border-t border-surface-line pt-2 text-[12px]">
            <span className="inline-flex items-center gap-1 font-semibold text-ink-muted">
              <CalendarClock size={13} />
              {t('tasks.dueDate')}
            </span>
            <span className="text-ink-faint">{formatDate(task.dueDate, lang)}</span>
          </li>
        )}
      </ul>
    </div>
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
    <section className="border-t border-surface-line pt-4">
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
                <div
                  className={cx(
                    'min-w-0 flex-1 rounded-xl px-3 py-2',
                    mine ? 'bg-brand-50' : 'bg-surface-sunken'
                  )}
                >
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
      {assignee ? (
        <span className="inline-flex items-center gap-1">
          <Avatar name={assignee.name} color={assignee.avatarColor} size={16} />
          {assignee.name.split(/\s+/)[0]}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <UserRound size={12} />
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
