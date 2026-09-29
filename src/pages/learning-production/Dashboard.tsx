/**
 * E-Learning Production — the dashboard.
 *
 * The manager's portfolio: every production run in flight in one table —
 * where it is, how far its workflow and its content have come (two separate
 * numbers, never blended), its health and why, what waits for approval, what
 * is late, what is blocking release — then where runs are piling up and who
 * is carrying the work. A contributor sees the same page limited to their own
 * courses, with their next actions on top.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlarmClock, ArrowUpRight, Hourglass, Inbox, LayoutDashboard, Layers, Plus, Rocket, Search, ShieldAlert, TrendingDown, Workflow } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { runPaths } from '../../lib/learningProduction/runApi';
import type { MyWork2Response, PortfolioResponse, Scenario, StageKey } from '../../lib/learningProduction/runTypes';
import { STAGE_KEYS } from '@shared/learningProduction/constants';
import {
  EmptyNote,
  ErrorNote,
  Figure,
  PageHero,
  HealthPill,
  LoadingRows,
  Meter,
  Panel,
  PersonLine,
  ScenarioBadge,
  usePick,
  useDay,
} from '../../components/learning-production/studio';
import { useLpMe } from './Layout';

export function Dashboard() {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const navigate = useNavigate();
  const me = useLpMe();
  const { data, error, loading, reload } = useLpQuery<PortfolioResponse>(runPaths.portfolio);
  const { data: work } = useLpQuery<MyWork2Response>(runPaths.work);
  const [search, setSearch] = useState('');
  const [scenario, setScenario] = useState<Scenario | ''>('');
  const [health, setHealth] = useState('');

  const runs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.runs ?? []).filter(
      (run) =>
        (!needle || run.course.name.toLowerCase().includes(needle) || (run.course.code ?? '').toLowerCase().includes(needle)) &&
        (!scenario || run.scenario === scenario) &&
        (!health || run.health === health)
    );
  }, [data, search, scenario, health]);

  const pipeline = useMemo(() => {
    const entries = STAGE_KEYS.map((key) => [key, data?.pipeline[key as StageKey] ?? 0] as const).filter(([, count]) => count > 0);
    const top = Math.max(1, ...entries.map(([, count]) => count));
    return { entries, top };
  }, [data]);

  return (
    <div className="lps-stagger space-y-5">
      <PageHero
        icon={LayoutDashboard}
        title={t('lp.dashboard.title')}
        lede={t('lp.dashboard.lede')}
        actions={
          work && (work.counts.now > 0 || work.counts.review > 0) ? (
            <Link to="/learning-production/my-work" className="lps-hero-stat flex items-center gap-3 text-[13px] text-white transition-colors hover:bg-white/25">
              <Inbox size={16} aria-hidden="true" />
              <span>
                <strong>{t('lp.dashboard.yours', { n: work.counts.now })}</strong>
                {work.counts.review > 0 && <span className="text-white/80"> · {t('lp.dashboard.yourReviews', { n: work.counts.review })}</span>}
                {work.counts.overdue > 0 && <span className="font-semibold text-amber-200"> · {t('lp.dashboard.yourOverdue', { n: work.counts.overdue })}</span>}
              </span>
              <ArrowUpRight size={14} aria-hidden="true" className="rtl:-scale-x-100" />
            </Link>
          ) : undefined
        }
      />

      {error ? <ErrorNote error={error} onRetry={reload} /> : null}

      <section aria-label={t('lp.dashboard.figures')} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <Figure icon={Workflow} value={data?.kpis.activeRuns ?? '—'} label={t('lp.kpi.activeRuns')} hint={data?.kpis.legacyRuns ? t('lp.kpi.legacyRuns', { n: data.kpis.legacyRuns }) : undefined} />
        <Figure icon={Hourglass} value={data?.kpis.pendingApprovals ?? '—'} label={t('lp.kpi.pendingApprovals')} to="/learning-production/reviews" tone="accent" />
        <Figure icon={AlarmClock} value={data?.kpis.overdue ?? '—'} label={t('lp.kpi.overdue')} tone={data?.kpis.overdue ? 'danger' : 'sky'} />
        <Figure icon={ShieldAlert} value={data?.kpis.blockingIssues ?? '—'} label={t('lp.kpi.blockingIssues')} tone={data?.kpis.blockingIssues ? 'attention' : 'sky'} />
        <Figure icon={TrendingDown} value={data?.kpis.atRisk ?? '—'} label={t('lp.kpi.atRisk')} tone={data?.kpis.atRisk ? 'attention' : 'sky'} />
        <Figure icon={Rocket} value={data?.kpis.releasedLast90 ?? '—'} label={t('lp.kpi.released90')} tone="ok" />
      </section>

      <Panel
        title={t('lp.dashboard.runs')}
        bodyClassName="p-0"
        action={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
              <span className="sr-only">{t('common.search')}</span>
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 lps-faint" />
              <input className="lps-input !py-1.5 ps-8" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('lp.dashboard.searchRuns')} />
            </label>
            <select className="lps-input !w-auto !py-1.5" value={scenario} onChange={(event) => setScenario(event.target.value as Scenario | '')} aria-label={t('lp.filter.scenario')}>
              <option value="">{t('lp.filter.anyScenario')}</option>
              {(['EXPERT_NEW', 'AI_NEW', 'REVAMP', 'LEGACY'] as Scenario[]).map((value) => (
                <option key={value} value={value}>
                  {t(`lp.scenarioShort.${value}` as StringKey)}
                </option>
              ))}
            </select>
            <select className="lps-input !w-auto !py-1.5" value={health} onChange={(event) => setHealth(event.target.value)} aria-label={t('lp.filter.health')}>
              <option value="">{t('lp.filter.anyHealth')}</option>
              {['DELAYED', 'AT_RISK', 'ON_TRACK'].map((value) => (
                <option key={value} value={value}>
                  {t(`lp.health.${value}` as StringKey)}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {loading && !data ? (
          <LoadingRows rows={5} />
        ) : runs.length === 0 ? (
          <EmptyNote
            icon={Layers}
            title={data?.runs.length ? t('lp.dashboard.noMatch') : t('lp.dashboard.noRuns')}
            body={data?.runs.length ? undefined : t('lp.dashboard.noRunsBody')}
            action={
              !data?.runs.length && me?.canCreateRun ? (
                <Link to="/learning-production/runs/new" className="lps-btn-primary">
                  <Plus size={15} aria-hidden="true" />
                  {t('lp.run.new')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="lps-table min-w-[980px]">
              <thead>
                <tr>
                  <th className="sticky start-0 z-[2]">{t('lp.col.course')}</th>
                  <th>{t('lp.col.stage')}</th>
                  <th className="w-[130px]">{t('lp.col.workflow')}</th>
                  <th className="w-[130px]">{t('lp.col.content')}</th>
                  <th>{t('lp.col.health')}</th>
                  <th className="text-center">{t('lp.col.waiting')}</th>
                  <th className="text-center">{t('lp.col.overdue')}</th>
                  <th className="text-center">{t('lp.col.issues')}</th>
                  <th>{t('lp.col.target')}</th>
                  <th>{t('lp.col.manager')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const open = () => navigate(`/learning-production/courses/${run.course.id}`);
                  return (
                    <tr key={run.id} className="lps-row-link" onClick={open}>
                      <td className="sticky start-0 z-[1] bg-white">
                        <Link to={`/learning-production/courses/${run.course.id}`} className="block min-w-0 max-w-[260px] font-semibold hover:underline" onClick={(event) => event.stopPropagation()}>
                          <span className="lps-bidi block truncate">{run.course.name}</span>
                        </Link>
                        <span className="mt-1 flex items-center gap-1.5">
                          <ScenarioBadge scenario={run.scenario} short />
                          <span className="text-[11.5px] lps-faint">{t('lp.run.number', { n: run.runNumber })}</span>
                        </span>
                      </td>
                      <td>
                        {run.scenario === 'LEGACY' ? (
                          <span className="text-[12.5px] lps-muted">{t('lp.run.legacyNoStages')}</span>
                        ) : run.currentStage ? (
                          <>
                            <span className="block max-w-[220px] truncate font-medium">{pick(run.currentStage.label)}</span>
                            <span className="text-[11.5px] lps-faint">{t('lp.run.stageOf', { n: run.currentStage.index + 1, total: run.stageCount })}</span>
                          </>
                        ) : (
                          <span className="text-[12.5px]">{t('lp.run.allStagesDone')}</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Meter value={run.workflow.percent} label={t('lp.col.workflow')} />
                          <span className="w-9 shrink-0 text-end text-[12px] font-semibold">{run.workflow.percent}%</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Meter value={run.content.percent} tone="ok" label={t('lp.col.content')} />
                          <span className="w-9 shrink-0 text-end text-[12px] font-semibold">{run.content.total ? `${run.content.percent}%` : '—'}</span>
                        </div>
                      </td>
                      <td>
                        <HealthPill
                          health={run.health}
                          title={run.healthReasons.map((reason) => t(`lp.healthReason.${reason.code}` as StringKey, reason as Record<string, string | number>)).join('\n')}
                        />
                      </td>
                      <td className="text-center font-semibold">{run.pendingApprovals || <span className="lps-faint">0</span>}</td>
                      <td className="text-center font-semibold" style={{ color: run.overdue ? 'var(--lps-danger)' : undefined }}>
                        {run.overdue || <span className="lps-faint">0</span>}
                      </td>
                      <td className="text-center">
                        {run.blockingIssues ? (
                          <span className="font-semibold" style={{ color: 'var(--lps-attention)' }}>
                            {run.blockingIssues}
                          </span>
                        ) : (
                          <span className="lps-faint">{run.openIssues || 0}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-[12.5px]">{day(run.targetDate)}</td>
                      <td>
                        <PersonLine userId={run.managerUserId} people={data?.people ?? {}} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title={t('lp.dashboard.pipeline')} className="lg:col-span-1">
          {pipeline.entries.length === 0 ? (
            <p className="text-[13px] lps-muted">{t('lp.dashboard.pipelineEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {pipeline.entries.map(([key, count]) => (
                <li key={key}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="truncate">{t(`lp.stageKey.${key}` as StringKey)}</span>
                    <span className="font-semibold" style={{ color: data?.bottleneck === key ? 'var(--lps-attention)' : undefined }}>
                      {count}
                    </span>
                  </div>
                  <Meter value={(count / pipeline.top) * 100} tone={data?.bottleneck === key ? 'attention' : 'accent'} label={t(`lp.stageKey.${key}` as StringKey)} />
                </li>
              ))}
            </ul>
          )}
          {data?.bottleneck && <p className="mt-3 text-[12px] lps-muted">{t('lp.dashboard.bottleneck', { stage: t(`lp.stageKey.${data.bottleneck}` as StringKey) })}</p>}
        </Panel>

        <Panel title={t('lp.dashboard.workload')} bodyClassName="p-0" className="lg:col-span-1">
          {data && data.workload.length === 0 ? (
            <p className="p-4 text-[13px] lps-muted">{t('lp.dashboard.workloadEmpty')}</p>
          ) : (
            <table className="lps-table">
              <thead>
                <tr>
                  <th>{t('lp.col.person')}</th>
                  <th className="text-center">{t('lp.col.active')}</th>
                  <th className="text-center">{t('lp.col.reviewing')}</th>
                  <th className="text-center">{t('lp.col.overdue')}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.workload ?? []).map((row) => (
                  <tr key={row.userId}>
                    <td>
                      <PersonLine userId={row.userId} people={data?.people ?? {}} />
                    </td>
                    <td className="text-center font-semibold">{row.active}</td>
                    <td className="text-center">{row.reviewing}</td>
                    <td className="text-center font-semibold" style={{ color: row.overdue ? 'var(--lps-danger)' : undefined }}>
                      {row.overdue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={t('lp.dashboard.releases')} className="lg:col-span-1">
          {data && data.releases.length === 0 ? (
            <p className="text-[13px] lps-muted">{t('lp.dashboard.releasesEmpty')}</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--lps-line)' }}>
              {(data?.releases ?? []).map((release) => (
                <li key={release.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                  <Link to={`/learning-production/courses/${release.course.id}/qa?release=${release.id}`} className="min-w-0 hover:underline">
                    <span className="lps-bidi block truncate font-semibold">{release.course.name}</span>
                    <span className="text-[12px] lps-faint">{release.versionLabel}</span>
                  </Link>
                  <span className="shrink-0 text-[12px] lps-muted">{day(release.publishedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
