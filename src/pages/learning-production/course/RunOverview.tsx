/**
 * A run at a glance.
 *
 * The questions a manager opens a course to answer, in the order they ask
 * them: where is it, what is the next gate and who holds it, how healthy is
 * it and why, what is waiting for approval, what is late. Then the four
 * answers about progress, kept apart — content, workflow, release readiness
 * and publication — each with the arithmetic behind it, so nobody reads
 * "100%" off the lesson assets and thinks the program is done.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Circle, Clock3, History, Layers, Rocket } from 'lucide-react';
import { useI18n, type StringKey } from '../../../lib/i18n';
import { runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate } from '../../../lib/learningProduction/hooks';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import type { RunView, StageView } from '../../../lib/learningProduction/runTypes';
import { useToast } from '../../../components/ui';
import {
  BlockerList,
  Busy,
  DueTag,
  EmptyNote,
  HealthPill,
  LoadingRows,
  Meter,
  Panel,
  PersonLine,
  Pill,
  ReleaseStatusPill,
  TaskStatusPill,
  useDay,
  usePick,
} from '../../../components/learning-production/studio';
import { useCourse } from '../CourseWorkspace';
import { cx } from '../../../lib/utils';

export function RunOverview() {
  const { t } = useI18n();
  const { run, runs, detail } = useCourse();

  if (runs && runs.runs.length === 0) {
    return (
      <div className="lps-panel">
        <EmptyNote
          icon={Layers}
          title={t('lp.run.noneTitle')}
          body={t('lp.run.noneBody')}
          action={
            runs.capabilities.manageRuns ? (
              <Link to={`/learning-production/runs/new?course=${detail.course.id}`} className="lps-btn-primary">
                {t('lp.run.new')}
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }
  if (!run) return <LoadingRows rows={6} />;
  if (run.run.scenario === 'LEGACY') return <LegacyOverview view={run} />;
  return <WorkflowOverview view={run} />;
}

/* ------------------------------------------------------------------ */

