/**
 * One course and its production run.
 *
 * Loads the course, its runs and the run being viewed once, and gives the
 * tabs a stable frame: Overview · Plan & stages · Curriculum & lessons ·
 * Production · QA & release · Team · Files & activity. The header answers the
 * first questions — which way this run is going, where it is, how healthy it
 * is, and when it is due — and holds the run's own controls.
 *
 * A course with several runs (a revamp after a first release) shows the run
 * in flight by default; `?run=` pins another, so a link to an old run keeps
 * working.
 */

import { useState } from 'react';
import { Link, Outlet, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { BookOpenCheck, CheckCircle2, ChevronDown, Clock3, MoreHorizontal, Pause, Play, Plus, RotateCcw, Settings2, Sparkles, XCircle } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { paths } from '../../lib/learningProduction/api';
import { runPaths, runsApi } from '../../lib/learningProduction/runApi';
import { invalidate, useLpQuery } from '../../lib/learningProduction/hooks';
import type { CourseDetail } from '../../lib/learningProduction/types';
import type { RunView, RunsResponse } from '../../lib/learningProduction/runTypes';
import { useToast } from '../../components/ui';
import {
  Busy,
  ErrorNote,
  HealthPill,
  LoadingRows,
  PersonLine,
  ReasonPrompt,
  RouteTabs,
  RunStatusPill,
  ScenarioBadge,
  useDay,
  usePick,
} from '../../components/learning-production/studio';
import { lpErrorKey } from '../../lib/learningProduction/format';
import { SCENARIO_THEME, gradient } from '../../lib/learningProduction/theme';
import { useLpTheme } from './Layout';

export interface CourseOutlet {
  detail: CourseDetail;
  reload: () => Promise<void>;
  runs: RunsResponse | null;
  run: RunView | null;
  runId: string | null;
  reloadRun: () => Promise<void>;
}

export function useCourse() {
  return useOutletContext<CourseOutlet>();
}

export function CourseWorkspace() {
  const { courseId = '' } = useParams();
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: detail, error, loading, reload } = useLpQuery<CourseDetail>(paths.course(courseId));
  const { data: runs, reload: reloadRuns } = useLpQuery<RunsResponse>(runPaths.courseRuns(courseId));
  const runId = params.get('run') ?? runs?.currentRunId ?? null;
  const { data: run, error: runError, reload: reloadRunView } = useLpQuery<RunView>(runId ? runPaths.run(runId) : null);
  const [menu, setMenu] = useState(false);
  const [prompt, setPrompt] = useState<'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  // Before any early return: a hook must run on every render.
  const scenarioTheme = run ? SCENARIO_THEME[run.run.scenario] : null;
  useLpTheme(scenarioTheme);

  if (loading && !detail) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-20 w-full" />
        <LoadingRows rows={5} />
      </div>
    );
  }
  if (error && !detail) return <ErrorNote error={error} onRetry={reload} />;
  if (!detail) return null;

  const { course } = detail;
  const legacy = run?.run.scenario === 'LEGACY';
  const canManage = Boolean(run?.capabilities.manageRuns);
  const openStatus = run && (run.run.status === 'ACTIVE' || run.run.status === 'ON_HOLD');
  const current = run?.stages.find((stage) => stage.key === run.currentStage) ?? null;
  const created = params.get('created') === '1';

  const reloadRun = async () => {
    await Promise.all([reloadRunView(), reloadRuns(), reload()]);
  };

  async function setStatus(status: 'ACTIVE' | 'ON_HOLD' | 'CANCELLED', reason?: string) {
    if (!run) return;
    setBusy(true);
    try {
      await runsApi.updateRun(run.run.id, { status, reason });
      invalidate();
      toast.push(t(`lp.run.statusChanged.${status}` as StringKey));
      setPrompt(null);
      setMenu(false);
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  }

  const q = runId && params.get('run') ? `?run=${runId}` : '';
  const tabs = [
    { to: `.${q}`, end: true, label: t('lp.tab.overview') },
    { to: `plan${q}`, label: t('lp.tab.plan'), count: run?.pendingApprovals.length || undefined, attention: Boolean(run?.overdueTasks.length) },
    { to: `curriculum${q}`, label: t('lp.tab.curriculum') },
    { to: `production${q}`, label: t('lp.tab.production') },
    { to: `qa${q}`, label: t('lp.tab.qa'), count: run?.facts.blockingIssues || undefined, attention: Boolean(run?.facts.blockingIssues) },
    { to: `team${q}`, label: t('lp.tab.team') },
    { to: `files${q}`, label: t('lp.tab.files') },
  ];

  return (
    <div className="lps-stagger space-y-4">
      <header className="space-y-3">
        <div className="lps-hero">
        {scenarioTheme && <span className="lps-hero-accent" aria-hidden="true" style={{ background: gradient(scenarioTheme, 90) }} />}
        <nav aria-label={t('lp.breadcrumb')} className="relative mb-2 text-[12.5px] lps-muted">
          <Link to="/learning-production/courses" className="hover:underline">
            {t('lp.nav.courses')}
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="lps-bidi">{course.name}</span>
        </nav>

        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3.5">
          {run && (
            <span className="lps-hero-icon mt-0.5" aria-hidden="true" style={scenarioTheme ? { background: gradient(scenarioTheme) } : undefined}>
              {(() => {
                const Icon = { AI_NEW: Sparkles, EXPERT_NEW: BookOpenCheck, REVAMP: RotateCcw, LEGACY: Clock3 }[run.run.scenario];
                return <Icon size={20} />;
              })()}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="lps-title lps-bidi">{course.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]">
              {run ? (
                <>
                  <ScenarioBadge scenario={run.run.scenario} />
                  <span className="lps-muted">{t('lp.run.number', { n: run.run.runNumber })}</span>
                  <RunStatusPill status={run.run.status} />
                  {!legacy && current && (
                    <span>
                      <span className="lps-muted">{t('lp.run.nowAt')} </span>
                      <strong>{pick(current.label)}</strong>
                    </span>
                  )}
                  {!legacy && run.run.status === 'ACTIVE' && <HealthPill health={run.health.health} />}
                  <span className="lps-muted">
                    {t('lp.field.targetDate')}: <strong className="text-[color:var(--lps-ink)]">{day(run.run.targetDate, { year: true })}</strong>
                  </span>
                  <PersonLine userId={run.run.managerUserId} people={run.people} />
                </>
              ) : runs && runs.runs.length === 0 ? (
                <span className="lps-muted">{t('lp.run.none')}</span>
              ) : (
                <Busy />
              )}
            </div>
          </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {runs && runs.runs.length > 1 && (
              <label className="flex items-center gap-1.5 text-[12.5px]">
                <span className="lps-muted">{t('lp.run.viewing')}</span>
                <select
                  className="lps-input !w-auto !py-1.5"
                  value={runId ?? ''}
                  onChange={(event) => {
                    const next = new URLSearchParams(params);
                    if (event.target.value === runs.currentRunId) next.delete('run');
                    else next.set('run', event.target.value);
                    setParams(next);
                  }}
                >
                  {runs.runs.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {t('lp.run.number', { n: entry.runNumber })} · {t(`lp.scenarioShort.${entry.scenario}` as StringKey)} · {t(`lp.runStatus.${entry.status}` as StringKey)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(runs?.runs.length === 0 || (run && !openStatus) || legacy) && runs?.capabilities.manageRuns !== false && (
              <Link to={`/learning-production/runs/new?course=${course.id}${run?.run.status === 'RELEASED' || legacy ? '&scenario=REVAMP' : ''}`} className="lps-btn">
                <Plus size={15} aria-hidden="true" />
                {t('lp.run.startAnother')}
              </Link>
            )}
            {(canManage || detail.capabilities.edit) && (
              <div className="relative">
                <button type="button" className="lps-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>
                  <MoreHorizontal size={16} aria-hidden="true" />
                  <span className="sr-only">{t('lp.run.menu')}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {menu && (
                  <div role="menu" className="lps-panel absolute end-0 z-30 mt-1 w-60 overflow-hidden py-1 shadow-panel" onKeyDown={(event) => event.key === 'Escape' && setMenu(false)}>
                    {canManage && run?.run.status === 'ACTIVE' && (
                      <MenuItem icon={Pause} label={t('lp.run.hold')} onClick={() => setStatus('ON_HOLD')} disabled={busy} />
                    )}
                    {canManage && run?.run.status === 'ON_HOLD' && (
                      <MenuItem icon={Play} label={t('lp.run.resume')} onClick={() => setStatus('ACTIVE')} disabled={busy} />
                    )}
                    {canManage && openStatus && !legacy && (
                      <MenuItem icon={XCircle} label={t('lp.run.cancel')} danger onClick={() => setPrompt('cancel')} disabled={busy} />
                    )}
                    {detail.capabilities.edit && (
                      <MenuItem icon={Settings2} label={t('lp.course.settings')} onClick={() => navigate(`/learning-production/courses/${course.id}/settings`)} />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        </div>

        {created && (
          <div className="lps-callout-info flex flex-wrap items-center justify-between gap-2" role="status">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={15} aria-hidden="true" />
              {t('lp.run.createdNotice')}
            </span>
            <button
              type="button"
              className="lps-btn-quiet !min-h-7"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete('created');
                setParams(next, { replace: true });
              }}
            >
              {t('common.close')}
            </button>
          </div>
        )}
        {runError && !run ? <ErrorNote error={runError} onRetry={reloadRunView} /> : null}
        {run && run.run.status === 'ON_HOLD' && <p className="lps-callout">{t('lp.run.onHoldNotice')}</p>}

        <div className="lps-tabs-sheet">
          <RouteTabs items={tabs} label={t('lp.course.tabs')} />
        </div>
      </header>

      <Outlet context={{ detail, reload, runs, run: run ?? null, runId, reloadRun } satisfies CourseOutlet} />

      <ReasonPrompt
        open={prompt === 'cancel'}
        title={t('lp.run.cancel')}
        body={t('lp.run.cancelBody')}
        label={t('lp.reason.label')}
        confirm={t('lp.run.cancelConfirm')}
        danger
        busy={busy}
        onCancel={() => setPrompt(null)}
        onConfirm={(reason) => setStatus('CANCELLED', reason)}
      />
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger, disabled }: { icon: typeof Pause; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] hover:bg-[color:var(--lps-sunken)] disabled:opacity-50"
      style={{ color: danger ? 'var(--lps-danger)' : undefined }}
    >
      <Icon size={15} aria-hidden="true" />
      {label}
    </button>
  );
}
