/**
 * The lifecycle, drawn.
 *
 * Everything here answers one question for whoever is looking: *what happens
 * next, and is it mine to do?* So the pieces are state-aware rather than
 * role-agnostic — an employee sees a submit gate where a manager sees a review
 * gate, and neither sees a field the other owns.
 *
 * The two gates are deliberately inline panels rather than nested modals: the
 * decision is made while looking at the deliverables, and a dialog on top of a
 * dialog would hide exactly the thing being judged.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Download,
  ExternalLink,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Link2 as LinkIcon,
  Paperclip,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  UserRoundX,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import {
  MAX_ATTACHMENT_BYTES,
  SCORE_BANDS,
  canPublish,
  canReopen,
  canReview,
  canRespondToAssignment,
  canStart,
  canSubmit,
  hasSignoffStage,
  isDoer,
  isReviewer,
  scoreBand,
  submittedOnTime,
  taskState,
} from '@shared/workflow';
import { Avatar, Field, Spinner, useToast } from './ui';
import { cx, formatBytes, scoreTextTone, scoreTone, timeAgo } from '../lib/utils';
import type { StringKey } from '../lib/i18n';
import type { Task, TaskAttachment, TaskState } from '../lib/types';

const STATE_LABEL: Record<TaskState, StringKey> = {
  assigned: 'flow.assigned',
  working: 'flow.working',
  submitted: 'flow.submitted',
  signed_off: 'flow.signedOff',
  approved: 'flow.approved',
};

/**
 * The steps the tracker draws. `signed_off` is dropped on boards that have no
 * sign-off column, so a sales task still shows four steps rather than a fifth
 * one it can never reach.
 */
const STATE_ORDER: TaskState[] = ['assigned', 'working', 'submitted', 'signed_off', 'approved'];

const orderFor = (task: Task): TaskState[] =>
  hasSignoffStage(task.department ?? 'general')
    ? STATE_ORDER
    : STATE_ORDER.filter((state) => state !== 'signed_off');

export function stateOf(task: Task): TaskState {
  return taskState(task) as TaskState;
}

/* ── small shared pieces ─────────────────────────────────────────── */

/** The score, and the word that goes with it — a bare number invites its own scale. */
export function ScoreChip({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }) {
  const { lang } = useI18n();
  const band = scoreBand(score);
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg font-extrabold tabular-nums',
        scoreTone(score),
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[13px]'
      )}
    >
      <span className="ltr">{score}</span>
      {band && <span className="font-semibold opacity-80">{lang === 'en' ? band.en : band.ar}</span>}
    </span>
  );
}

/** Where the task is, said plainly. Used on cards, in the table and in the header. */
export function StateBadge({ task, forReviewer }: { task: Task; forReviewer?: boolean }) {
  const { t } = useI18n();
  const state = stateOf(task);
  const returned = state === 'working' && task.reviewDecision === 'changes_requested';

  if (returned) {
    return (
      <span className="chip bg-status-warnBg text-accent-600">
        <RotateCcw size={12} />
        {t('flow.returnedBadge')}
      </span>
    );
  }
  if (state === 'submitted') {
    return (
      <span className="chip bg-status-infoBg text-brand-600">
        <Clock3 size={12} />
        {forReviewer ? t('flow.awaitingYou') : t('flow.awaitingManager')}
      </span>
    );
  }
  if (state === 'signed_off') {
    return (
      <span className="chip bg-status-okBg text-status-ok">
        <ShieldCheck size={12} />
        {t('flow.signedOff')}
      </span>
    );
  }
  if (state === 'approved') {
    return (
      <span className="chip bg-status-okBg text-status-ok">
        <ShieldCheck size={12} />
        {t('flow.approved')}
      </span>
    );
  }
  return <span className="chip bg-surface-sunken text-ink-muted">{t(STATE_LABEL[state])}</span>;
}

/** Arabic counts one, two and many differently — so the rework badge does too. */
export function returnedLabel(count: number, t: (key: StringKey, vars?: Record<string, string | number>) => string) {
  if (count === 1) return t('flow.returnedOnce');
  if (count === 2) return t('flow.returnedTwice');
  return t('flow.returnedTimes', { n: count });
}

