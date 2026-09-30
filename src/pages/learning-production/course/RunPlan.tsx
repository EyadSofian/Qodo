/**
 * Plan & stages.
 *
 * Two panes. On one side every stage of the run, in order, as a short
 * vertical list: its number, its full name, and one icon for its state —
 * done, current, ready, waiting or skipped. On the other, the chosen stage:
 * what it is for, what it waits for, its tasks (who holds each, who approves
 * it, when it is due and why it cannot start yet) and, for a manager, the
 * one place to skip it. The current stage is chosen by default; `?stage=`
 * picks another and `?task=` opens a task's drawer, so both have links.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Check, EyeOff, Lock, ShieldCheck, SkipForward, Undo2, Wrench } from 'lucide-react';
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
import { TaskDrawer } from './TaskDrawer';
import { LegacyPlan } from './LegacyPlan';

type Filter = 'all' | 'mine' | 'action';

export function RunPlan() {
  const { t } = useI18n();
  const pick = usePick();
  const { run } = useCourse();
  const [params, setParams] = useSearchParams();
  const taskId = params.get('task');

  const selectedKey = useMemo(() => {
    if (!run) return null;
    const asked = params.get('stage');
    if (asked && run.stages.some((stage) => stage.key === asked)) return asked;
    const ofTask = taskId ? run.stages.find((stage) => stage.tasks.some((task) => task.id === taskId)) : null;
    return ofTask?.key ?? run.currentStage ?? run.stages[0]?.key ?? null;
  }, [run, params, taskId]);

  if (!run) return <LoadingRows rows={8} />;
  if (run.run.scenario === 'LEGACY') return <LegacyPlan view={run} />;

  const stage = run.stages.find((entry) => entry.key === selectedKey) ?? run.stages[0];
  const select = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('stage', key);
    next.delete('task');
    setParams(next, { replace: true });
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <label className="block lg:hidden">
        <span className="lps-label">{t('lp.plan.stages')}</span>
        <select className="lps-input" value={stage.key} onChange={(event) => select(event.target.value)}>
          {run.stages.map((entry, index) => (
            <option key={entry.key} value={entry.key}>
              {index + 1}. {pick(entry.label)} — {t(`lp.stageStatus.${entry.status}` as StringKey)}
            </option>
          ))}
        </select>
      </label>

      <nav aria-label={t('lp.plan.stages')} className="lps-panel hidden self-start p-2 lg:sticky lg:top-3 lg:block">
        <ol>
          {run.stages.map((entry, index) => (
            <StageNavItem
              key={entry.key}
              stage={entry}
              index={index}
              last={index === run.stages.length - 1}
              current={entry.key === run.currentStage}
              selected={entry.key === stage.key}
              onSelect={() => select(entry.key)}
            />
          ))}
        </ol>
      </nav>

      <StageDetail key={stage.key} stage={stage} index={run.stages.indexOf(stage)} onOpenTask={openTask} />

      {taskId && <TaskDrawer taskId={taskId} onClose={closeTask} />}
    </div>
  );
}

/** One stage in the side list: a state icon, its number and full name. */
function StageNavItem({ stage, index, last, current, selected, onSelect }: { stage: StageView; index: number; last: boolean; current: boolean; selected: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const waiting = stage.status === 'BLOCKED';
  const skipped = stage.status === 'SKIPPED';
  const done = stage.status === 'DONE';
  return (
    <li className="relative">
      {!last && <span aria-hidden="true" className="absolute start-[21px] top-9 h-[calc(100%-24px)] w-px" style={{ background: done ? '#a7e3c4' : '#e6e8ec' }} />}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cx(
          'relative flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-start transition-colors',
          selected ? 'bg-[#f1f3f7]' : 'hover:bg-[#f7f8fa]'
        )}
      >
        <span
          className={cx(
            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold',
            done && 'bg-emerald-500 text-white',
            current && !done && 'bg-[image:var(--lps-grad)] text-white shadow-[0_4px_10px_-4px_rgb(var(--lp-a1)/0.9)]',
            !done && !current && !waiting && !skipped && 'border-2 border-indigo-300 bg-white text-indigo-600',
            waiting && !current && 'border border-[#d5d9e0] bg-white text-[color:var(--lps-faint)]',
            skipped && 'border border-dashed border-[#cbd5e1] bg-white text-[color:var(--lps-faint)]'
          )}
          aria-hidden="true"
        >
          {done ? <Check size={13} strokeWidth={3} /> : skipped ? <SkipForward size={11} /> : index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx('block text-[13px] leading-snug', selected || current ? 'font-semibold' : 'font-medium', (waiting || skipped) && !selected && 'lps-muted', skipped && 'line-through')}>
            {pick(stage.label)}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] lps-faint">
            {current && <span className="font-semibold" style={{ color: 'rgb(var(--lp-a1))' }}>{t('lp.plan.now')}</span>}
            {stage.progress.total > 0 && <span>{t('lp.plan.stageProgress', { done: stage.progress.done, total: stage.progress.total })}</span>}
            {stage.issues.blocking > 0 && <span className="font-semibold text-amber-700">{t('lp.plan.openIssues', { n: stage.issues.open })}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

function StageDetail({ stage, index, onOpenTask }: { stage: StageView; index: number; onOpenTask: (id: string) => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const toast = useToast();
  const { user } = useAuth();
  const { run } = useCourse();
  const [filter, setFilter] = useState<Filter>('all');
  const [prompt, setPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const view = run!;
  const canManage = view.capabilities.manageRuns && view.runOpen;
  const conditionalOnly = stage.tasks.filter((task) => task.classification !== 'OPTIONAL').every((task) => task.classification === 'CONDITIONAL');
  const canSkip = canManage && stage.status !== 'DONE' && stage.status !== 'SKIPPED' && (Boolean(stage.skippable) || conditionalOnly || view.capabilities.isAdmin);

  const tasks = stage.tasks.filter((task) => {
    if (filter === 'mine') return task.assigneeUserId === user?.id || task.reviewerUserId === user?.id;
    if (filter === 'action') return ['BLOCKED', 'CHANGES_REQUESTED', 'SUBMITTED', 'UNDER_REVIEW'].includes(task.display) || task.dueState === 'OVERDUE';
    return true;
  });

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

  const after = stage.after
    .map((key) => view.stages.find((entry) => entry.key === key))
    .filter(Boolean)
    .map((entry) => pick(entry!.label))
    .join(t('lp.listSeparator'));

  return (
    <section className="lps-panel min-w-0 lps-fade" aria-labelledby={`stage-${stage.key}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--lps-line)' }}>
        <div className="min-w-0">
          <p className="text-[12px] lps-muted">{t('lp.run.stageOf', { n: index + 1, total: view.stages.length })}</p>
          <h2 id={`stage-${stage.key}`} className="font-display text-[18px] font-bold leading-snug">
            {pick(stage.label)}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
            <StageStatusPill status={stage.status} />
            {stage.progress.total > 0 && <span className="lps-muted">{t('lp.plan.tasksDone', { done: stage.progress.done, total: stage.progress.total })}</span>}
            {stage.issues.open > 0 && <Pill tone={stage.issues.blocking ? 'attention' : 'neutral'}>{t('lp.plan.openIssues', { n: stage.issues.open })}</Pill>}
            {stage.origin !== 'WORKBOOK' && <OriginBadge origin={stage.origin} source={stage.source} compact />}
            {stage.completedAt && stage.status === 'DONE' && <span className="lps-faint">{day(stage.completedAt)}</span>}
          </div>
        </div>
        {canSkip && (
          <button type="button" className="lps-btn-quiet" onClick={() => setPrompt(true)}>
            <SkipForward size={14} aria-hidden="true" />
            {t('lp.plan.skip')}
          </button>
        )}
        {canManage && stage.status === 'SKIPPED' && (
          <button type="button" className="lps-btn" onClick={unskip} disabled={busy}>
            <Undo2 size={14} aria-hidden="true" />
            {t('lp.plan.unskip')}
          </button>
        )}
      </header>

      {(stage.description || stage.note || after || stage.blockers.length > 0 || stage.skipReason) && (
        <div className="space-y-2 border-b px-5 py-3 text-[13px]" style={{ borderColor: 'var(--lps-line)' }}>
          {stage.description && <p className="leading-relaxed">{pick(stage.description)}</p>}
          {stage.note && <p className="lps-muted">{pick(stage.note)}</p>}
          {after && (
            <p className="lps-muted">
              <span className="font-semibold">{t('lp.plan.startsAfter')}</span> {after}
            </p>
          )}
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

      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-4">
        <h3 className="text-[13px] font-semibold">{t('lp.plan.tasksTitle', { n: stage.tasks.length })}</h3>
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
      </div>
      {tasks.length === 0 ? (
        <p className="px-5 pb-5 text-[12.5px] lps-muted">{t('lp.plan.noTasksInFilter')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="lps-table min-w-[760px]">
            <thead>
              <tr>
                <th>{t('lp.col.task')}</th>
                <th className="w-[150px]">{t('lp.col.status')}</th>
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
    </section>
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
              {t('lp.task.waitsFor', { what: task.blockers.map((blocker) => pick(blocker.label ?? null) || t(`lp.stageKey.${blocker.key}` as StringKey)).join(t('lp.listSeparator')) })}
            </span>
          )}
          {task.status === 'WAIVED' && task.waiveReason && <span className="text-[11.5px] lps-muted">“{task.waiveReason}”</span>}
        </span>
      </td>
      <td>
        <TaskStatusPill display={task.display} />
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