export function StageStrip({ stages, current, courseId, compact = false }: { stages: StageView[]; current: string | null; courseId: string; compact?: boolean }) {
  const { t } = useI18n();
  const pick = usePick();
  return (
    <ol className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1" aria-label={t('lp.plan.stages')}>
      {stages.map((stage, index) => (
        <li
          key={stage.id}
          className={cx('lps-step', compact ? 'min-w-[92px]' : 'min-w-[118px]')}
          data-state={stage.status}
          data-current={stage.key === current}
          data-attention={stage.issues.blocking > 0}
          aria-current={stage.key === current ? 'step' : undefined}
        >
          <Link to={`/learning-production/courses/${courseId}/plan?stage=${stage.key}`} className="block w-full min-w-0 hover:underline" title={pick(stage.label)}>
            <span className="block text-[11px] lps-faint">
              {index + 1} · {t(`lp.stageStatus.${stage.status}` as StringKey)}
            </span>
            <span className={cx('block truncate text-[12.5px]', stage.key === current ? 'font-semibold' : 'lps-muted')}>{pick(stage.label)}</span>
            {!compact && stage.progress.total > 0 && (
              <span className="block text-[11px] lps-faint">
                {stage.progress.done}/{stage.progress.total}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ol>
  );
}

function WorkflowOverview({ view }: { view: RunView }) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const courseId = view.course.id;
  const people = view.people;
  const gate = view.nextGate;
  const progress = view.progress;
  const taskLink = (id: string) => `/learning-production/courses/${courseId}/plan?task=${id}`;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="min-w-0 space-y-4 xl:col-span-2">
        <Panel title={t('lp.overview.where')} bodyClassName="p-4 pt-3">
          <StageStrip stages={view.stages} current={view.currentStage} courseId={courseId} />
        </Panel>

        <Panel
          title={gate ? t('lp.overview.nextGate', { stage: pick(gate.label) }) : t('lp.overview.allDone')}
          action={gate ? <Link to={`/learning-production/courses/${courseId}/plan?stage=${gate.stageKey}`} className="lps-btn">{t('lp.overview.openStage')}</Link> : undefined}
          bodyClassName="p-0"
        >
          {!gate ? (
            <EmptyNote icon={CheckCircle2} title={t('lp.overview.allDoneBody')} />
          ) : (
            <>
              {gate.blockers.length > 0 && (
                <div className="border-b px-4 py-3" style={{ borderColor: 'var(--lps-line)' }}>
                  <p className="mb-1.5 text-[12.5px] font-semibold">{t('lp.overview.stageWaits')}</p>
                  <BlockerList blockers={gate.blockers} people={people} courseId={courseId} />
                </div>
              )}
              <ul>
                {gate.pending.map((task) => (
                  <li key={task.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--lps-line)' }}>
                    <Link to={taskLink(task.id)} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-[color:var(--lps-sunken)]">
                      <TaskStatusPill display={task.display} />
                      <span className="min-w-[10rem] flex-1 text-[13.5px] font-medium">{pick(task.label)}</span>
                      {task.kind === 'AUTO' && task.gate ? (
                        <span className="text-[12px] lps-muted">{t('lp.gate.progress', { done: task.gate.done, total: task.gate.total })}</span>
                      ) : (
                        <PersonLine userId={task.assigneeUserId} people={people} fallback={task.role ? t(`lp.role.${task.role}` as StringKey) : undefined} />
                      )}
                      <DueTag dueDate={task.dueDate} dueState={task.dueState} />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title={t('lp.overview.approvals', { n: view.pendingApprovals.length })} bodyClassName="p-0">
            {view.pendingApprovals.length === 0 ? (
              <p className="px-4 py-3 text-[13px] lps-muted">{t('lp.overview.noApprovals')}</p>
            ) : (
              <ul>
                {view.pendingApprovals.map((task) => (
                  <li key={task.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--lps-line)' }}>
                    <Link to={taskLink(task.id)} className="block px-4 py-2.5 hover:bg-[color:var(--lps-sunken)]">
                      <span className="block truncate text-[13px] font-medium">{pick(task.label)}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-[12px] lps-muted">
                        {t('lp.overview.reviewer')}
                        <PersonLine userId={task.reviewerUserId} people={people} fallback={task.reviewerRole ? t(`lp.role.${task.reviewerRole}` as StringKey) : undefined} size={16} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t px-4 py-2 text-[12px] lps-muted" style={{ borderColor: 'var(--lps-line)' }}>
              <Link to={`/learning-production/courses/${courseId}/production?quick=REVIEW`} className="hover:underline">
                {t('lp.overview.assetReviews')}
              </Link>
            </p>
          </Panel>

          <Panel title={t('lp.overview.overdue', { n: view.overdueTasks.length + view.assetLoad.overdue })} bodyClassName="p-0">
            {view.overdueTasks.length === 0 && view.assetLoad.overdue === 0 ? (
              <p className="px-4 py-3 text-[13px] lps-muted">{t('lp.overview.noOverdue')}</p>
            ) : (
              <ul>
                {view.overdueTasks.map((task) => (
                  <li key={task.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--lps-line)' }}>
                    <Link to={taskLink(task.id)} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-[color:var(--lps-sunken)]">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{pick(task.label)}</span>
                        <PersonLine userId={task.assigneeUserId} people={people} size={16} />
                      </span>
                      <DueTag dueDate={task.dueDate} dueState={task.dueState} />
                    </Link>
                  </li>
                ))}
                {view.assetLoad.overdue > 0 && (
                  <li>
                    <Link to={`/learning-production/courses/${courseId}/production?quick=OVERDUE`} className="block px-4 py-2.5 text-[13px] hover:bg-[color:var(--lps-sunken)]">
                      {t('lp.overview.assetsOverdue', { n: view.assetLoad.overdue })}
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <Panel title={t('lp.overview.progress')}>
          <ProgressBlock
            label={t('lp.progress.workflow')}
            percent={progress.workflow.percent}
            explain={t('lp.progress.workflowExplain', { done: progress.workflow.done, total: progress.workflow.total })}
            extra={
              progress.workflow.waived || progress.workflow.skippedStages
                ? t('lp.progress.waivedExplain', { waived: progress.workflow.waived, skipped: progress.workflow.skippedStages })
                : undefined
            }
          />
          <div className="mt-4">
            <ProgressBlock
              label={t('lp.progress.content')}
              percent={progress.content.percent}
              tone="ok"
              explain={
                progress.content.total
                  ? t('lp.progress.contentExplain', { done: progress.content.done, total: progress.content.total })
                  : t('lp.progress.contentNone')
              }
              extra={progress.content.percent === 100 && progress.workflow.percent < 100 ? t('lp.progress.contentNotDone') : undefined}
            />
          </div>
          <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--lps-line)' }}>
            <p className="mb-2 text-[12.5px] font-semibold">{t('lp.progress.readiness')}</p>
            <Readiness view={view} />
          </div>
          <div className="mt-3 border-t pt-3 text-[12.5px]" style={{ borderColor: 'var(--lps-line)' }}>
            {progress.published ? (
              <span className="flex items-center gap-2" style={{ color: 'var(--lps-ok)' }}>
                <Rocket size={14} aria-hidden="true" />
                {t('lp.progress.published', { label: progress.published.versionLabel, day: day(progress.published.publishedAt, { year: true }) })}
              </span>
            ) : (
              <span className="lps-muted">{t('lp.progress.notPublished')}</span>
            )}
          </div>
        </Panel>

        <Panel title={t('lp.overview.health')}>
          <HealthPill health={view.health.health} />
          {view.health.reasons.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[12.5px] lps-muted">
              {view.health.reasons.map((reason) => (
                <li key={reason.code} className="flex gap-1.5">
                  <AlertTriangle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {t(`lp.healthReason.${reason.code}` as StringKey, reason as Record<string, string | number>)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] lps-muted">{t('lp.overview.healthy')}</p>
          )}
        </Panel>

        <Panel title={t('lp.overview.who')}>
          <dl className="space-y-2 text-[12.5px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="lps-muted">{t('lp.field.manager')}</dt>
              <dd>
                <PersonLine userId={view.run.managerUserId} people={people} />
              </dd>
            </div>
            {gate &&
              [...new Set(gate.pending.map((task) => task.assigneeUserId).filter(Boolean))].map((userId) => (
                <div key={userId} className="flex items-center justify-between gap-2">
                  <dt className="lps-muted">{t('lp.overview.onTheGate')}</dt>
                  <dd>
                    <PersonLine userId={userId} people={people} />
                  </dd>
                </div>
              ))}
          </dl>
          {view.template && (
            <p className="mt-3 border-t pt-2 text-[11.5px] lps-faint" style={{ borderColor: 'var(--lps-line)' }}>
              {t('lp.overview.template', { version: view.template.versionNumber })}
            </p>
          )}
        </Panel>

        {view.releases.length > 0 && (
          <Panel title={t('lp.overview.releases')} bodyClassName="p-0">
            <ul>
              {view.releases.slice(0, 4).map((release) => (
                <li key={release.id} className="flex items-center justify-between gap-2 border-b px-4 py-2 text-[12.5px] last:border-b-0" style={{ borderColor: 'var(--lps-line)' }}>
                  <Link to={`/learning-production/courses/${courseId}/qa?release=${release.id}`} className="font-semibold hover:underline">
                    {release.versionLabel}
                  </Link>
                  <ReleaseStatusPill status={release.status} />
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}

function ProgressBlock({ label, percent, explain, extra, tone = 'accent' }: { label: string; percent: number; explain: string; extra?: string; tone?: 'accent' | 'ok' }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-semibold">{label}</span>
        <span className="font-display text-[18px] font-semibold">{percent}%</span>
      </div>
      <Meter value={percent} tone={tone} label={label} />
      <p className="mt-1 text-[12px] lps-muted">{explain}</p>
      {extra && <p className="mt-0.5 text-[12px]" style={{ color: 'var(--lps-attention)' }}>{extra}</p>}
    </div>
  );
}

/** Each release check, true or not, and what it is waiting for. */
export function Readiness({ view }: { view: RunView }) {
  const { t } = useI18n();
  const checks = view.progress.readiness.checks;
  return (
    <ul className="space-y-1.5 text-[12.5px]">
      {checks.map((check) => (
        <li key={check.id} className="flex gap-2">
          {check.ok ? (
            <CheckCircle2 size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'var(--lps-ok)' }} />
          ) : check.gate ? (
            <Clock3 size={15} aria-hidden="true" className="mt-0.5 shrink-0 lps-faint" />
          ) : (
            <Circle size={15} aria-hidden="true" className="mt-0.5 shrink-0 lps-faint" />
          )}
          <span className="min-w-0">
            <span className={check.ok ? '' : 'font-medium'}>{t(`lp.readiness.${check.id}` as StringKey)}</span>
            <span className="sr-only"> — {check.ok ? t('lp.readiness.met') : t('lp.readiness.notMet')}</span>
            {!check.ok && check.id === 'STAGES_COMPLETE' && check.open?.length ? (
              <span className="block lps-muted">{t('lp.readiness.openStages', { stages: check.open.map((key) => t(`lp.stageKey.${key}` as StringKey)).join('، ') })}</span>
            ) : null}
            {check.id === 'CONTENT_APPROVED' && check.total !== undefined ? (
              <span className="block lps-muted">{t('lp.progress.contentExplain', { done: check.done ?? 0, total: check.total })}</span>
            ) : null}
            {!check.ok && check.id === 'NO_BLOCKING_ISSUES' ? <span className="block lps-muted">{t('lp.readiness.blockingIssues', { n: check.count ?? 0 })}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */

function LegacyOverview({ view }: { view: RunView }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const canManage = view.capabilities.manageRuns && (view.run.status === 'ACTIVE' || view.run.status === 'ON_HOLD');

  async function adopt(scenario: 'EXPERT_NEW' | 'AI_NEW') {
    setBusy(scenario);
    try {
      await runsApi.adopt(view.run.id, scenario);
      invalidate();
      toast.push(t('lp.legacy.adopted'));
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel title={t('lp.legacy.title')} className="lg:col-span-2">
        <div className="flex gap-3">
          <History size={20} aria-hidden="true" className="mt-0.5 shrink-0 lps-muted" />
          <div className="space-y-2 text-[13.5px]">
            <p>{t('lp.legacy.body')}</p>
            <p className="lps-muted">{t('lp.legacy.nothingAssumed')}</p>
          </div>
        </div>
        {canManage && (
          <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--lps-line)' }}>
            <p className="mb-2 text-[13px] font-semibold">{t('lp.legacy.adoptTitle')}</p>
            <p className="mb-3 text-[12.5px] lps-muted">{t('lp.legacy.adoptBody')}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="lps-btn-primary" disabled={Boolean(busy)} onClick={() => adopt('EXPERT_NEW')}>
                {busy === 'EXPERT_NEW' && <Busy />}
                {t('lp.legacy.adoptExpert')}
              </button>
              <button type="button" className="lps-btn" disabled={Boolean(busy)} onClick={() => adopt('AI_NEW')}>
                {busy === 'AI_NEW' && <Busy />}
                {t('lp.legacy.adoptAi')}
              </button>
              <Link to={`/learning-production/runs/new?course=${view.course.id}&scenario=REVAMP`} className="lps-btn">
                {t('lp.legacy.revamp')}
              </Link>
            </div>
          </div>
        )}
      </Panel>
      <Panel title={t('lp.overview.progress')}>
        <ProgressBlock
          label={t('lp.progress.content')}
          percent={view.progress.content.percent}
          tone="ok"
          explain={view.progress.content.total ? t('lp.progress.contentExplain', { done: view.progress.content.done, total: view.progress.content.total }) : t('lp.progress.contentNone')}
        />
        <p className="mt-3 flex items-center gap-2 text-[12.5px] lps-muted">
          <Pill tone="outline">{t('lp.readiness.notAssessed')}</Pill>
        </p>
      </Panel>
    </div>
  );
}