/* ── the tracker ─────────────────────────────────────────────────── */

/**
 * Four dots and three lines — five on a board that separates sign-off from
 * delivery. It exists because "which column is it in" answers where the card
 * is, not who is holding it up: the tracker names the holder at every step,
 * including the return arrow when work has come back.
 */
export function WorkflowTracker({ task }: { task: Task }) {
  const { t } = useI18n();
  const state = stateOf(task);
  const steps = orderFor(task);
  const reached = steps.indexOf(state);
  const returned =
    task.reviewDecision === 'changes_requested' &&
    state !== 'approved' &&
    state !== 'signed_off';

  return (
    <ol className="flex w-full items-start gap-0" aria-label={t('flow.timeline')}>
      {steps.map((step, index) => {
        const done = index < reached;
        const current = index === reached;
        return (
          <li key={step} className={cx('flex min-w-0 items-start', index > 0 && 'flex-1')}>
            {index > 0 && (
              <span
                aria-hidden
                className={cx(
                  'mt-[13px] h-[3px] flex-1 rounded-full transition-colors',
                  done || current ? 'bg-brand-400' : 'bg-surface-line'
                )}
              />
            )}
            {/* The steps have to fit a 375px phone, connectors and all, so the
                labels wrap rather than the rail overflowing — and they get
                narrower when a board declares the fifth one. */}
            <span
              className={cx(
                'flex shrink-0 flex-col items-center gap-1.5',
                steps.length > 4 ? 'w-[3.4rem] sm:w-20' : 'w-[4.25rem] sm:w-24'
              )}
            >
              <span
                className={cx(
                  'grid h-7 w-7 place-items-center rounded-full border-2 text-[11px] font-extrabold transition-colors',
                  done && 'border-brand-500 bg-brand-500 text-white',
                  current && !returned && 'border-brand-500 bg-white text-brand-600 ring-4 ring-brand-100',
                  current && returned && 'border-accent-500 bg-white text-accent-600 ring-4 ring-accent-50',
                  !done && !current && 'border-surface-line bg-white text-ink-faint'
                )}
              >
                {done ? <CheckCircle2 size={15} /> : current && returned ? <RotateCcw size={13} /> : index + 1}
              </span>
              <span
                className={cx(
                  'text-center text-[10.5px] font-bold leading-tight sm:text-[11.5px]',
                  current ? 'text-ink' : done ? 'text-ink-muted' : 'text-ink-faint'
                )}
              >
                {t(STATE_LABEL[step])}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ── deliverables ────────────────────────────────────────────────── */

/** A link's host is the part that tells you what it is: a sheet, a drive, a post. */
function hostOf(url: string | null) {
  try {
    return new URL(url ?? '').hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function iconFor(type: string) {
  if (type.startsWith('image/')) return FileImage;
  if (type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv') {
    return FileSpreadsheet;
  }
  if (type === 'application/pdf' || type.startsWith('text/') || type.includes('word')) return FileText;
  return FileIcon;
}

export function Deliverables({
  task,
  attachments,
  canAttach,
  onChanged,
}: {
  task: Task;
  attachments: TaskAttachment[] | null;
  canAttach: boolean;
  onChanged: (attachments: TaskAttachment[]) => void;
}) {
  const { t, lang } = useI18n();
  const { userById } = useWorkspace();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const send = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;
    setBusy(true);
    let current = attachments ?? [];
    try {
      for (const file of list) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          push(t('flow.fileLimit'), 'bad');
          continue;
        }
        const { attachment } = await api.upload<{ attachment: TaskAttachment }>(
          `/tasks/${task.id}/attachments`,
          file
        );
        current = [...current, attachment];
        onChanged(current);
      }
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = '';
    }
  };

  /**
   * Much of this company's output lives at an address rather than in a file —
   * the campaign sheet, the Drive folder, the post that went live. Pasting the
   * link satisfies the same gate an upload does.
   */
  const sendLink = async () => {
    const url = window.prompt(t('flow.linkPrompt'))?.trim();
    if (!url) return;
    setBusy(true);
    try {
      const { attachment } = await api.post<{ attachment: TaskAttachment }>(
        `/tasks/${task.id}/attachments/link`,
        { url }
      );
      onChanged([...(attachments ?? []), attachment]);
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (attachment: TaskAttachment) => {
    if (!window.confirm(t('flow.confirmRemoveFile', { name: attachment.name }))) return;
    try {
      await api.delete(`/tasks/${task.id}/attachments/${attachment.id}`);
      onChanged((attachments ?? []).filter((item) => item.id !== attachment.id));
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    }
  };

  return (
    <section>
      <h3 className="mb-1 flex items-center gap-2 text-[13px] font-bold text-ink">
        <Paperclip size={15} className="text-brand-500" />
        {t('flow.deliverables')}
        {attachments && attachments.length > 0 && (
          <span className="rounded-full bg-surface-sunken px-2 text-[11px] tabular-nums text-ink-muted">
            {attachments.length}
          </span>
        )}
      </h3>
      <p className="mb-3 text-[12px] leading-relaxed text-ink-faint">{t('flow.deliverablesHint')}</p>

      {attachments === null ? (
        <div className="skeleton h-16" />
      ) : attachments.length === 0 ? (
        <p className="rounded-xl border border-dashed border-surface-line px-3 py-4 text-center text-[12.5px] text-ink-faint">
          {t('flow.noDeliverables')}
        </p>
      ) : (
        <ul className="grid gap-2">
          {attachments.map((attachment) => {
            const link = attachment.kind === 'link' && attachment.url;
            const Icon = link ? LinkIcon : iconFor(attachment.type);
            const owner = userById(attachment.userId);
            return (
              <li
                key={attachment.id}
                className="flex items-center gap-3 rounded-xl border border-surface-line bg-white px-3 py-2.5"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">
                    {attachment.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-faint">
                    <span className="ltr truncate">
                      {link ? hostOf(attachment.url) : formatBytes(attachment.size)}
                    </span>
                    <span>{t('flow.uploadedBy', { name: owner?.name ?? t('common.removedUser') })}</span>
                    <span>{timeAgo(attachment.createdAt, t)}</span>
                  </span>
                </span>
                {/* A deliverable link points wherever the employee pasted it,
                    so `noopener` keeps it from getting a handle on this tab. */}
                <a
                  href={link ? attachment.url! : `/api/tasks/${task.id}/attachments/${attachment.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-quiet !min-h-9 shrink-0 rounded-lg px-2"
                  aria-label={attachment.name}
                >
                  {link ? <ExternalLink size={16} /> : <Download size={16} />}
                </a>
                {canAttach && (
                  <button
                    type="button"
                    onClick={() => remove(attachment)}
                    className="btn-quiet !min-h-9 shrink-0 rounded-lg px-2 hover:text-status-bad"
                    aria-label={t('flow.removeFile')}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAttach && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void send(event.dataTransfer.files);
          }}
          className={cx(
            'mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-3 py-2.5 transition-colors',
            dragging ? 'border-brand-400 bg-brand-50/70' : 'border-surface-line bg-surface-sunken/50'
          )}
        >
          <span className="text-[11.5px] text-ink-faint">{t('flow.fileLimit')}</span>
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void sendLink()}
              disabled={busy}
              className="btn-ghost btn-sm gap-1.5"
            >
              <LinkIcon size={15} />
              {t('flow.addLink')}
            </button>
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={busy}
              className="btn-ghost btn-sm gap-1.5"
            >
              {busy ? <Spinner size={15} /> : <Upload size={15} />}
              {busy ? t('flow.uploading') : t('flow.addFile')}
            </button>
          </span>
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => event.target.files && void send(event.target.files)}
          />
        </div>
      )}
    </section>
  );
}

/* ── what happened last ──────────────────────────────────────────── */

/** The last verdict, for whoever is allowed to read it. Feedback, not news. */
export function ReviewVerdict({ task }: { task: Task }) {
  const { t } = useI18n();
  const { userById } = useWorkspace();
  const approved = task.reviewDecision === 'approved';
  const reviewer = userById(task.reviewedBy);
  if (!task.reviewDecision) return null;

  return (
    <div
      className={cx(
        'rounded-xl border p-3.5',
        approved ? 'border-status-ok/25 bg-status-okBg/60' : 'border-accent-500/25 bg-status-warnBg/70'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cx(
            'inline-flex items-center gap-1.5 text-[12.5px] font-bold',
            approved ? 'text-status-ok' : 'text-accent-600'
          )}
        >
          {approved ? <ShieldCheck size={15} /> : <RotateCcw size={15} />}
          {approved ? t('flow.verdictApproved') : t('flow.verdictChanges')}
        </span>
        <span className="text-[11.5px] text-ink-faint">
          {reviewer ? `${reviewer.name} · ` : ''}
          {timeAgo(task.reviewedAt, t)}
        </span>
      </div>
      {task.score !== null && task.score !== undefined && (
        <div className="mt-2">
          <ScoreChip score={task.score} />
        </div>
      )}
      {task.reviewNote && (
        <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">
          {task.reviewNote}
        </p>
      )}
    </div>
  );
}

/** What the assignee said they handed in, and whether it beat the deadline. */
export function SubmissionSummary({ task }: { task: Task }) {
  const { t } = useI18n();
  const { userById } = useWorkspace();
  if (!task.submittedAt) return null;
  const author = userById(task.submittedBy);
  const onTime = submittedOnTime(task);

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {author && <Avatar name={author.name} color={author.avatarColor} size={22} />}
        <span className="text-[12.5px] font-semibold text-ink">
          {t('flow.submittedBy', {
            name: author?.name ?? t('common.removedUser'),
            when: timeAgo(task.submittedAt, t),
          })}
        </span>
        {onTime !== null && (
          <span className={cx('chip', onTime ? 'bg-status-okBg text-status-ok' : 'bg-status-badBg text-status-bad')}>
            {onTime ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {onTime ? t('flow.onTime') : t('flow.late')}
          </span>
        )}
      </div>
      {task.submissionNote && (
        <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">
          {task.submissionNote}
        </p>
      )}
    </div>
  );
}

/* ── the gates ───────────────────────────────────────────────────── */

/**
 * The action rail. One card, and it only ever shows the moves the person
 * looking at it can actually make — which is why the score input simply does
 * not exist for anyone but a manager holding a submitted task.
 */
export function WorkflowActions({
  task,
  attachmentCount,
  onChanged,
}: {
  task: Task;
  attachmentCount: number;
  onChanged: (task: Task) => void;
}) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const { push } = useToast();
  const [open, setOpen] = useState<'submit' | 'review' | null>(null);
  const [busy, setBusy] = useState(false);

  const state = stateOf(task);
  const reviewer = isReviewer(user);
  const doer = isDoer(user, task);
  const ownsAssignment = canRespondToAssignment(user, task);
  const awaitingAssignment =
    Boolean(task.assigneeId) && task.assignmentStatus !== 'accepted';

  // Coming back from a return, the panel should already be open — the person
  // has one thing to do and it is not "find the button again".
  useEffect(() => {
    setOpen(null);
  }, [task.id]);

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const { task: updated } = await api.post<{ task: Task }>(`/tasks/${task.id}/${path}`, body ?? {});
      onChanged(updated);
      return true;
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (await act('start')) push(t('flow.started.toast'));
  };

  const reopen = async () => {
    if (!window.confirm(t('flow.confirmReopen', { title: task.title }))) return;
    if (await act('reopen')) push(t('flow.reopened.toast'));
  };

  const publish = async () => {
    if (await act('publish')) push(t('flow.published.toast'));
  };

  /**
   * Approved, and waiting to go out. The publish button is the primary action
   * here because it is the only thing left to do — reopening is the correction,
   * so it stays quiet beside it.
   */
  if (state === 'signed_off') {
    return (
      <div className="grid gap-3">
        <ReviewVerdict task={task} />
        <div className="flex flex-wrap items-center gap-2">
          {canPublish(user, task) && (
            <button type="button" onClick={publish} disabled={busy} className="btn-primary btn-sm gap-1.5">
              {busy ? <Spinner size={15} /> : <Send size={15} />}
              {t('flow.publish')}
            </button>
          )}
          {canReopen(user, task) && (
            <button type="button" onClick={reopen} disabled={busy} className="btn-ghost btn-sm gap-1.5">
              <RotateCcw size={15} />
              {t('flow.reopen')}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (state === 'approved') {
    return (
      <div className="grid gap-3">
        <ReviewVerdict task={task} />
        {canReopen(user, task) && (
          <button type="button" onClick={reopen} disabled={busy} className="btn-ghost btn-sm w-fit gap-1.5">
            <RotateCcw size={15} />
            {t('flow.reopen')}
          </button>
        )}
      </div>
    );
  }

  if (state === 'submitted') {
    if (!canReview(user, task)) {
      return (
        <div className="flex items-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50/60 px-3.5 py-3 text-[12.5px] font-semibold text-brand-700">
          <Clock3 size={16} />
          {t('flow.awaitingManager')}
        </div>
      );
    }
    return (
      <div className="grid gap-3">
        {open === 'review' ? (
          <ReviewGate task={task} busy={busy} onCancel={() => setOpen(null)} onDecide={act} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setOpen('review')} className="btn-primary btn-sm gap-1.5">
              <ShieldCheck size={16} />
              {t('flow.approve')}
            </button>
            <button type="button" onClick={() => setOpen('review')} className="btn-ghost btn-sm gap-1.5">
              <RotateCcw size={15} />
              {t('flow.requestChanges')}
            </button>
          </div>
        )}
      </div>
    );
  }

  if ((state === 'assigned' || state === 'working') && ownsAssignment && awaitingAssignment) {
    return <AssignmentGate task={task} busy={busy} onAct={act} />;
  }

  if ((state === 'assigned' || state === 'working') && awaitingAssignment) {
    return (
      <div className="grid gap-1.5 rounded-xl border border-status-warn/30 bg-status-warnBg px-3.5 py-3">
        <p className="flex items-center gap-2 text-[12.5px] font-bold text-accent-600">
          <Clock3 size={16} />
          {t('assignment.awaiting')}
        </p>
        {task.assignmentNote && (
          <p className="text-[12px] leading-relaxed text-ink-muted">{task.assignmentNote}</p>
        )}
      </div>
    );
  }

  if (!doer && !reviewer) {
    return <p className="text-[12.5px] text-ink-faint">{t('flow.readOnly')}</p>;
  }

  return (
    <div className="grid gap-3">
      {task.reviewDecision === 'changes_requested' && <ReviewVerdict task={task} />}
      {open === 'submit' ? (
        <SubmitGate
          task={task}
          busy={busy}
          attachmentCount={attachmentCount}
          onCancel={() => setOpen(null)}
          onSubmit={act}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {canStart(user, task) && (
            <button type="button" onClick={start} disabled={busy} className="btn-ghost btn-sm gap-1.5">
              <Play size={15} />
              {t('flow.start')}
            </button>
          )}
          {canSubmit(user, task) && (
            <button type="button" onClick={() => setOpen('submit')} className="btn-primary btn-sm gap-1.5">
              <Send size={15} />
              {task.reworkCount > 0 ? t('flow.resubmit') : t('flow.submit')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AssignmentGate({
  task,
  busy,
  onAct,
}: {
  task: Task;
  busy: boolean;
  onAct: (path: string, body?: unknown) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const { push } = useToast();
  const [mode, setMode] = useState<
    'decline' | 'request_clarification' | 'propose_due_date' | 'request_reassignment' | null
  >(null);
  const [note, setNote] = useState(task.assignmentNote ?? '');
  const [dueDate, setDueDate] = useState(task.proposedDueDate ?? task.dueDate ?? '');

  const accept = async () => {
    if (await onAct('assignment', { action: 'accept' })) {
      push(t('assignment.accepted'));
    }
  };

  const send = async () => {
    if (mode !== 'propose_due_date' && !note.trim()) {
      return push(t('assignment.reasonRequired'), 'bad');
    }
    const body = {
      action: mode,
      note: note.trim(),
      ...(mode === 'propose_due_date' ? { dueDate } : {}),
    };
    if (await onAct('assignment', body)) {
      push(t('assignment.sent'));
      setMode(null);
    }
  };

  if (mode) {
    return (
      <div className="grid gap-3 rounded-xl border border-surface-line bg-white p-3.5 shadow-sm">
        <div>
          <h4 className="text-[13px] font-bold text-ink">
            {t(`assignment.${mode}.title` as StringKey)}
          </h4>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            {t('assignment.responseHint')}
          </p>
        </div>
        {mode === 'propose_due_date' && (
          <Field label={t('tasks.dueDate')} required>
            <input
              type="date"
              className="field ltr text-start"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              required
            />
          </Field>
        )}
        <Field
          label={t('assignment.reason')}
          required={mode !== 'propose_due_date'}
        >
          <textarea
            className="field min-h-[76px] resize-y"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('assignment.reasonPlaceholder')}
            autoFocus={mode !== 'propose_due_date'}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setMode(null)} className="btn-ghost btn-sm">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={busy || (mode === 'propose_due_date' && !dueDate)}
            className="btn-primary btn-sm"
          >
            {busy && <Spinner size={15} />}
            {t('common.send')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-xl border border-brand-200 bg-brand-50/50 p-3.5">
      <div>
        <h4 className="text-[13px] font-bold text-ink">{t('assignment.title')}</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
          {t('assignment.hint')}
        </p>
      </div>
      {task.assignmentNote && (
        <p className="rounded-lg bg-white px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
          {task.assignmentNote}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={accept} disabled={busy} className="btn-primary btn-sm">
          <CheckCircle2 size={15} />
          {t('assignment.accept')}
        </button>
        <button
          type="button"
          onClick={() => setMode('request_clarification')}
          className="btn-ghost btn-sm"
        >
          <CircleHelp size={15} />
          {t('assignment.clarify')}
        </button>
        <button
          type="button"
          onClick={() => setMode('propose_due_date')}
          className="btn-ghost btn-sm"
        >
          <CalendarDays size={15} />
          {t('assignment.proposeDate')}
        </button>
        <button
          type="button"
          onClick={() => setMode('request_reassignment')}
          className="btn-ghost btn-sm"
        >
          <UserRoundX size={15} />
          {t('assignment.reassign')}
        </button>
        <button type="button" onClick={() => setMode('decline')} className="btn-ghost btn-sm text-status-bad">
          <AlertTriangle size={15} />
          {t('assignment.decline')}
        </button>
      </div>
    </div>
  );
}

function SubmitGate({
  task,
  busy,
  attachmentCount,
  onCancel,
  onSubmit,
}: {
  task: Task;
  busy: boolean;
  attachmentCount: number;
  onCancel: () => void;
  onSubmit: (path: string, body?: unknown) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const { push } = useToast();
  const [note, setNote] = useState(task.submissionNote ?? '');

  const send = async () => {
    if (attachmentCount === 0) return push(t('flow.needDeliverable'), 'bad');
    if (await onSubmit('submit', { note })) push(t('flow.submitted.toast'));
  };

  return (
    <div className="grid gap-3 rounded-xl border border-brand-200 bg-brand-50/50 p-3.5">
      <div>
        <h4 className="text-[13px] font-bold text-ink">{t('flow.submitTitle')}</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{t('flow.submitHint')}</p>
      </div>

      <Field label={t('flow.submitNote')}>
        <textarea
          className="field min-h-[80px] resize-y bg-white"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('flow.submitNotePlaceholder')}
          autoFocus
        />
      </Field>

      {attachmentCount === 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-status-warnBg px-3 py-2 text-[12.5px] font-semibold text-accent-600">
          <AlertTriangle size={15} />
          {t('flow.needDeliverable')}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost btn-sm">
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={send}
          disabled={busy || attachmentCount === 0}
          className="btn-primary btn-sm gap-1.5"
        >
          {busy ? <Spinner size={15} /> : <Send size={15} />}
          {task.reworkCount > 0 ? t('flow.resubmit') : t('flow.submit')}
        </button>
      </div>
    </div>
  );
}

function ReviewGate({
  task,
  busy,
  onCancel,
  onDecide,
}: {
  task: Task;
  busy: boolean;
  onCancel: () => void;
  onDecide: (path: string, body?: unknown) => Promise<boolean>;
}) {
  const { t, lang } = useI18n();
  const { push } = useToast();
  const [score, setScore] = useState(task.score ?? 85);
  const [note, setNote] = useState('');
  const band = scoreBand(score);

  /**
   * The score and the decision are one judgement, so the form says so.
   *
   * Below the rubric's bottom band the work is, by the reviewer's own number,
   * not what was asked for — and approving it anyway closes the task, pays the
   * assignee a poor score and gives them no chance to fix it. So the gate leads
   * with "إعادة عمل" instead. It is a recommendation and not a rule: the manager
   * may still approve, because a score can be low for reasons that have nothing
   * to do with whether the task should stay open.
   */
  const weak = band?.id === 'weak';

  const approve = async () => {
    if (await onDecide('review', { decision: 'approved', score, note })) {
      push(t('flow.approved.toast'));
    }
  };

  const sendBack = async () => {
    if (!note.trim()) return push(t('flow.returnReasonRequired'), 'bad');
    if (await onDecide('review', { decision: 'changes_requested', note })) {
      push(t('flow.returned.toast'));
    }
  };

  return (
    <div className="grid gap-3.5 rounded-xl border border-surface-line bg-white p-3.5 shadow-sm">
      <div>
        <h4 className="text-[13px] font-bold text-ink">{t('flow.reviewTitle')}</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{t('flow.reviewHint')}</p>
      </div>

      <div>
        <span className="label">{t('flow.scoreLabel')}</span>
        <div className="flex items-center gap-3">
          <span className={cx('ltr w-14 text-[30px] font-black leading-none tabular-nums', scoreTextTone(score))}>
            {score}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={score}
            onChange={(event) => setScore(Number(event.target.value))}
            className="ltr h-2 flex-1 cursor-pointer appearance-none rounded-full bg-surface-sunken accent-brand-500"
            aria-label={t('flow.scoreLabel')}
          />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {SCORE_BANDS.map((item: { id: string; min: number; ar: string; en: string }) => {
            const value = item.min === 0 ? 40 : Math.min(100, item.min + 5);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setScore(value)}
                className={cx(
                  'rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors',
                  band?.id === item.id
                    ? 'border-transparent bg-navy text-white'
                    : 'border-surface-line bg-white text-ink-muted hover:bg-surface-sunken'
                )}
              >
                {lang === 'en' ? item.en : item.ar}
              </button>
            );
          })}
        </div>
      </div>

      {weak && (
        <p
          role="status"
          className="rounded-xl bg-amber-50 px-3 py-2.5 text-[12.5px] font-semibold leading-relaxed text-amber-800"
        >
          {t('flow.weakScoreHint')}
        </p>
      )}

      <Field label={t('flow.reviewNote')}>
        <textarea
          className="field min-h-[76px] resize-y"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('flow.reviewNotePlaceholder')}
        />
      </Field>

      {/* Two ways out of review, and the buttons name where the card lands
          rather than what the verdict is called. Which one leads is the score's
          answer, not a fixed layout. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-quiet btn-sm me-auto">
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={sendBack}
          disabled={busy}
          className={cx('btn-sm gap-1.5', weak ? 'btn-primary' : 'btn-ghost')}
        >
          {busy && weak ? <Spinner size={15} /> : <RotateCcw size={15} />}
          {t('flow.requestChanges')}
        </button>
        <button
          type="button"
          onClick={approve}
          disabled={busy}
          className={cx('btn-sm gap-1.5', weak ? 'btn-ghost' : 'btn-primary')}
        >
          {busy && !weak ? <Spinner size={15} /> : <ShieldCheck size={16} />}
          {t('flow.approve')}
        </button>
      </div>
    </div>
  );
}
