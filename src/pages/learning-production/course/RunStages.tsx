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
import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ListChecks, SkipForward, Undo2, UserPlus, Zap } from 'lucide-react';
import { useI18n, type StringKey } from '../../../lib/i18n';
import { runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate } from '../../../lib/learningProduction/hooks';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import type { RunView, StageView, TaskSummary } from '../../../lib/learningProduction/runTypes';
import { Avatar, useToast } from '../../../components/ui';
import { BlockerList, Dot, EDGE_CLASS, IconChip, ReasonPrompt, toneOfStatus, useDay, usePick, type DotTone, type EdgeTone } from '../../../components/learning-production/studio';
import { cx } from '../../../lib/utils';

const CLOSED = new Set(['DONE', 'APPROVED', 'WAIVED']);
const EDGE_OF: Record<DotTone, EdgeTone> = { ok: 'ok', progress: 'progress', review: 'review', attention: 'attention', danger: 'danger', idle: 'idle' };

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
  const [showAll, setShowAll] = useState(Boolean(askedStage));

  return (
    <section className="lps-panel p-4 sm:p-5" aria-labelledby="lp-where">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] lps-muted">
            {current ? t('lp.run.stageOf', { n: currentIndex + 1, total: stages.length }) : t('lp.course.where')}
          </p>
          <h2 id="lp-where" className="font-display lps-gradient-text mt-0.5 text-[22px] font-bold leading-snug">
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
          <h3 className="mb-2 flex items-center gap-2.5 text-[15px] font-bold">
            <IconChip icon={Zap} tone="orange" size={15} />
            {t('lp.course.needsNow')}
          </h3>
          {current.blockers.length > 0 && (
            <div className="mb-2 text-[13px]">
              <BlockerList blockers={current.blockers} people={view.people} courseId={view.course.id} dense />
            </div>
          )}
          <TaskLines tasks={ordered(current.tasks)} view={view} />
        </div>
      )}

      <div className="mt-6 border-t pt-4" style={{ borderColor: 'var(--lps-line)' }}>
        <button type="button" className="flex w-full items-center gap-2.5 text-start" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          <IconChip icon={ListChecks} tone="violet" size={15} />
          <span className="text-[15px] font-bold">{t('lp.course.allStages')}</span>
          <span className="lps-count">{stages.length}</span>
          <span className="ms-auto text-[13px] font-semibold text-[color:var(--lps-action)]">{showAll ? t('lp.course.hideStages') : t('lp.course.showStages')}</span>
          <ChevronDown size={16} aria-hidden="true" className={cx('text-[color:var(--lps-action)] transition-transform duration-200', showAll && 'rotate-180')} />
        </button>
        {showAll && (
          <div className="mt-3">
            <StageList view={view} initial={askedStage ?? view.currentStage} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function StageList({ view, initial }: { view: RunView; initial: string | null }) {
  const [open, setOpen] = useState<string | null>(initial);
  return (
    <ol className="lps-timeline">
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
  const percent = stage.progress.total ? Math.round((stage.progress.done / stage.progress.total) * 100) : 0;

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
    <li className="lps-tl-item" data-state={stage.status} data-current={current ? 'true' : undefined}>
      <button type="button" className="lps-tl-head" aria-expanded={open} onClick={onToggle}>
        <span className="lps-tl-dot" aria-hidden="true">
          {done ? <Check size={14} strokeWidth={3} /> : skipped ? <SkipForward size={12} /> : index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx('block text-[14.5px]', current ? 'font-bold' : 'font-semibold', skipped && 'line-through lps-muted', !current && !done && !skipped && stage.status === 'BLOCKED' && 'lps-muted')}>{pick(stage.label)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] lps-muted">
            {stage.progress.total > 0 && (
              <span className="inline-flex items-center gap-2">
                <span className="lps-tl-mini" aria-hidden="true">
                  <span style={{ width: `${percent}%` }} />
                </span>
                {t('lp.course.tasksDone', { done: stage.progress.done, total: stage.progress.total })}
              </span>
            )}
            {stage.completedAt && done && <span>{day(stage.completedAt)}</span>}
            {stage.issues.open > 0 && <span className="font-semibold text-amber-700">{t('lp.plan.openIssues', { n: stage.issues.open })}</span>}
          </span>
        </span>
        <Dot tone={current ? 'progress' : STAGE_DOT[stage.status] ?? 'idle'} className="text-[12.5px]">
          {current ? t('lp.plan.now') : stage.status === 'BLOCKED' ? t('lp.course.stageLater') : t(`lp.stageStatus.${stage.status}` as StringKey)}
        </Dot>
        <ChevronDown size={16} aria-hidden="true" className={cx('shrink-0 lps-faint transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="lps-tl-body space-y-3">
          {stage.description && <p className="text-[13.5px] leading-relaxed lps-muted">{pick(stage.description)}</p>}
          {stage.skipReason && (
            <p className="text-[13px]">
              <strong>{t('lp.plan.skipReason')}</strong> {stage.skipReason}
            </p>
          )}
          {stage.blockers.length > 0 && (
            <div className="rounded-xl px-3.5 py-2.5 text-[13px]" style={{ background: 'var(--lps-sunken)' }}>
              <p className="mb-1 font-semibold">{t('lp.course.startsWhen')}</p>
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

/** A stage's tasks as small cards: who holds it, what it is, its state and date. */
export function TaskLines({ tasks, view }: { tasks: TaskSummary[]; view: RunView }) {
  const { t, dir } = useI18n();
  const Chevron = dir === 'rtl' ? ChevronLeft : ChevronRight;
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
    <ul className="lps-list grid gap-2">
      {tasks.map((task) => {
        const auto = task.kind === 'AUTO';
        const closed = CLOSED.has(task.display);
        const waiting = task.display === 'BLOCKED';
        const person = task.assigneeUserId ? view.people[task.assigneeUserId] : null;
        const who = auto
          ? t('lp.task.automatic')
          : task.assigneeUserId
            ? person?.name ?? t('common.removedUser')
            : task.role
              ? t(`lp.role.${task.role}` as StringKey)
              : t('lp.people.unassigned');
        const late = task.dueState === 'OVERDUE' && !closed;
        const edge = closed ? 'ok' : late ? 'danger' : waiting ? 'idle' : EDGE_OF[toneOfStatus(task.display)];
        return (
          <li key={task.id}>
            <button type="button" className={cx('lps-task-card group', EDGE_CLASS[edge], closed && 'opacity-75')} onClick={() => open(task.id)}>
              <span className="shrink-0" aria-hidden="true">
                {auto ? (
                  <span className="lps-task-avatar lps-icon-slate">
                    <Bot size={15} />
                  </span>
                ) : person ? (
                  <Avatar name={person.name} color={person.avatarColor ?? '#94A3B8'} size={34} />
                ) : (
                  <span className="lps-task-avatar lps-task-avatar-empty">
                    <UserPlus size={15} />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 text-start">
                <span className={cx('block text-[14px] font-semibold leading-snug', closed && 'lps-muted')}>{pick(task.label)}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]">
                  <Dot tone={closed ? 'ok' : waiting ? 'idle' : toneOfStatus(task.display)}>{waiting ? t('lp.course.stageLater') : t(`lp.taskStatus.${task.display}` as StringKey)}</Dot>
                  <span className="lps-bidi lps-muted">{who}</span>
                  {auto && task.gate && <span className="lps-muted">{t('lp.gate.progress', { done: task.gate.done, total: task.gate.total })}</span>}
                  {task.dueDate && !closed && (
                    <span className={late ? 'font-semibold text-[color:var(--lps-danger)]' : 'lps-muted'}>
                      {late ? t('lp.home.lateSince', { day: day(task.dueDate) }) : t('lp.home.due', { day: day(task.dueDate) })}
                    </span>
                  )}
                </span>
              </span>
              <Chevron size={16} aria-hidden="true" className="shrink-0 lps-faint transition-transform duration-200 group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
