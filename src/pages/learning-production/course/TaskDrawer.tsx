/**
 * One task, opened over the plan.
 *
 * Top: the one thing this person can do next — start, send for approval,
 * mark done, approve or send back — or, when they cannot, why not and who
 * holds it. Then the work itself: the checklist (tick, not applicable with a
 * reason, or an issue logged in the stage's issue list), the evidence (file,
 * link or note — added, never replaced), every submission and the decision
 * made on exactly that submission, the discussion and the history.
 *
 * Every button is drawn from the verdicts the server sent with the task; a
 * refused click shows the server's own reason.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  EyeOff,
  FileText,
  Flag,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  SkipForward,
  StickyNote,
  Undo2,
  Unlock,
  Upload,
  XCircle,
} from 'lucide-react';
import { useI18n, type StringKey } from '../../../lib/i18n';
import { runPaths, runUploads, runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate, useLpQuery } from '../../../lib/learningProduction/hooks';
import { formatSize, lpErrorKey } from '../../../lib/learningProduction/format';
import type { ChecklistLine, IssueArea, IssueSeverity, TaskDetail } from '../../../lib/learningProduction/runTypes';
import { ISSUE_AREAS, ISSUE_SEVERITIES } from '@shared/learningProduction/runs';
import { useToast } from '../../../components/ui';
import { ActivityFeed, PersonSelect, usePeople } from '../../../components/learning-production/kit';
import {
  BlockerList,
  Busy,
  Drawer,
  DueTag,
  ErrorNote,
  LoadingRows,
  OriginBadge,
  PersonLine,
  Pill,
  ReasonPrompt,
  StageStatusPill,
  TaskStatusPill,
  useDay,
  usePick,
} from '../../../components/learning-production/studio';
import { cx } from '../../../lib/utils';

type Prompt = null | 'waive' | 'reopen' | 'override' | 'changes' | 'na' | 'issue' | 'withdraw';

export function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const { data, error, loading, reload, setData } = useLpQuery<TaskDetail>(runPaths.task(taskId));
  const [dirty, setDirty] = useState(false);

  const close = () => {
    if (dirty && !window.confirm(t('lp.unsaved.confirm'))) return;
    onClose();
  };

  return (
    <Drawer
      open
      onClose={close}
      title={data ? pick(data.task.label) : t('lp.task.loading')}
      subtitle={
        data ? (
          <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="lps-muted">{pick(data.stage.label)}</span>
            <StageStatusPill status={data.stage.status} />
            <TaskStatusPill display={data.task.display} />
            {data.task.classification !== 'REQUIRED' && <Pill tone="outline">{t(`lp.classification.${data.task.classification}` as StringKey)}</Pill>}
            <OriginBadge origin={data.task.origin} source={data.task.source} />
          </span>
        ) : null
      }
    >
      {error && !data ? <ErrorNote error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingRows rows={7} /> : null}
      {data && <TaskBody detail={data} replace={setData} onDirty={setDirty} />}
    </Drawer>
  );
}

function TaskBody({ detail, replace, onDirty }: { detail: TaskDetail; replace: (next: TaskDetail) => void; onDirty: (dirty: boolean) => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [lineTarget, setLineTarget] = useState<ChecklistLine | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [menu, setMenu] = useState(false);
  const { task, evaluation: ev, primary } = detail;
  const actions = ev.actions;
  const people = detail.people;
  const courseId = detail.course.id;

  async function run(label: string, call: () => Promise<TaskDetail>, success?: StringKey) {
    setBusy(label);
    try {
      const next = await call();
      replace(next);
      invalidate();
      if (success) toast.push(t(success));
      return true;
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const act = (action: string, body: Record<string, unknown> = {}, success?: StringKey) => run(action, () => runsApi.taskAction(task.id, action, body), success);

  const reasonText = (reason: string | null | undefined) => (reason ? t(`lp.error.${reason}` as StringKey) : '');

  /* ── the primary action ─────────────────────────────────────── */

  let primaryBlock: ReactNode = null;
  if (primary.kind === 'automatic') {
    primaryBlock = (
      <div className="lps-callout-info flex gap-2">
        <Bot size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">{t('lp.task.autoTitle')}</p>
          <p>{t(`lp.rule.${task.gate ? (task.gate.satisfied ? 'met' : 'notMet') : 'waiting'}` as StringKey, { done: task.gate?.done ?? 0, total: task.gate?.total ?? 0 })}</p>
          <Link to={`/learning-production/courses/${courseId}/production`} className="mt-1 inline-block underline">
            {t('lp.task.openProduction')}
          </Link>
        </div>
      </div>
    );
  } else if (primary.kind === 'blocked') {
    primaryBlock = (
      <div className="lps-callout space-y-2">
        <p className="flex items-center gap-2 font-semibold">
          <Unlock size={15} aria-hidden="true" />
          {t('lp.task.blockedTitle')}
        </p>
        <BlockerList blockers={detail.blockers} people={people} courseId={courseId} />
        {actions.OVERRIDE_DEPENDENCY.allowed && (
          <button type="button" className="lps-btn" onClick={() => setPrompt('override')}>
            {t('lp.task.override')}
          </button>
        )}
      </div>
    );
  } else if (primary.kind === 'review') {
    const pending = detail.submissions.find((submission) => submission.decision === 'PENDING');
    primaryBlock = (
      <div className="lps-panel space-y-2 p-3" style={{ borderColor: 'var(--lps-accent)' }}>
        <p className="font-semibold">{pending?.isResubmission ? t('lp.task.reviewResubmission', { n: pending.submissionNumber }) : t('lp.task.reviewSubmission', { n: pending?.submissionNumber ?? 1 })}</p>
        {pending && (
          <p className="text-[12.5px] lps-muted">
            {t('lp.task.submittedBy', { who: people[pending.submittedBy]?.name ?? t('common.removedUser'), day: day(pending.submittedAt) })}
            {pending.notes ? ` · “${pending.notes}”` : ''}
          </p>
        )}
        <label className="block">
          <span className="lps-label">{t('lp.task.reviewNotes')}</span>
          <textarea
            className="lps-input min-h-[70px]"
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              onDirty(Boolean(event.target.value));
            }}
          />
        </label>
        {ev.approvalNeedsOverride && (
          <label className="block">
            <span className="lps-label">{t('lp.task.overrideReason')} *</span>
            <input className="lps-input" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} />
            <span className="mt-1 block text-[12px] lps-faint">{t('lp.task.overrideHint')}</span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="lps-btn-primary"
            disabled={Boolean(busy) || !actions.APPROVE.allowed || (ev.approvalNeedsOverride && !overrideReason.trim())}
            onClick={async () => {
              if (await act('approve', { notes, overrideReason: overrideReason || undefined }, 'lp.task.approved')) {
                setNotes('');
                onDirty(false);
              }
            }}
          >
            {busy === 'approve' ? <Busy /> : <CheckCircle2 size={15} aria-hidden="true" />}
            {t('lp.task.approve')}
          </button>
          <button
            type="button"
            className="lps-btn"
            disabled={Boolean(busy) || !actions.REQUEST_CHANGES.allowed || !notes.trim()}
            title={!notes.trim() ? t('lp.task.changesNeedNote') : undefined}
            onClick={async () => {
              if (await act('request-changes', { notes }, 'lp.task.changesSent')) {
                setNotes('');
                onDirty(false);
              }
            }}
          >
            <RotateCcw size={15} aria-hidden="true" />
            {t('lp.task.requestChanges')}
          </button>
        </div>
      </div>
    );
  } else if (primary.kind === 'action' && primary.action) {
    const action = primary.action;
    const label = action === 'START' ? 'lp.task.start' : action === 'SUBMIT' ? (task.status === 'CHANGES_REQUESTED' ? 'lp.task.resubmit' : 'lp.task.submit') : 'lp.task.complete';
    const path = action === 'START' ? 'start' : action === 'SUBMIT' ? 'submit' : 'complete';
    primaryBlock = (
      <div className="space-y-2">
        {task.status === 'CHANGES_REQUESTED' && <LastDecision detail={detail} />}
        {action !== 'START' && (
          <label className="block">
            <span className="lps-label">{t(action === 'SUBMIT' ? 'lp.task.submitNotes' : 'lp.task.completeNotes')}</span>
            <textarea
              className="lps-input min-h-[60px]"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                onDirty(Boolean(event.target.value));
              }}
            />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="lps-btn-primary"
            disabled={Boolean(busy) || Boolean(primary.disabledReason)}
            onClick={async () => {
              if (await act(path, action === 'START' ? {} : { notes }, action === 'START' ? undefined : action === 'SUBMIT' ? 'lp.task.submitted' : 'lp.task.completed')) {
                setNotes('');
                onDirty(false);
              }
            }}
          >
            {busy === path ? <Busy /> : action === 'START' ? <Play size={15} aria-hidden="true" /> : action === 'SUBMIT' ? <Send size={15} aria-hidden="true" className="rtl:-scale-x-100" /> : <Check size={15} aria-hidden="true" />}
            {t(label as StringKey)}
          </button>
          {primary.disabledReason && <span className="text-[12.5px]" style={{ color: 'var(--lps-attention)' }}>{reasonText(primary.disabledReason)}</span>}
        </div>
      </div>
    );
  } else if (primary.kind === 'waiting') {
    primaryBlock = (
      <div className="lps-callout-info flex flex-wrap items-center justify-between gap-2">
        <span>
          {t('lp.task.waitingFor')} <PersonLine userId={task.reviewerUserId} people={people} fallback={task.reviewerRole ? t(`lp.role.${task.reviewerRole}` as StringKey) : undefined} />
        </span>
        {actions.START_REVIEW.allowed && (
          <button type="button" className="lps-btn" onClick={() => act('start-review')}>
            {t('lp.task.startReview')}
          </button>
        )}
      </div>
    );
  } else if (primary.kind === 'done') {
    primaryBlock = (
      <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--lps-ok)' }}>
        <CheckCircle2 size={16} aria-hidden="true" />
        {task.status === 'APPROVED'
          ? t('lp.task.approvedBy', { who: people[task.approvedBy ?? '']?.name ?? '—', day: day(task.approvedAt) })
          : t('lp.task.doneBy', { who: people[task.doneBy ?? '']?.name ?? '—', day: day(task.doneAt) })}
      </div>
    );
  } else if (primary.kind === 'waived') {
    primaryBlock = (
      <div className="lps-panel p-3 text-[13px]" style={{ background: 'var(--lps-sunken)' }}>
        <p className="flex items-center gap-2 font-semibold">
          <SkipForward size={15} aria-hidden="true" />
          {t('lp.task.waivedBy', { who: people[task.waivedBy ?? '']?.name ?? '—', day: day(task.waivedAt) })}
        </p>
        {task.waiveReason && <p className="mt-1 lps-muted">“{task.waiveReason}”</p>}
      </div>
    );
  } else if (!ev.isAssignee && !ev.isReviewer && task.kind !== 'AUTO') {
    primaryBlock = <p className="text-[12.5px] lps-muted">{t('lp.task.readOnly')}</p>;
  }

  const secondary = [
    actions.WAIVE.allowed && { key: 'waive', icon: SkipForward, label: t('lp.task.waive'), onClick: () => setPrompt('waive') },
    actions.REOPEN.allowed && { key: 'reopen', icon: Undo2, label: t('lp.task.reopen'), onClick: () => setPrompt('reopen') },
    actions.OVERRIDE_DEPENDENCY.allowed && primary.kind !== 'blocked' && { key: 'override', icon: Unlock, label: t('lp.task.override'), onClick: () => setPrompt('override') },
  ].filter(Boolean) as Array<{ key: string; icon: typeof SkipForward; label: string; onClick: () => void }>;

  return (
    <div className="space-y-5">
      <section aria-label={t('lp.task.next')} className="space-y-2">
        {primaryBlock}
        {secondary.length > 0 && (
          <div className="relative">
            <button type="button" className="lps-btn-quiet !min-h-8" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>
              <MoreHorizontal size={15} aria-hidden="true" />
              {t('lp.task.moreActions')}
            </button>
            {menu && (
              <div role="menu" className="lps-panel absolute start-0 z-10 mt-1 w-56 py-1 shadow-panel">
                {secondary.map((item) => (
                  <button key={item.key} type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] hover:bg-[color:var(--lps-sunken)]" onClick={() => { setMenu(false); item.onClick(); }}>
                    <item.icon size={14} aria-hidden="true" />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <About detail={detail} />
      <Assignment detail={detail} onChange={(body) => run('assign', () => runsApi.assignTask(task.id, body), 'lp.task.saved')} />
      {detail.checklist.length > 0 && (
        <Checklist
          detail={detail}
          busyKey={busy}
          onToggle={(line) => run(line.id, () => runsApi.checklist(line.id, { status: line.status === 'DONE' ? 'PENDING' : 'DONE' }))}
          onNotApplicable={(line) => {
            setLineTarget(line);
            setPrompt('na');
          }}
          onIssue={(line) => {
            setLineTarget(line);
            setPrompt('issue');
          }}
          onReset={(line) => run(line.id, () => runsApi.checklist(line.id, { status: 'PENDING' }))}
        />
      )}
      {(task.requiresEvidence || detail.evidence.length > 0 || actions.EDIT.allowed) && task.kind !== 'AUTO' && (
        <EvidenceSection
          detail={detail}
          onAdded={(next) => {
            replace(next);
            invalidate();
          }}
          onLink={(url, note) => run('evidence', () => runsApi.addEvidenceLink(task.id, url, note), 'lp.evidence.added')}
          onNote={(note) => run('evidence', () => runsApi.addEvidenceNote(task.id, note), 'lp.evidence.added')}
          onWithdraw={(id) => {
            setEvidenceTarget(id);
            setPrompt('withdraw');
          }}
        />
      )}
      {detail.submissions.length > 0 && <Submissions detail={detail} />}
      <Discussion detail={detail} onPost={(body) => run('comment', () => runsApi.comment(task.id, body))} />
      <section aria-labelledby="task-history">
        <h3 id="task-history" className="lps-eyebrow mb-2">
          {t('lp.task.history')}
        </h3>
        <ActivityFeed entries={detail.activity} people={people} showWhere={false} />
      </section>

      <ReasonPrompt
        open={prompt === 'waive'}
        title={t('lp.task.waiveTitle')}
        body={task.classification === 'REQUIRED' ? t('lp.task.waiveRequired') : task.condition ? t('lp.task.waiveCondition', { condition: pick(task.condition) }) : t('lp.task.waiveBody')}
        label={t('lp.reason.label')}
        confirm={t('lp.task.waive')}
        busy={busy === 'waive'}
        onCancel={() => setPrompt(null)}
        onConfirm={async (reason) => {
          if (await act('waive', { reason }, 'lp.task.waived')) setPrompt(null);
        }}
      />
      <ReasonPrompt
        open={prompt === 'reopen'}
        title={t('lp.task.reopenTitle')}
        body={t('lp.task.reopenBody')}
        label={t('lp.reason.label')}
        confirm={t('lp.task.reopen')}
        busy={busy === 'reopen'}
        onCancel={() => setPrompt(null)}
        onConfirm={async (reason) => {
          if (await act('reopen', { reason }, 'lp.task.reopened')) setPrompt(null);
        }}
      />
      <ReasonPrompt
        open={prompt === 'override'}
        title={t('lp.task.overrideTitle')}
        body={t('lp.task.overrideBody')}
        label={t('lp.reason.label')}
        confirm={t('lp.task.override')}
        busy={busy === 'override-dependency'}
        onCancel={() => setPrompt(null)}
        onConfirm={async (reason) => {
          if (await act('override-dependency', { reason })) setPrompt(null);
        }}
      />
      <ReasonPrompt
        open={prompt === 'na' && Boolean(lineTarget)}
        title={t('lp.checklist.naTitle')}
        body={lineTarget ? pick(lineTarget.label) : ''}
        label={t('lp.reason.label')}
        confirm={t('lp.checklist.markNa')}
        busy={Boolean(lineTarget && busy === lineTarget.id)}
        onCancel={() => setPrompt(null)}
        onConfirm={async (reason) => {
          if (lineTarget && (await run(lineTarget.id, () => runsApi.checklist(lineTarget.id, { status: 'NOT_APPLICABLE', comment: reason })))) setPrompt(null);
        }}
      />
      <ReasonPrompt
        open={prompt === 'withdraw' && Boolean(evidenceTarget)}
        title={t('lp.evidence.withdrawTitle')}
        body={t('lp.evidence.withdrawBody')}
        label={t('lp.reason.label')}
        confirm={t('lp.evidence.withdraw')}
        danger
        busy={busy === 'withdraw'}
        onCancel={() => setPrompt(null)}
        onConfirm={async (reason) => {
          if (evidenceTarget && (await run('withdraw', () => runsApi.withdrawEvidence(evidenceTarget, reason)))) setPrompt(null);
        }}
      />
      {prompt === 'issue' && lineTarget && (
        <IssueFromLine
          line={lineTarget}
          busy={busy === lineTarget.id}
          onCancel={() => setPrompt(null)}
          onConfirm={async (issue, comment) => {
            if (await run(lineTarget.id, () => runsApi.checklist(lineTarget.id, { status: 'ISSUE', comment, issue }), 'lp.issue.logged')) setPrompt(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Block({ id, title, children, action }: { id: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id={id} className="lps-eyebrow">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function About({ detail }: { detail: TaskDetail }) {
  const { t } = useI18n();
  const pick = usePick();
  const { task } = detail;
  const source = task.source;
  return (
    <Block id="task-about" title={t('lp.task.about')}>
      <div className="space-y-2 text-[13px]">
        {task.description && <p>{pick(task.description)}</p>}
        {task.condition && (
          <p>
            <strong>{t('lp.task.condition')}</strong> {pick(task.condition)}
          </p>
        )}
        {task.note && <p className="lps-callout !text-[12.5px]">{pick(task.note)}</p>}
        {task.sensitive && (
          <p className="flex items-center gap-2 text-[12.5px] lps-muted">
            <EyeOff size={14} aria-hidden="true" />
            {t('lp.task.sensitiveNote')}
          </p>
        )}
        {task.externalTool && (
          <p className="flex items-center gap-2 text-[12.5px] lps-muted">
            <ExternalLink size={14} aria-hidden="true" />
            {t('lp.task.externalTool', { tool: task.externalTool })}
          </p>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="lps-muted">{t('lp.task.kind')}</dt>
          <dd>{t(`lp.taskKind.${task.kind}` as StringKey)}</dd>
          <dt className="lps-muted">{t('lp.task.source')}</dt>
          <dd className="min-w-0">
            <OriginBadge origin={task.origin} source={source} />
            {source?.sheet && <span className="ms-2 lps-muted">{source.sheet}</span>}
          </dd>
          {task.requiresApproval && (
            <>
              <dt className="lps-muted">{t('lp.task.approval')}</dt>
              <dd>
                {t(`lp.role.${task.reviewerRole}` as StringKey)}
                {task.approvalOrigin === 'PROPOSED' && <Pill tone="attention" className="ms-2">{t('lp.origin.PROPOSED')}</Pill>}
              </dd>
            </>
          )}
          {task.requiresEvidence && task.evidenceLabel && (
            <>
              <dt className="lps-muted">{t('lp.task.deliverable')}</dt>
              <dd>{pick(task.evidenceLabel)}</dd>
            </>
          )}
        </dl>
      </div>
    </Block>
  );
}

function Assignment({ detail, onChange }: { detail: TaskDetail; onChange: (body: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const { task } = detail;
  const canAssign = detail.evaluation.actions.ASSIGN.allowed;
  const people = usePeople(canAssign);
  if (task.kind === 'AUTO') return null;
  return (
    <Block id="task-assignment" title={t('lp.task.assignment')}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="lps-label">{t('lp.col.owner')}</span>
          {canAssign ? (
            <PersonSelect className="lps-input" value={task.assigneeUserId} people={people} exclude={task.reviewerUserId} placeholder={t('lp.people.unassigned')} onChange={(value) => onChange({ assigneeUserId: value })} />
          ) : (
            <PersonLine userId={task.assigneeUserId} people={detail.people} fallback={task.role ? t(`lp.role.${task.role}` as StringKey) : undefined} />
          )}
        </label>
        {task.requiresApproval && (
          <label className="block min-w-0">
            <span className="lps-label">{t('lp.col.approver')}</span>
            {canAssign ? (
              <PersonSelect className="lps-input" value={task.reviewerUserId} people={people} exclude={task.assigneeUserId} placeholder={t('lp.people.unassigned')} onChange={(value) => onChange({ reviewerUserId: value })} />
            ) : (
              <PersonLine userId={task.reviewerUserId} people={detail.people} fallback={task.reviewerRole ? t(`lp.role.${task.reviewerRole}` as StringKey) : undefined} />
            )}
          </label>
        )}
        <label className="block min-w-0">
          <span className="lps-label">{t('lp.col.due')}</span>
          {canAssign ? (
            <input type="date" className="lps-input" defaultValue={task.dueDate ?? ''} onBlur={(event) => event.target.value !== (task.dueDate ?? '') && onChange({ dueDate: event.target.value || null })} />
          ) : (
            <DueTag dueDate={task.dueDate} dueState={task.dueState} />
          )}
        </label>
        <label className="block min-w-0">
          <span className="lps-label">{t('lp.col.priority')}</span>
          {canAssign ? (
            <select className="lps-input" value={task.priority} onChange={(event) => onChange({ priority: event.target.value })}>
              {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((value) => (
                <option key={value} value={value}>
                  {t(`lp.priority.${value}` as StringKey)}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[13px]">{t(`lp.priority.${task.priority}` as StringKey)}</span>
          )}
        </label>
      </div>
    </Block>
  );
}

function Checklist({
  detail,
  busyKey,
  onToggle,
  onNotApplicable,
  onIssue,
  onReset,
}: {
  detail: TaskDetail;
  busyKey: string | null;
  onToggle: (line: ChecklistLine) => void;
  onNotApplicable: (line: ChecklistLine) => void;
  onIssue: (line: ChecklistLine) => void;
  onReset: (line: ChecklistLine) => void;
}) {
  const { t } = useI18n();
  const pick = usePick();
  const editable = detail.evaluation.actions.EDIT.allowed;
  const issueStage = detail.task.kind === 'ISSUES';
  const groups = useMemo(() => {
    const list: Array<{ label: string | null; lines: ChecklistLine[] }> = [];
    for (const line of detail.checklist) {
      const label = line.group ? pick(line.group) : null;
      const last = list[list.length - 1];
      if (last && last.label === label) last.lines.push(line);
      else list.push({ label, lines: [line] });
    }
    return list;
  }, [detail.checklist, pick]);
  const summary = detail.evaluation.checklist;

  return (
    <Block id="task-checklist" title={t('lp.checklist.title')} action={<span className="text-[12px] lps-muted">{t('lp.checklist.progress', { done: summary.addressed, total: summary.total })}</span>}>
      <div className="space-y-3">
        {groups.map((group, index) => (
          <div key={`${group.label}-${index}`}>
            {group.label && <p className="mb-1 text-[12px] font-semibold lps-muted">{group.label}</p>}
            <ul className="lps-panel divide-y" style={{ borderColor: 'var(--lps-line)' }}>
              {group.lines.map((line) => (
                <li key={line.id} className="flex items-start gap-2.5 px-3 py-2" style={{ borderColor: 'var(--lps-line)' }}>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--lps-accent)]"
                    checked={line.status === 'DONE'}
                    disabled={!editable || line.status === 'NOT_APPLICABLE' || line.status === 'ISSUE' || busyKey === line.id}
                    onChange={() => onToggle(line)}
                    aria-label={pick(line.label)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cx('text-[13px]', line.status === 'NOT_APPLICABLE' && 'line-through lps-muted')}>
                      {pick(line.label)}
                      {!line.required && <span className="ms-1.5 text-[11.5px] lps-faint">({t('lp.checklist.optional')})</span>}
                    </p>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {line.origin !== 'WORKBOOK' && <OriginBadge origin={line.origin} source={line.source} compact />}
                      {line.status === 'ISSUE' && (
                        <Link to={`/learning-production/courses/${detail.course.id}/qa?issue=${line.issueId ?? ''}`} className="inline-flex">
                          <Pill tone="attention" icon={Flag}>{t('lp.checklist.issueLogged')}</Pill>
                        </Link>
                      )}
                      {line.status === 'NOT_APPLICABLE' && <Pill tone="outline">{t('lp.checkLine.NOT_APPLICABLE')}</Pill>}
                      {line.comment && <span className="text-[12px] lps-muted">“{line.comment}”</span>}
                    </span>
                  </div>
                  {editable && busyKey !== line.id && (
                    <div className="flex shrink-0 gap-1">
                      {line.status === 'PENDING' && (
                        <>
                          <button type="button" className="lps-btn-quiet !min-h-7 !px-1.5 text-[12px]" onClick={() => onNotApplicable(line)} title={t('lp.checklist.markNa')}>
                            {t('lp.checklist.na')}
                          </button>
                          {issueStage && (
                            <button type="button" className="lps-btn-quiet !min-h-7 !px-1.5 text-[12px]" onClick={() => onIssue(line)} title={t('lp.checklist.logIssue')}>
                              <Flag size={13} aria-hidden="true" />
                              <span className="sr-only">{t('lp.checklist.logIssue')}</span>
                            </button>
                          )}
                        </>
                      )}
                      {(line.status === 'NOT_APPLICABLE' || (line.status === 'ISSUE' && !line.issueId)) && (
                        <button type="button" className="lps-btn-quiet !min-h-7 !px-1.5 text-[12px]" onClick={() => onReset(line)}>
                          {t('lp.checklist.undo')}
                        </button>
                      )}
                    </div>
                  )}
                  {busyKey === line.id && <Busy />}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Block>
  );
}

function EvidenceSection({
  detail,
  onAdded,
  onLink,
  onNote,
  onWithdraw,
}: {
  detail: TaskDetail;
  onAdded: (next: TaskDetail) => void;
  onLink: (url: string, note: string) => Promise<boolean>;
  onNote: (note: string) => Promise<boolean>;
  onWithdraw: (id: string) => void;
}) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const toast = useToast();
  const [mode, setMode] = useState<null | 'file' | 'link' | 'note'>(null);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const editable = detail.evaluation.actions.EDIT.allowed;
  const { task } = detail;

  async function upload(selected: File) {
    if (selected.size > detail.upload.maxBytes) {
      toast.push(t('lp.error.FILE_TOO_LARGE'), 'bad');
      return;
    }
    setProgress(0);
    try {
      const next = await runUploads.evidence(task.id, selected, note, setProgress).promise;
      onAdded(next);
      toast.push(t('lp.evidence.added'));
      setMode(null);
      setNote('');
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setProgress(null);
    }
  }

  return (
    <Block
      id="task-evidence"
      title={task.requiresEvidence && task.evidenceLabel ? t('lp.evidence.titleFor', { what: pick(task.evidenceLabel) }) : t('lp.evidence.title')}
      action={task.requiresEvidence ? <Pill tone={detail.evaluation.evidenceCount ? 'ok' : 'attention'}>{detail.evaluation.evidenceCount ? t('lp.evidence.provided') : t('lp.evidence.required')}</Pill> : undefined}
    >
      {detail.evidence.length === 0 ? (
        <p className="text-[12.5px] lps-muted">{t('lp.evidence.none')}</p>
      ) : (
        <ul className="lps-panel divide-y" style={{ borderColor: 'var(--lps-line)' }}>
          {detail.evidence.map((item) => (
            <li key={item.id} className={cx('flex items-start gap-2.5 px-3 py-2 text-[13px]', item.withdrawnAt && 'opacity-60')} style={{ borderColor: 'var(--lps-line)' }}>
              {item.kind === 'FILE' ? <Paperclip size={15} aria-hidden="true" className="mt-0.5 shrink-0" /> : item.kind === 'LINK' ? <Link2 size={15} aria-hidden="true" className="mt-0.5 shrink-0" /> : <StickyNote size={15} aria-hidden="true" className="mt-0.5 shrink-0" />}
              <div className="min-w-0 flex-1">
                {item.redacted ? (
                  <p className="flex items-center gap-1.5 lps-muted">
                    <EyeOff size={13} aria-hidden="true" />
                    {t('lp.evidence.restricted')}
                  </p>
                ) : item.kind === 'FILE' ? (
                  <a href={runPaths.evidenceFile(item.id)} target="_blank" rel="noreferrer" className={cx('lps-bidi break-all font-medium hover:underline', item.withdrawnAt && 'line-through')}>
                    {item.fileName}
                  </a>
                ) : item.kind === 'LINK' ? (
                  <a href={item.url ?? '#'} target="_blank" rel="noreferrer noopener" className={cx('lps-bidi break-all font-medium hover:underline', item.withdrawnAt && 'line-through')} dir="ltr">
                    {item.url}
                  </a>
                ) : null}
                {!item.redacted && item.note && <p className={cx('lps-bidi mt-0.5 whitespace-pre-wrap', item.kind !== 'NOTE' && 'text-[12.5px] lps-muted')}>{item.note}</p>}
                <p className="mt-0.5 text-[11.5px] lps-faint">
                  {detail.people[item.createdBy]?.name ?? '—'} · {day(item.createdAt)}
                  {item.fileSize ? ` · ${formatSize(item.fileSize)}` : ''}
                  {item.withdrawnAt ? ` · ${t('lp.evidence.withdrawnNote', { reason: item.withdrawReason ?? '' })}` : ''}
                </p>
              </div>
              {item.kind === 'FILE' && !item.redacted && (
                <a href={runPaths.evidenceFile(item.id, true)} className="lps-btn-quiet !min-h-7 !px-1.5" aria-label={t('lp.evidence.download')}>
                  <Download size={14} aria-hidden="true" />
                </a>
              )}
              {editable && !item.withdrawnAt && !item.redacted && (
                <button type="button" className="lps-btn-quiet !min-h-7 !px-1.5" onClick={() => onWithdraw(item.id)} aria-label={t('lp.evidence.withdraw')}>
                  <XCircle size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="mt-2">
          {mode === null ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="lps-btn" onClick={() => setMode('file')}>
                <Upload size={14} aria-hidden="true" />
                {t('lp.evidence.addFile')}
              </button>
              <button type="button" className="lps-btn" onClick={() => setMode('link')}>
                <Link2 size={14} aria-hidden="true" />
                {t('lp.evidence.addLink')}
              </button>
              <button type="button" className="lps-btn" onClick={() => setMode('note')}>
                <FileText size={14} aria-hidden="true" />
                {t('lp.evidence.addNote')}
              </button>
            </div>
          ) : (
            <div className="lps-panel space-y-2 p-3">
              {mode === 'link' && (
                <label className="block">
                  <span className="lps-label">{t('lp.evidence.url')} *</span>
                  <input className="lps-input" dir="ltr" type="url" placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
                </label>
              )}
              <label className="block">
                <span className="lps-label">{mode === 'note' ? `${t('lp.evidence.noteLabel')} *` : t('lp.evidence.noteOptional')}</span>
                <textarea className="lps-input min-h-[60px]" value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              {mode === 'file' && (
                <>
                  <input
                    ref={file}
                    type="file"
                    className="block w-full text-[12.5px]"
                    onChange={(event) => {
                      const selected = event.target.files?.[0];
                      if (selected) void upload(selected);
                    }}
                  />
                  <p className="text-[11.5px] lps-faint">
                    {t('lp.evidence.accepted', { types: detail.upload.accepted.join(', '), size: formatSize(detail.upload.maxBytes) })}
                  </p>
                  {progress !== null && <progress value={progress} max={1} className="w-full" />}
                </>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className="lps-btn" onClick={() => setMode(null)}>
                  {t('common.cancel')}
                </button>
                {mode !== 'file' && (
                  <button
                    type="button"
                    className="lps-btn-primary"
                    disabled={mode === 'link' ? !/^https:\/\//i.test(url.trim()) : !note.trim()}
                    onClick={async () => {
                      const done = mode === 'link' ? await onLink(url.trim(), note) : await onNote(note.trim());
                      if (done) {
                        setMode(null);
                        setUrl('');
                        setNote('');
                      }
                    }}
                  >
                    {t('common.add')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Block>
  );
}

function LastDecision({ detail }: { detail: TaskDetail }) {
  const { t } = useI18n();
  const last = detail.submissions.find((submission) => submission.decision === 'CHANGES_REQUESTED');
  if (!last) return null;
  return (
    <div className="lps-callout">
      <p className="flex items-center gap-2 font-semibold">
        <RotateCcw size={14} aria-hidden="true" />
        {t('lp.task.changesAsked', { who: detail.people[last.reviewedBy ?? '']?.name ?? '—' })}
      </p>
      {last.reviewNotes && <p className="lps-bidi mt-1 whitespace-pre-wrap">{last.reviewNotes}</p>}
    </div>
  );
}

function Submissions({ detail }: { detail: TaskDetail }) {
  const { t } = useI18n();
  const day = useDay();
  return (
    <Block id="task-submissions" title={t('lp.task.submissions')}>
      <ol className="space-y-2">
        {detail.submissions.map((submission) => (
          <li key={submission.id} className="lps-panel px-3 py-2 text-[12.5px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                {t('lp.task.submissionN', { n: submission.submissionNumber })}
                {submission.isResubmission && <span className="ms-1.5 font-normal lps-muted">({t('lp.task.resubmission')})</span>}
              </span>
              <Pill tone={submission.decision === 'APPROVED' ? 'ok' : submission.decision === 'CHANGES_REQUESTED' ? 'attention' : 'accent'} icon={submission.decision === 'APPROVED' ? ShieldCheck : submission.decision === 'CHANGES_REQUESTED' ? RotateCcw : MessageSquare}>
                {t(`lp.decision.${submission.decision}` as StringKey)}
              </Pill>
            </div>
            <p className="mt-1 lps-muted">
              {t('lp.task.submittedBy', { who: detail.people[submission.submittedBy]?.name ?? '—', day: day(submission.submittedAt) })}
              {' · '}
              {t('lp.task.evidenceCount', { n: submission.evidenceIds.length })}
            </p>
            {submission.notes && <p className="lps-bidi mt-0.5">“{submission.notes}”</p>}
            {submission.reviewedAt && (
              <p className="mt-1">
                {t('lp.task.decidedBy', { who: detail.people[submission.reviewedBy ?? '']?.name ?? '—', day: day(submission.reviewedAt) })}
                {submission.reviewNotes && <span className="lps-bidi lps-muted"> — {submission.reviewNotes}</span>}
              </p>
            )}
            {submission.adminOverride && (
              <p className="mt-1 flex items-center gap-1.5" style={{ color: 'var(--lps-attention)' }}>
                <AlertTriangle size={13} aria-hidden="true" />
                {t('lp.task.adminOverride', { reason: submission.overrideReason ?? '' })}
              </p>
            )}
          </li>
        ))}
      </ol>
    </Block>
  );
}

function Discussion({ detail, onPost }: { detail: TaskDetail; onPost: (body: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const day = useDay();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Block id="task-discussion" title={t('lp.task.discussion', { n: detail.comments.length })}>
      {detail.comments.length > 0 && (
        <ul className="mb-2 space-y-2">
          {detail.comments.map((comment) => (
            <li key={comment.id} className="lps-panel px-3 py-2 text-[13px]">
              <p className="text-[12px] lps-muted">
                <strong className="text-[color:var(--lps-ink)]">{detail.people[comment.userId]?.name ?? t('common.removedUser')}</strong> · {day(comment.createdAt)}
              </p>
              <p className="lps-bidi mt-0.5 whitespace-pre-wrap">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      {detail.evaluation.canComment ? (
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!body.trim()) return;
            setBusy(true);
            if (await onPost(body)) setBody('');
            setBusy(false);
          }}
        >
          <label className="block">
            <span className="sr-only">{t('lp.task.commentLabel')}</span>
            <textarea className="lps-input min-h-[64px]" value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('lp.task.commentPlaceholder')} />
          </label>
          <div className="flex justify-end">
            <button type="submit" className="lps-btn" disabled={busy || !body.trim()}>
              {busy ? <Busy /> : <Send size={14} aria-hidden="true" className="rtl:-scale-x-100" />}
              {t('lp.task.comment')}
            </button>
          </div>
        </form>
      ) : null}
    </Block>
  );
}

function IssueFromLine({ line, busy, onCancel, onConfirm }: { line: ChecklistLine; busy: boolean; onCancel: () => void; onConfirm: (issue: Record<string, unknown>, comment: string) => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const people = usePeople();
  const [title, setTitle] = useState(pick(line.label));
  const [severity, setSeverity] = useState<IssueSeverity>('MEDIUM');
  const [area, setArea] = useState<IssueArea>('CONTENT');
  const [owner, setOwner] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  return (
    <Drawer
      open
      onClose={onCancel}
      title={t('lp.issue.logTitle')}
      subtitle={<span className="text-[12.5px] lps-muted">{pick(line.label)}</span>}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="lps-btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="lps-btn-primary" disabled={busy || !title.trim()} onClick={() => onConfirm({ title: title.trim(), severity, area, ownerUserId: owner, description }, description)}>
            {busy && <Busy />}
            {t('lp.issue.log')}
          </button>
        </div>
      }
    >
      <IssueFields title={title} setTitle={setTitle} severity={severity} setSeverity={setSeverity} area={area} setArea={setArea} owner={owner} setOwner={setOwner} description={description} setDescription={setDescription} people={people} />
    </Drawer>
  );
}

export function IssueFields({
  title,
  setTitle,
  severity,
  setSeverity,
  area,
  setArea,
  owner,
  setOwner,
  description,
  setDescription,
  people,
}: {
  title: string;
  setTitle: (value: string) => void;
  severity: IssueSeverity;
  setSeverity: (value: IssueSeverity) => void;
  area: IssueArea;
  setArea: (value: IssueArea) => void;
  owner: string | null;
  setOwner: (value: string | null) => void;
  description: string;
  setDescription: (value: string) => void;
  people: ReturnType<typeof usePeople>;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="lps-label">{t('lp.issue.title')} *</span>
        <input className="lps-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} />
      </label>
      <label className="block">
        <span className="lps-label">{t('lp.issue.severity')}</span>
        <select className="lps-input" value={severity} onChange={(event) => setSeverity(event.target.value as IssueSeverity)}>
          {ISSUE_SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {t(`lp.issueSeverity.${value}` as StringKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="lps-label">{t('lp.issue.area')}</span>
        <select className="lps-input" value={area} onChange={(event) => setArea(event.target.value as IssueArea)}>
          {ISSUE_AREAS.map((value) => (
            <option key={value} value={value}>
              {t(`lp.issueArea.${value}` as StringKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="block sm:col-span-2">
        <span className="lps-label">{t('lp.issue.owner')}</span>
        <PersonSelect className="lps-input" value={owner} onChange={setOwner} people={people} placeholder={t('lp.people.later')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="lps-label">{t('lp.issue.description')}</span>
        <textarea className="lps-input min-h-[90px]" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} />
      </label>
    </div>
  );
}
