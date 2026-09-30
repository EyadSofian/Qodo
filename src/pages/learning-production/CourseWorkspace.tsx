/**
 * One course and its production run — on one page, without tabs.
 *
 * The header says what the course is, when it is due and whether it is on
 * time. Below it, the two things people come for: where production is and
 * what that stage needs now, and the lessons with where each one stands.
 * Beside them, short cards for progress, quality and release, and the team.
 *
 * Everything else — editing the lesson structure, assigning in bulk, issues
 * and releases, the team, files and history — opens over the page in a
 * drawer, named in the URL (`?panel=`) so it has a link, as does a task
 * (`?task=`). Links written for the old tabs are redirected here (App.tsx).
 *
 * A course with several runs shows the run in flight; `?run=` pins another.
 */

import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useOutlet, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, FolderOpen, MoreHorizontal, Pause, Play, Plus, Settings2, ShieldCheck, TrendingUp, Users, XCircle } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { paths } from '../../lib/learningProduction/api';
import { runPaths, runsApi } from '../../lib/learningProduction/runApi';
import { invalidate, useLpQuery } from '../../lib/learningProduction/hooks';
import { lpErrorKey, type CoursePanel } from '../../lib/learningProduction/format';
import type { CourseDetail } from '../../lib/learningProduction/types';
import type { RunView, RunsResponse } from '../../lib/learningProduction/runTypes';
import { Avatar, useToast } from '../../components/ui';
import { Dot, Drawer, ErrorNote, Hero, IconChip, LoadingRows, Menu, MenuItem, Meter, ReasonPrompt, useDay, type DotTone, type IconTone } from '../../components/learning-production/studio';
import { SCENARIO_THEME } from '../../lib/learningProduction/theme';
import { useLpTheme } from './Layout';
import { RunStages } from './course/RunStages';
import { LessonList } from './course/LessonList';
import { LegacyCard } from './course/LegacyCard';
import { TaskDrawer } from './course/TaskDrawer';
import { CourseLessons } from './course/CourseLessons';
import { CourseProduction } from './course/CourseProduction';
import { QaRelease } from './course/QaRelease';
import { TeamTab } from './course/TeamTab';
import { FilesActivity } from './course/FilesActivity';

export interface CourseOutlet {
  detail: CourseDetail;
  reload: () => Promise<void>;
  runs: RunsResponse | null;
  run: RunView | null;
  runId: string | null;
  reloadRun: () => Promise<void>;
}

const CourseContext = createContext<CourseOutlet | null>(null);

/** The course being viewed, for anything on the course page or in its drawers. */
export function useCourse() {
  const value = useContext(CourseContext);
  if (!value) throw new Error('useCourse outside a course page');
  return value;
}

const HEALTH_DOT: Record<string, DotTone> = { ON_TRACK: 'ok', COMPLETED: 'ok', AT_RISK: 'attention', DELAYED: 'danger' };
const PANELS: CoursePanel[] = ['lessons', 'matrix', 'qa', 'team', 'files'];

