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
import { BadgeCheck, Bot, ChevronLeft, ChevronRight, Circle, Clapperboard, ClipboardCheck, FileCheck2, FileText, FlaskConical, FolderInput, GitCompare, MonitorPlay, PenTool, Presentation, Rocket, Route, ScrollText, Search, SkipForward, Sparkles, Undo2, UploadCloud, UserPlus, UserSearch, Users, Wrench, Zap, type LucideIcon } from 'lucide-react';
import { useI18n, type StringKey } from '../../../lib/i18n';
import { runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate } from '../../../lib/learningProduction/hooks';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import type { RunView, StageView, TaskSummary } from '../../../lib/learningProduction/runTypes';
import { Avatar, useToast } from '../../../components/ui';
import { BlockerList, Dot, EDGE_CLASS, IconChip, JourneyMap, ReasonPrompt, toneOfStatus, useDay, usePick, type DotTone, type EdgeTone, type JourneyNode, type JourneyState } from '../../../components/learning-production/studio';
import { cx } from '../../../lib/utils';

const CLOSED = new Set(['DONE', 'APPROVED', 'WAIVED']);
const EDGE_OF: Record<DotTone, EdgeTone> = { ok: 'ok', progress: 'progress', review: 'review', attention: 'attention', danger: 'danger', idle: 'idle' };

/** Open work first, finished work last; the order of the plan otherwise. */
function ordered(tasks: TaskSummary[]) {
  return [...tasks].sort((a, b) => Number(CLOSED.has(a.display)) - Number(CLOSED.has(b.display)));
}

// Each stage's station on the road gets an icon for what happens there.
const STAGE_ICON: Record<string, LucideIcon> = {
  CHANGE_IMPACT: GitCompare,
  AI_INPUT: FolderInput,
  AI_OUTLINES: Sparkles,
  AI_OUTLINE_REVIEW: ClipboardCheck,
  RESEARCH: Search,
  CURRICULUM_DRAFT: FileText,
  EXPERT_ACQUISITION: UserSearch,
  FINAL_CURRICULUM: FileCheck2,
  AI_SCRIPTS: ScrollText,
  AI_SCRIPT_REVIEW: ClipboardCheck,
  AI_SLIDES: Presentation,
  AI_VOICE_VIDEO: Clapperboard,
  AI_VIDEO_REVIEW: MonitorPlay,
  AI_COMMENTS_FIX: Wrench,
  AI_COMMENTS_VERIFY: BadgeCheck,
  INSTRUCTIONAL_DESIGN: PenTool,
  MEDIA_PRODUCTION: Clapperboard,
  PLATFORM_DEPLOYMENT: UploadCloud,
  DRY_RUN_1: FlaskConical,
  APPLY_CHANGES: Wrench,
  DRY_RUN_FIXES: Wrench,
  APPLY_DRY_RUN_COMMENTS: Wrench,
  REDEPLOYMENT: UploadCloud,
  DRY_RUN_2: FlaskConical,
  UAT: Users,
  RELEASE: Rocket,
};

function journeyState(stage: StageView, current: boolean): JourneyState {
  if (current) return 'current';
  if (stage.status === 'DONE') return 'done';
  if (stage.status === 'SKIPPED') return 'skipped';
  if (stage.status === 'READY' || stage.status === 'IN_PROGRESS') return 'next';
  return 'later';
}

/**
 * The run as a journey: every stage a station on one road, the current one
 * flagged. Choosing a station shows what it is for and its tasks right
 * under the road; the current stage is chosen until someone picks another.
 */
