/**
 * Plan & stages.
 *
 * Every stage of the run in order, each with its status, where it came from,
 * how many of its gating tasks are done, what it waits for, and its tasks —
 * who holds each one, who approves it, when it is due and why it cannot start
 * yet. The current stage and stages with the reader's own work open by
 * default. A task opens in a drawer at `?task=<id>`, so any task has a link.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, ChevronDown, EyeOff, Lock, ShieldCheck, SkipForward, Undo2, Wrench } from 'lucide-react';
import { useI18n, type StringKey } from '../../../lib/i18n';
import { useAuth } from '../../../lib/auth';
import { runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate } from '../../../lib/learningProduction/hooks';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import type { StageView, TaskSummary } from '../../../lib/learningProduction/runTypes';
import { useToast } from '../../../components/ui';
import {
  BlockerList,
  Choice,
  DueTag,
  LoadingRows,
  OriginBadge,
  Pill,
  PersonLine,
  ReasonPrompt,
  StageStatusPill,
  TaskStatusPill,
  useDay,
  usePick,
} from '../../../components/learning-production/studio';
import { cx } from '../../../lib/utils';
import { useCourse } from '../CourseWorkspace';
import { StageStrip } from './RunOverview';
import { TaskDrawer } from './TaskDrawer';
import { LegacyPlan } from './LegacyPlan';

type Filter = 'all' | 'mine' | 'action';

export function RunPlan() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { run } = useCourse();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const taskId = params.get('task');
  const focusStage = params.get('stage');

  const mine = useMemo(() => {
    const set = new Set<string>();
    for (const stage of run?.stages ?? []) {
      if (stage.tasks.some((task) => task.assigneeUserId === user?.id || task.reviewerUserId === user?.id)) set.add(stage.key);
    }
    return set;
  }, [run, user]);

  if (!run) return <LoadingRows rows={8} />;
  if (run.run.scenario === 'LEGACY') return <LegacyPlan view={run} />;

  const isOpen = (stage: StageView) =>
    opened[stage.key] ?? (stage.key === focusStage || stage.key === run.currentStage || (filter !== 'all' && mine.has(stage.key)));

  const visible = (task: TaskSummary) => {
    if (filter === 'mine') return task.assigneeUserId === user?.id || task.reviewerUserId === user?.id;
    if (filter === 'action') return ['BLOCKED', 'CHANGES_REQUESTED', 'SUBMITTED', 'UNDER_REVIEW'].includes(task.display) || task.dueState === 'OVERDUE';
    return true;
  };

  const openTask = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('task', id);
    setParams(next);
  };
  const closeTask = () => {
    const next = new URLSearchParams(params);
    next.delete('task');
    setParams(next);
  };

  return (
    <div className="space-y-4">
      <div className="lps-panel p-4 pt-3">
        <StageStrip stages={run.stages} current={run.currentStage} courseId={run.course.id} compact />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Choice<Filter>
          label={t('lp.plan.filter')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('lp.plan.all') },
            { value: 'mine', label: t('lp.plan.mine') },
            { value: 'action', label: t('lp.plan.needsAction') },
          ]}
        />
        <div className="flex gap-2">
          <button type="button" className="lps-btn-quiet" onClick={() => setOpened(Object.fromEntries(run.stages.map((stage) => [stage.key, true])))}>
            {t('lp.plan.expandAll')}
          </button>
          <button type="button" className="lps-btn-quiet" onClick={() => setOpened(Object.fromEntries(run.stages.map((stage) => [stage.key, false])))}>
            {t('lp.plan.collapseAll')}
          </button>
        </div>
      </div>

      <ol className="space-y-2.5">
        {run.stages.map((stage, index) => (
          <StageSection
            key={stage.id}
            index={index}
            stage={stage}
            open={isOpen(stage)}
            onToggle={() => setOpened((current) => ({ ...current, [stage.key]: !isOpen(stage) }))}
            tasks={stage.tasks.filter(visible)}
            onOpenTask={openTask}
          />
        ))}
      </ol>

      {taskId && <TaskDrawer taskId={taskId} onClose={closeTask} />}
    </div>
  );
}

function StageSection({ stage, index, open, onToggle, tasks, onOpenTask }: { stage: StageView; index: number; open: boolean; onToggle: () => void; tasks: TaskSummary[]; onOpenTask: (id: string) => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const toast = useToast();
  const { run } = useCourse();
  const [prompt, setPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const view = run!;
  const canManage = view.capabilities.manageRuns && view.runOpen;
  const conditionalOnly = stage.tasks.filter((task) => task.classification !== 'OPTIONAL').every((task) => task.classification === 'CONDITIONAL');
  const canSkip = canManage && stage.status !== 'DONE' && stage.status !== 'SKIPPED' && (Boolean(stage.skippable) || conditionalOnly || view.capabilities.isAdmin);
  const headingId = `stage-${stage.key}`;

  async function skip(reason: string) {
    setBusy(true);
    try {
      await runsApi.skipStage(stage.id, reason);
      invalidate();
      toast.push(t('lp.plan.skipped'));
      setPrompt(false);
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  }
  async function unskip() {
    setBusy(true);
    try {
      await runsApi.unskipStage(stage.id);
      invalidate();
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="lps-panel overflow-hidden" id={headingId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-start" aria-expanded={open} aria-controls={`${headingId}-tasks`} onClick={onToggle}>
          <ChevronDown size={16} aria-hidden="true" className={cx('shrink-0 transition-transform duration-150', !open && 'ltr:-rotate-90 rtl:rotate-90')} />
          <span className="w-5 shrink-0 text-[12px] font-semibold lps-faint">{index + 1}</span>
          <span className="lps-h2 min-w-0 truncate">{pick(stage.label)}</span>
        </button>
        <StageStatusPill status={stage.status} />
        {stage.origin !== 'WORKBOOK' && <OriginBadge origin={stage.origin} source={stage.source} compact />}
        {stage.progress.total > 0 && (
          <span className="text-[12px] lps-muted">{t('lp.plan.stageProgress', { done: stage.progress.done, total: stage.progress.total })}</span>
        )}
        {stage.issues.open > 0 && (
          <Pill tone={stage.issues.blocking ? 'attention' : 'neutral'}>{t('lp.plan.openIssues', { n: stage.issues.open })}</Pill>
        )}
        {stage.completedAt && stage.status === 'DONE' && <span className="text-[12px] lps-faint">{day(stage.completedAt)}</span>}
        {canSkip && (
          <button type="button" className="lps-btn-quiet !min-h-8" onClick={() => setPrompt(true)}>
            <SkipForward size={14} aria-hidden="true" />
            {t('lp.plan.skip')}
          </button>
        )}
        {canManage && stage.status === 'SKIPPED' && (
          <button type="button" className="lps-btn-quiet !min-h-8" onClick={unskip} disabled={busy}>
            <Undo2 size={14} aria-hidden="true" />
            {t('lp.plan.unskip')}
          </button>
        )}
      </div>

      {open && (
        <div id={`${headingId}-tasks`} className="border-t lps-fade" style={{ borderColor: 'var(--lps-line)' }}>
          {(stage.description || stage.note || stage.blockers.length > 0 || stage.skipReason) && (
            <div className="space-y-2 px-4 py-3 text-[12.5px]" style={{ background: 'var(--lps-sunken)' }}>
              {stage.description && <p className="lps-muted">{pick(stage.description)}</p>}
              {stage.note && <p className="lps-muted">{pick(stage.note)}</p>}
              {stage.skipReason && (
                <p>
                  <strong>{t('lp.plan.skipReason')}</strong> {stage.skipReason}
                </p>
              )}
              {stage.blockers.length > 0 && (
                <div>
                  <p className="mb-1 font-semibold">{t('lp.plan.waitsFor')}</p>
                  <BlockerList blockers={stage.blockers} people={view.people} courseId={view.course.id} dense />
                </div>
              )}
            </div>
          )}
          {tasks.length === 0 ? (
            <p className="px-4 py-3 text-[12.5px] lps-muted">{t('lp.plan.noTasksInFilter')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="lps-table min-w-[760px]">
                <thead>
                  <tr>
                    <th className="w-[150px]">{t('lp.col.status')}</th>
                    <th>{t('lp.col.task')}</th>
                    <th>{t('lp.col.owner')}</th>
                    <th>{t('lp.col.approver')}</th>
                    <th>{t('lp.col.due')}</th>
                    <th className="text-end">{t('lp.col.checks')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ReasonPrompt
        open={prompt}
        title={t('lp.plan.skipTitle', { stage: pick(stage.label) })}
        body={stage.skippable ? pick(stage.skippable.label) : conditionalOnly ? t('lp.plan.skipConditional') : t('lp.plan.skipAdmin')}
        label={t('lp.reason.label')}
        confirm={t('lp.plan.skip')}
        busy={busy}
        onCancel={() => setPrompt(false)}
        onConfirm={skip}
      />
    </li>
  );
}

function TaskRow({ task, onOpen }: { task: TaskSummary; onOpen: () => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const { run } = useCourse();
  const people = run!.people;
  const auto = task.kind === 'AUTO';
  return (
    <tr className="lps-row-link" onClick={onOpen}>
      <td>
        <TaskStatusPill display={task.display} />
      </td>
      <td className="min-w-[260px]">
        <button type="button" className="block text-start font-medium hover:underline" onClick={(event) => { event.stopPropagation(); onOpen(); }}>
          {pick(task.label)}
        </button>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {auto && <Pill tone="outline" icon={Bot}>{t('lp.task.automatic')}</Pill>}
          {task.classification !== 'REQUIRED' && <Pill tone="outline">{t(`lp.classification.${task.classification}` as StringKey)}</Pill>}
          {task.requiresApproval && <Pill tone="outline" icon={ShieldCheck}>{t('lp.task.needsApproval')}</Pill>}
          {task.externalTool && <Pill tone="outline" icon={Wrench}>{task.externalTool}</Pill>}
          {task.sensitive && <Pill tone="outline" icon={EyeOff}>{t('lp.task.sensitive')}</Pill>}
          {task.origin !== 'WORKBOOK' && <OriginBadge origin={task.origin} compact />}
          {task.display === 'BLOCKED' && task.blockers.length > 0 && (
            <span className="flex items-center gap-1 text-[11.5px] lps-muted">
              <Lock size={11} aria-hidden="true" />
              {t('lp.task.waitsFor', { what: task.blockers.map((blocker) => pick(blocker.label ?? null) || t(`lp.stageKey.${blocker.key}` as StringKey)).join('، ') })}
            </span>
          )}
          {task.status === 'WAIVED' && task.waiveReason && <span className="text-[11.5px] lps-muted">“{task.waiveReason}”</span>}
        </span>
      </td>
      <td>{auto ? <span className="lps-faint">—</span> : <PersonLine userId={task.assigneeUserId} people={people} fallback={task.role ? t(`lp.role.${task.role}` as StringKey) : undefined} />}</td>
      <td>
        {task.requiresApproval ? (
          <PersonLine userId={task.reviewerUserId} people={people} fallback={task.reviewerRole ? t(`lp.role.${task.reviewerRole}` as StringKey) : undefined} />
        ) : (
          <span className="lps-faint">—</span>
        )}
      </td>
      <td>
        <DueTag dueDate={task.dueDate} dueState={task.dueState} />
      </td>
      <td className="whitespace-nowrap text-end text-[12px] lps-muted">
        {auto && task.gate
          ? t('lp.gate.progress', { done: task.gate.done, total: task.gate.total })
          : task.counts && task.counts.checklist > 0
            ? `${task.counts.checklistDone}/${task.counts.checklist}`
            : '—'}
        {task.counts?.evidence ? ` · ${t('lp.task.evidenceCount', { n: task.counts.evidence })}` : ''}
      </td>
    </tr>
  );
}