export function CourseWorkspace() {
  const { courseId = '' } = useParams();
  const { t, dir } = useI18n();
  const day = useDay();
  const toast = useToast();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const [params, setParams] = useSearchParams();
  const { data: detail, error, loading, reload } = useLpQuery<CourseDetail>(paths.course(courseId));
  const { data: runs, reload: reloadRuns } = useLpQuery<RunsResponse>(runPaths.courseRuns(courseId));
  const runId = params.get('run') ?? runs?.currentRunId ?? null;
  const { data: run, error: runError, reload: reloadRunView } = useLpQuery<RunView>(runId ? runPaths.run(runId) : null);
  const [prompt, setPrompt] = useState<'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  // Before any early return: a hook must run on every render.
  const scenarioTheme = run ? SCENARIO_THEME[run.run.scenario] : null;
  useLpTheme(scenarioTheme);

  if (loading && !detail) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-16 w-2/3" />
        <div className="lps-panel">
          <LoadingRows rows={5} />
        </div>
      </div>
    );
  }
  if (error && !detail) return <ErrorNote error={error} onRetry={reload} />;
  if (!detail) return null;

  const { course } = detail;
  const legacy = run?.run.scenario === 'LEGACY';
  const canManage = Boolean(run?.capabilities.manageRuns);
  const openStatus = run && (run.run.status === 'ACTIVE' || run.run.status === 'ON_HOLD');
  const canStartAnother = (runs?.runs.length === 0 || (run && !openStatus) || legacy) && runs?.capabilities.manageRuns !== false;
  const created = params.get('created') === '1';
  const panelParam = params.get('panel') as CoursePanel | null;
  const panel = panelParam && PANELS.includes(panelParam) ? panelParam : null;
  const taskId = params.get('task');
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;

  const reloadRun = async () => {
    await Promise.all([reloadRunView(), reloadRuns(), reload()]);
  };

  const setParam = (key: string, value: string | null, extra: string[] = []) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    for (const name of extra) next.delete(name);
    setParams(next);
  };
  const openPanel = (name: CoursePanel, add = false) => {
    const next = new URLSearchParams(params);
    next.set('panel', name);
    if (add) next.set('add', '1');
    setParams(next);
  };
  // Closing a panel also drops the parameters that only mean something inside it.
  const closePanel = () => setParam('panel', null, ['add', 'issue', 'release', 'quick']);

  async function setStatus(status: 'ACTIVE' | 'ON_HOLD' | 'CANCELLED', reason?: string) {
    if (!run) return;
    setBusy(true);
    try {
      await runsApi.updateRun(run.run.id, { status, reason });
      invalidate();
      toast.push(t(`lp.run.statusChanged.${status}` as StringKey));
      setPrompt(null);
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  }

  const value = { detail, reload, runs, run: run ?? null, runId, reloadRun } satisfies CourseOutlet;
  const facts = [
    run ? t(`lp.scenarioShort.${run.run.scenario}` as StringKey) : null,
    runs && runs.runs.length > 1 && run ? t('lp.run.number', { n: run.run.runNumber }) : null,
    run?.run.targetDate ? t('lp.courses.due', { day: day(run.run.targetDate, { year: true }) }) : null,
  ].filter(Boolean);

  return (
    <CourseContext.Provider value={value}>
      <div className="lps-stagger space-y-5">
        <Hero
          style={scenarioTheme ? ({ '--lp-a1': scenarioTheme.a1, '--lp-a2': scenarioTheme.a2 } as CSSProperties) : undefined}
          back={
            <Link to="/learning-production/courses" className="lps-hero-back">
              <Back size={15} aria-hidden="true" />
              {t('lp.nav.courses')}
            </Link>
          }
          title={course.name}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canStartAnother && (
                <Link to={`/learning-production/runs/new?course=${course.id}${run?.run.status === 'RELEASED' || legacy ? '&scenario=REVAMP' : ''}`} className="lps-btn">
                  <Plus size={15} aria-hidden="true" />
                  {t('lp.run.startAnother')}
                </Link>
              )}
              {(canManage || detail.capabilities.edit || (runs && runs.runs.length > 1)) && (
                <Menu label={t('lp.run.menu')} icon={MoreHorizontal}>
                  {(close) => (
                    <>
                      {canManage && run?.run.status === 'ACTIVE' && <MenuItem icon={Pause} label={t('lp.run.hold')} disabled={busy} onClick={() => { close(); void setStatus('ON_HOLD'); }} />}
                      {canManage && run?.run.status === 'ON_HOLD' && <MenuItem icon={Play} label={t('lp.run.resume')} disabled={busy} onClick={() => { close(); void setStatus('ACTIVE'); }} />}
                      {canManage && openStatus && !legacy && <MenuItem icon={XCircle} label={t('lp.run.cancel')} danger onClick={() => { close(); setPrompt('cancel'); }} />}
                      {detail.capabilities.edit && <MenuItem icon={Settings2} label={t('lp.course.settings')} onClick={() => { close(); navigate(`/learning-production/courses/${course.id}/settings`); }} />}
                      {runs && runs.runs.length > 1 && (
                        <div className="border-t px-3.5 pb-1.5 pt-2.5" style={{ borderColor: 'var(--lps-line)' }}>
                          <label className="lps-label" htmlFor="lp-run-pick">{t('lp.run.viewing')}</label>
                          <select
                            id="lp-run-pick"
                            className="lps-input !py-1.5"
                            value={runId ?? ''}
                            onChange={(event) => {
                              close();
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
                        </div>
                      )}
                    </>
                  )}
                </Menu>
              )}
            </div>
          }
        >
          {facts.map((fact) => (
            <span key={fact} className="lps-hero-chip">
              {fact}
            </span>
          ))}
          {run && run.run.status !== 'ACTIVE' && <Dot tone={run.run.status === 'RELEASED' ? 'ok' : 'idle'} className="!py-2 !pe-3.5 !ps-3 text-[13px]">{t(`lp.runStatus.${run.run.status}` as StringKey)}</Dot>}
          {run && !legacy && run.run.status === 'ACTIVE' && <Dot tone={HEALTH_DOT[run.health.health] ?? 'idle'} className="!py-2 !pe-3.5 !ps-3 text-[13px]">{t(`lp.health.${run.health.health}` as StringKey)}</Dot>}
        </Hero>

        {created && (
          <div className="lps-callout-info flex flex-wrap items-center justify-between gap-2" role="status">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={15} aria-hidden="true" />
              {t('lp.run.createdNotice')}
            </span>
            <button type="button" className="lps-btn-quiet !min-h-7" onClick={() => setParam('created', null)}>
              {t('common.close')}
            </button>
          </div>
        )}
        {runError && !run ? <ErrorNote error={runError} onRetry={reloadRunView} /> : null}
        {run && run.run.status === 'ON_HOLD' && <p className="lps-callout">{t('lp.run.onHoldNotice')}</p>}

        {outlet ? (
          outlet
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-5">
              {run ? legacy ? <LegacyCard view={run} /> : <RunStages view={run} /> : runs && runs.runs.length === 0 ? <p className="lps-panel px-5 py-6 text-[14px] lps-muted">{t('lp.run.none')}</p> : null}
              <LessonList courseId={course.id} capabilities={detail.capabilities} onOpen={openPanel} />
            </div>
            <aside className="min-w-0 space-y-4">
              {run && <ProgressCard view={run} />}
              {run && <QualityCard view={run} onOpen={() => openPanel('qa')} />}
              <TeamCard detail={detail} onOpen={() => openPanel('team')} />
              <button type="button" className="lps-panel lps-lift flex w-full items-center gap-3 px-4 py-3.5 text-start" onClick={() => openPanel('files')}>
                <IconChip icon={FolderOpen} tone="orange" size={15} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold">{t('lp.tab.files')}</span>
                  <span className="block text-[12.5px] lps-muted">{t('lp.course.filesHint')}</span>
                </span>
              </button>
            </aside>
          </div>
        )}
      </div>

      <Drawer open={panel === 'lessons'} onClose={closePanel} title={t('lp.course.editLessons')} wide>
        {panel === 'lessons' && <CourseLessons />}
      </Drawer>
      <Drawer open={panel === 'matrix'} onClose={closePanel} title={t('lp.course.assignAll')} wide>
        {panel === 'matrix' && <CourseProduction />}
      </Drawer>
      <Drawer open={panel === 'qa'} onClose={closePanel} title={t('lp.tab.qa')} wide>
        {panel === 'qa' && (run ? <QaRelease /> : <LoadingRows />)}
      </Drawer>
      <Drawer open={panel === 'team'} onClose={closePanel} title={t('lp.tab.team')} wide>
        {panel === 'team' && (run ? <TeamTab /> : <LoadingRows />)}
      </Drawer>
      <Drawer open={panel === 'files'} onClose={closePanel} title={t('lp.tab.files')} wide>
        {panel === 'files' && <FilesActivity />}
      </Drawer>
      {taskId && <TaskDrawer taskId={taskId} onClose={() => setParam('task', null)} />}

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
    </CourseContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Side cards                                                           */
/* ------------------------------------------------------------------ */

function SideCard({ title, icon, tone, children, action }: { title: string; icon: typeof Users; tone: IconTone; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="lps-panel px-4 py-4">
      <h2 className="lps-side-title">
        <IconChip icon={icon} tone={tone} size={15} />
        {title}
      </h2>
      {children}
      {action && <div className="mt-3">{action}</div>}
    </section>
  );
}

function ProgressCard({ view }: { view: RunView }) {
  const { t } = useI18n();
  const { content, workflow } = view.progress;
  return (
    <SideCard title={t('lp.overview.progress')} icon={TrendingUp} tone="green">
      <div className="space-y-3.5">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
            <span>{t('lp.course.contentApproved')}</span>
            <strong>{content.total ? `${content.percent}%` : '—'}</strong>
          </div>
          <Meter value={content.percent} tone="ok" label={t('lp.course.contentApproved')} />
          <p className="mt-1 text-[12px] lps-faint">{content.total ? t('lp.progress.contentExplain', { done: content.done, total: content.total }) : t('lp.progress.contentNone')}</p>
        </div>
        {view.run.scenario !== 'LEGACY' && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
              <span>{t('lp.course.tasksProgress')}</span>
              <strong>{workflow.percent}%</strong>
            </div>
            <Meter value={workflow.percent} label={t('lp.course.tasksProgress')} />
            <p className="mt-1 text-[12px] lps-faint">{t('lp.course.tasksDone', { done: workflow.done, total: workflow.total })}</p>
          </div>
        )}
      </div>
    </SideCard>
  );
}

function QualityCard({ view, onOpen }: { view: RunView; onOpen: () => void }) {
  const { t } = useI18n();
  const blocking = view.facts.blockingIssues;
  const published = view.progress.published;
  const checks = view.progress.readiness.checks;
  const left = checks.filter((check) => !check.ok).length;
  return (
    <SideCard
      title={t('lp.tab.qa')}
      icon={ShieldCheck}
      tone={blocking ? 'rose' : 'violet'}
      action={
        <button type="button" className="lps-btn w-full" onClick={onOpen}>
          <ShieldCheck size={15} aria-hidden="true" />
          {t('lp.course.openQa')}
        </button>
      }
    >
      <ul className="space-y-2 text-[13px]">
        <li>
          <Dot tone={blocking ? 'danger' : 'ok'}>{blocking ? t('lp.course.blockingIssues', { n: blocking }) : t('lp.course.noBlockingIssues')}</Dot>
        </li>
        <li>
          <Dot tone={published ? 'ok' : 'idle'}>{published ? t('lp.course.publishedAs', { label: published.versionLabel }) : t('lp.course.notPublished')}</Dot>
        </li>
        {view.progress.readiness.assessed && checks.length > 0 && (
          <li>
            <Dot tone={left ? 'idle' : 'ok'}>{left ? t('lp.course.readinessLeft', { n: left }) : t('lp.course.readyToRelease')}</Dot>
          </li>
        )}
      </ul>
    </SideCard>
  );
}

function TeamCard({ detail, onOpen }: { detail: CourseDetail; onOpen: () => void }) {
  const { t } = useI18n();
  const members = detail.team;
  const shown = members.slice(0, 7);
  return (
    <SideCard
      title={t('lp.tab.team')}
      icon={Users}
      tone="blue"
      action={
        <button type="button" className="lps-btn w-full" onClick={onOpen}>
          <Users size={15} aria-hidden="true" />
          {t('lp.course.openTeam')}
        </button>
      }
    >
      {members.length === 0 ? (
        <p className="text-[13px] lps-muted">{t('lp.course.noTeam')}</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2 rtl:space-x-reverse">
            {shown.map((member) => {
              const person = detail.people[member.userId];
              return (
                <span key={member.userId} className="rounded-full ring-2 ring-white" title={person?.name}>
                  <Avatar name={person?.name ?? '?'} color={person?.avatarColor ?? '#94A3B8'} size={30} />
                </span>
              );
            })}
          </div>
          <span className="text-[13px] lps-muted">{t('lp.course.members', { n: members.length })}</span>
        </div>
      )}
    </SideCard>
  );
}