export function RunStages({ view }: { view: RunView }) {
  const { t } = useI18n();
  const pick = usePick();
  const [params, setParams] = useSearchParams();
  const stages = view.stages;
  const currentIndex = stages.findIndex((stage) => stage.key === view.currentStage);
  const doneStages = stages.filter((stage) => stage.status === 'DONE' || stage.status === 'SKIPPED').length;
  const asked = params.get('stage');
  const selectedKey = asked && stages.some((stage) => stage.key === asked) ? asked : view.currentStage ?? stages.find((stage) => stage.status !== 'DONE')?.key ?? stages[stages.length - 1]?.key ?? null;
  const selected = stages.find((stage) => stage.key === selectedKey) ?? null;

  const select = (key: string) => {
    const next = new URLSearchParams(params);
    if (key === view.currentStage) next.delete('stage');
    else next.set('stage', key);
    setParams(next, { replace: true });
  };

  const nodes: JourneyNode[] = stages.map((stage) => ({
    key: stage.key,
    label: pick(stage.label),
    sub: stage.progress.total > 0 ? t('lp.plan.stageProgress', { done: stage.progress.done, total: stage.progress.total }) : undefined,
    state: journeyState(stage, stage.key === view.currentStage),
    icon: STAGE_ICON[stage.key] ?? Circle,
  }));

  return (
    <section className="lps-panel overflow-hidden" aria-labelledby="lp-where">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-4 sm:px-5">
        <h2 id="lp-where" className="flex items-center gap-2.5 text-[16px] font-bold">
          <IconChip icon={Route} tone="violet" size={15} />
          {t('lp.course.journey')}
        </h2>
        <p className="text-[13px] lps-muted">
          {view.run.status === 'RELEASED'
            ? t('lp.course.released')
            : currentIndex >= 0
              ? `${t('lp.run.stageOf', { n: currentIndex + 1, total: stages.length })} · ${t('lp.course.stagesDone', { done: doneStages, total: stages.length })}`
              : t('lp.course.allStagesDone')}
        </p>
      </header>

      <div className="px-2 sm:px-3">
        <JourneyMap nodes={nodes} selected={selectedKey} onSelect={select} label={t('lp.course.journey')} nowLabel={t('lp.plan.now')} />
      </div>

      {selected && <StageDetail key={selected.key} stage={selected} index={stages.indexOf(selected)} view={view} />}
    </section>
  );
}

const STAGE_DOT: Record<string, DotTone> = { DONE: 'ok', IN_PROGRESS: 'progress', READY: 'progress', BLOCKED: 'idle', SKIPPED: 'idle' };

/** The chosen station: what it is for, what it waits for, its tasks, and — for a manager — skipping it. */
function StageDetail({ stage, index, view }: { stage: StageView; index: number; view: RunView }) {
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
  const next = view.stages.slice(index + 1).find((entry) => entry.status !== 'SKIPPED');

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
    <div className="lps-stage-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold lps-muted">{t('lp.run.stageOf', { n: index + 1, total: view.stages.length })}</p>
          <h3 className={cx('font-display mt-0.5 text-[21px] font-bold leading-snug', current && 'lps-gradient-text')}>{pick(stage.label)}</h3>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <Dot tone={current ? 'progress' : STAGE_DOT[stage.status] ?? 'idle'}>{current ? t('lp.plan.now') : stage.status === 'BLOCKED' ? t('lp.course.stageLater') : t(`lp.stageStatus.${stage.status}` as StringKey)}</Dot>
            {stage.progress.total > 0 && <span className="lps-muted">{t('lp.course.tasksDone', { done: stage.progress.done, total: stage.progress.total })}</span>}
            {stage.completedAt && done && <span className="lps-muted">{day(stage.completedAt)}</span>}
            {stage.issues.open > 0 && <span className="font-semibold text-amber-700">{t('lp.plan.openIssues', { n: stage.issues.open })}</span>}
            {current && next && <span className="lps-muted">{t('lp.course.thenStage', { stage: pick(next.label) })}</span>}
          </p>
        </div>
        {canSkip ? (
          <button type="button" className="lps-btn-quiet" onClick={() => setPrompt(true)}>
            <SkipForward size={14} aria-hidden="true" />
            {t('lp.plan.skip')}
          </button>
        ) : canManage && skipped ? (
          <button type="button" className="lps-btn" disabled={busy} onClick={() => act(() => runsApi.unskipStage(stage.id))}>
            <Undo2 size={14} aria-hidden="true" />
            {t('lp.plan.unskip')}
          </button>
        ) : null}
      </div>

      {stage.description && <p className="mt-3 text-[14px] leading-relaxed lps-muted">{pick(stage.description)}</p>}
      {stage.skipReason && (
        <p className="mt-2 text-[13px]">
          <strong>{t('lp.plan.skipReason')}</strong> {stage.skipReason}
        </p>
      )}
      {stage.blockers.length > 0 && (
        <div className="mt-3 rounded-xl bg-white/70 px-3.5 py-2.5 text-[13px]">
          <p className="mb-1 font-semibold">{t('lp.course.startsWhen')}</p>
          <BlockerList blockers={stage.blockers} people={view.people} courseId={view.course.id} dense />
        </div>
      )}

      <div className="mt-4">
        <h4 className="mb-2 flex items-center gap-2 text-[14px] font-bold">
          <Zap size={15} aria-hidden="true" className="text-amber-500" />
          {current ? t('lp.course.needsNow') : t('lp.course.stageTasks')}
        </h4>
        <TaskLines tasks={ordered(stage.tasks)} view={view} />
      </div>

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
    </div>
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
