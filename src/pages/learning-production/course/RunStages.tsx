/**
 * Where a production run is, on the course page.
 *
 * The stage it is in, a short bar per stage to show how far along it is, and
 * the tasks of that stage — the work that matters today. Every other stage
 * is one fold away: a list in order, where opening a stage shows its tasks
 * in the same simple lines. A task opens its drawer; nothing here is a tab.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, SkipForward, Undo2 } from 'lucide-react';
import { useI18n, type StringKey } from '../../../lib/i18n';
import { runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate } from '../../../lib/learningProduction/hooks';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import type { RunView, StageView, TaskSummary } from '../../../lib/learningProduction/runTypes';
import { useToast } from '../../../components/ui';
import { BlockerList, Disclosure, Dot, ReasonPrompt, toneOfStatus, useDay, usePick, type DotTone } from '../../../components/learning-production/studio';
import { cx } from '../../../lib/utils';

const CLOSED = new Set(['DONE', 'APPROVED', 'WAIVED']);

/** Open work first, finished work last; the order of the plan otherwise. */
function ordered(tasks: TaskSummary[]) {
  return [...tasks].sort((a, b) => Number(CLOSED.has(a.display)) - Number(CLOSED.has(b.display)));
}

export function RunStages({ view }: { view: RunView }) {
  const { t } = useI18n();
  const pick = usePick();
  const [params] = useSearchParams();
  const stages = view.stages;
  const currentIndex = stages.findIndex((stage) => stage.key === view.currentStage);
  const current = currentIndex >= 0 ? stages[currentIndex] : null;
  const next = currentIndex >= 0 ? stages.slice(currentIndex + 1).find((stage) => stage.status !== 'SKIPPED') : null;
  const doneStages = stages.filter((stage) => stage.status === 'DONE' || stage.status === 'SKIPPED').length;
  const askedStage = params.get('stage');

  return (
    <section className="lps-panel p-4 sm:p-5" aria-labelledby="lp-where">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] lps-muted">
            {current ? t('lp.run.stageOf', { n: currentIndex + 1, total: stages.length }) : t('lp.course.where')}
          </p>
          <h2 id="lp-where" className="font-display mt-0.5 text-[20px] font-bold leading-snug">
            {view.run.status === 'RELEASED' ? t('lp.course.released') : current ? pick(current.label) : t('lp.course.allStagesDone')}
          </h2>
          {next && <p className="mt-1 text-[13px] lps-muted">{t('lp.course.thenStage', { stage: pick(next.label) })}</p>}
        </div>
        <p className="text-[13px] lps-muted">{t('lp.course.stagesDone', { done: doneStages, total: stages.length })}</p>
      </div>

      <div className="lps-track mt-4" aria-hidden="true">
        {stages.map((stage) => (
          <span key={stage.key} data-state={stage.status} data-current={stage.key === view.currentStage ? 'true' : undefined} title={pick(stage.label)} />
        ))}
      </div>

      {current && (
        <div className="mt-5">
          <h3 className="mb-1 text-[14px] font-bold">{t('lp.course.needsNow')}</h3>
          {current.blockers.length > 0 && (
            <div className="mb-2 text-[13px]">
              <BlockerList blockers={current.blockers} people={view.people} courseId={view.course.id} dense />
            </div>
          )}
          <TaskLines tasks={ordered(current.tasks)} view={view} />
        </div>
      )}

      <Disclosure title={t('lp.course.allStages')} count={stages.length} defaultOpen={Boolean(askedStage)} className="mt-4 !border-0 !bg-transparent [&>summary]:!px-0 [&>div]:!px-0">
        <StageList view={view} initial={askedStage} />
      </Disclosure>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function StageList({ view, initial }: { view: RunView; initial: string | null }) {
  const [open, setOpen] = useState<string | null>(initial);
  return (
    <ol className="lps-panel lps-list">
      {view.stages.map((stage, index) => (
        <StageRow key={stage.key} stage={stage} index={index} view={view} open={open === stage.key} onToggle={() => setOpen((value) => (value === stage.key ? null : stage.key))} />
      ))}
    </ol>
  );
}

const STAGE_DOT: Record<string, DotTone> = { DONE: 'ok', IN_PROGRESS: 'progress', READY: 'progress', BLOCKED: 'idle', SKIPPED: 'idle' };

function StageRow({ stage, index, view, open, onToggle }: { stage: StageView; index: number; view: RunView; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const toast = useToast();
  const [prompt, setPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = stage.key === view.currentStage;
  const done = stage.status === 'DONE';
  const skipped = stage.status === 'SKIPPED';
  const canManage = view.capabilities.manageRuns && view.runOpen;
  const conditionalOnly = stage.tasks.filter((task) => task.classification !== 'OPTIONAL').every((task) => task.classification === 'CONDITIONAL');
  const canSkip = canManage && !done && !skipped && (Boolean(stage.skippable) || conditionalOnly || view.capabilities.isAdmin);

  async function act(work: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await work();
      invalidate();
      if (success) toast.push(success);
      setPrompt(false);
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <button type="button" className="lps-line w-full text-start hover:bg-[#f8f9fb]" aria-expanded={open} onClick={onToggle}>
        <span
          aria-hidden="true"
          className={cx(
            'grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold',
            done && 'bg-emerald-500 text-white',
            current && !done && 'bg-[image:var(--lps-grad)] text-white',
            !done && !current && 'border border-[#d5d9e0] bg-white lps-muted'
          )}
        >
          {done ? <Check size={14} strokeWidth={3} /> : skipped ? <SkipForward size={12} /> : index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx('block text-[14px]', current ? 'font-bold' : 'font-medium', skipped && 'line-through lps-muted')}>{pick(stage.label)}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-[12.5px] lps-muted">
            {stage.progress.total > 0 && <span>{t('lp.course.tasksDone', { done: stage.progress.done, total: stage.progress.total })}</span>}
            {stage.completedAt && done && <span>{day(stage.completedAt)}</span>}
            {stage.issues.open > 0 && <span className="font-semibold text-amber-700">{t('lp.plan.openIssues', { n: stage.issues.open })}</span>}
          </span>
        </span>
        <Dot tone={current ? 'progress' : STAGE_DOT[stage.status] ?? 'idle'} className="text-[12.5px]">
          {current ? t('lp.plan.now') : t(`lp.stageStatus.${stage.status}` as StringKey)}
        </Dot>
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4 sm:px-5">
          {stage.description && <p className="text-[13.5px] leading-relaxed lps-muted">{pick(stage.description)}</p>}
          {stage.skipReason && (
            <p className="text-[13px]">
              <strong>{t('lp.plan.skipReason')}</strong> {stage.skipReason}
            </p>
          )}
          {stage.blockers.length > 0 && (
            <div className="text-[13px]">
              <p className="mb-1 font-semibold">{t('lp.plan.waitsFor')}</p>
              <BlockerList blockers={stage.blockers} people={view.people} courseId={view.course.id} dense />
            </div>
          )}
          <TaskLines tasks={ordered(stage.tasks)} view={view} />
          {(canSkip || (canManage && skipped)) && (
            <div className="flex justify-end">
              {canSkip ? (
                <button type="button" className="lps-btn-quiet" onClick={() => setPrompt(true)}>
                  <SkipForward size={14} aria-hidden="true" />
                  {t('lp.plan.skip')}
                </button>
              ) : (
                <button type="button" className="lps-btn" disabled={busy} onClick={() => act(() => runsApi.unskipStage(stage.id))}>
                  <Undo2 size={14} aria-hidden="true" />
                  {t('lp.plan.unskip')}
                </button>
              )}
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
        onConfirm={(reason) => act(() => runsApi.skipStage(stage.id, reason), t('lp.plan.skipped'))}
      />
    </li>
  );
}

/* ------------------------------------------------------------------ */

/** A stage's tasks, one plain line each: what, its state, who holds it, when. */
export function TaskLines({ tasks, view }: { tasks: TaskSummary[]; view: RunView }) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const [params, setParams] = useSearchParams();
  if (tasks.length === 0) return <p className="py-2 text-[13px] lps-muted">{t('lp.course.noTasks')}</p>;

  const open = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('task', id);
    setParams(next);
  };

  return (
    <ul className="lps-list -mx-4 sm:-mx-5">
      {tasks.map((task) => {
        const auto = task.kind === 'AUTO';
        const closed = CLOSED.has(task.display);
        const waiting = task.display === 'BLOCKED';
        const who = auto
          ? t('lp.task.automatic')
          : task.assigneeUserId
            ? view.people[task.assigneeUserId]?.name ?? t('common.removedUser')
            : task.role
              ? t(`lp.role.${task.role}` as StringKey)
              : t('lp.people.unassigned');
        const late = task.dueState === 'OVERDUE' && !closed;
        return (
          <li key={task.id}>
            <button type="button" className="lps-line w-full text-start hover:bg-[#f8f9fb]" onClick={() => open(task.id)}>
              <span className="min-w-0 flex-1">
                <span className={cx('block text-[14px] font-medium', closed && 'lps-muted')}>{pick(task.label)}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                  <Dot tone={waiting ? 'idle' : toneOfStatus(task.display)}>{t(`lp.taskStatus.${task.display}` as StringKey)}</Dot>
                  <span className="lps-bidi lps-muted">{who}</span>
                  {auto && task.gate && <span className="lps-muted">{t('lp.gate.progress', { done: task.gate.done, total: task.gate.total })}</span>}
                  {task.dueDate && !closed && (
                    <span className={late ? 'font-semibold text-[color:var(--lps-danger)]' : 'lps-muted'}>
                      {late ? t('lp.home.lateSince', { day: day(task.dueDate) }) : t('lp.home.due', { day: day(task.dueDate) })}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
