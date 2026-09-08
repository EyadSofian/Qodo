/**
 * Qodo Projects — the portfolio.
 *
 * The question this page answers is "which of these needs me today", so it
 * leads with the count of projects at risk and sorts them to the top. A
 * portfolio that lists forty projects alphabetically is a list, not an answer.
 *
 * The two words are kept distinct, and the difference is stated on the page
 * rather than assumed: **delayed** is a fact about the calendar, **at risk** is
 * a judgement that also counts an overrun budget and overdue work.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, LayoutDashboard, Users } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/api';
import { reportsApi } from '../../lib/projects/api';
import type { Portfolio, WorkloadRow } from '../../lib/projects/types';
import { EmptyState, Spinner } from '../../components/ui';

export function ProjectsPortfolio() {
  const { t, lang, dir, pick } = useI18n();
  const navigate = useNavigate();

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [workload, setWorkload] = useState<WorkloadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [portfolioResult, workloadResult] = await Promise.all([
        reportsApi.portfolio(),
        // Workload needs its own permission; a refusal here is not an error on
        // this page, it just means the section does not appear.
        reportsApi.workload().catch(() => ({ people: [] as WorkloadRow[], from: null, to: null })),
      ]);
      setPortfolio(portfolioResult);
      setWorkload(workloadResult.people);
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const BackArrow = dir === 'rtl' ? ArrowRight : ArrowLeft;

  if (loading) {
    return (
      <div className="grid min-h-[50dvh] place-items-center">
        <Spinner size={24} className="text-brand-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
      <header className="mb-4">
        <button type="button" onClick={() => navigate('/projects')} className="btn-quiet btn-sm -ms-3 mb-1.5">
          <BackArrow size={15} />
          {t('projects.backToList')}
        </button>
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
          <LayoutDashboard size={22} className="text-brand-500" />
          {t('portfolio.title')}
        </h1>
      </header>

      {error ? (
        <div className="card">
          <EmptyState icon={<LayoutDashboard size={32} />} title={t('projects.error.load')} body={error} />
        </div>
      ) : !portfolio || portfolio.projects.length === 0 ? (
        <div className="card">
          <EmptyState icon={<LayoutDashboard size={32} />} title={t('portfolio.empty')} />
        </div>
      ) : (
        <div className="grid gap-4">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label={t('portfolio.total')} value={portfolio.summary.total} />
            <Stat
              label={t('portfolio.atRisk')}
              value={portfolio.summary.atRisk}
              tone={portfolio.summary.atRisk > 0 ? 'bad' : 'neutral'}
            />
            <Stat
              label={t('portfolio.delayed')}
              value={portfolio.summary.delayed}
              tone={portfolio.summary.delayed > 0 ? 'warn' : 'neutral'}
            />
            <Stat
              label={t('portfolio.overdueTasks')}
              value={portfolio.summary.overdueTasks}
              tone={portfolio.summary.overdueTasks > 0 ? 'warn' : 'neutral'}
            />
          </section>

          <p className="text-[11.5px] leading-relaxed text-ink-faint">{t('portfolio.atRiskHint')}</p>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[820px] text-start text-sm">
              <thead>
                <tr className="border-b border-surface-line text-[11.5px] uppercase tracking-wide text-ink-faint">
                  <th scope="col" className="px-3 py-2.5 text-start font-semibold">
                    {t('projects.field.name')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-semibold">
                    {t('projects.field.status')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-end font-semibold">
                    {t('projectTasks.title')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-end font-semibold">
                    {t('projectTasks.filter.overdue')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-end font-semibold">
                    {t('budget.actualHours')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-semibold">
                    {t('projects.field.endDate')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* At-risk first: the page exists to answer "what needs me". */}
                {[...portfolio.projects]
                  .sort((a, b) => Number(b.atRisk) - Number(a.atRisk))
                  .map((project) => (
                    <tr
                      key={project.id}
                      className={`border-b border-surface-line last:border-0 ${
                        project.atRisk ? 'bg-status-badBg/30' : ''
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          to={`/projects/${project.id}`}
                          className="flex items-center gap-2 font-semibold text-ink hover:text-brand-600"
                        >
                          {project.atRisk && (
                            <AlertTriangle size={13} className="shrink-0 text-status-bad" aria-hidden="true" />
                          )}
                          <span className="truncate">{project.name}</span>
                          <span className="chip bg-surface-sunken font-mono text-[11px] text-ink-muted">
                            {project.key}
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        {project.status ? (
                          <span
                            className="chip"
                            style={{
                              backgroundColor: `${project.statusColor ?? '#64748B'}1A`,
                              color: project.statusColor ?? '#64748B',
                            }}
                          >
                            {project.statusLabel ? pick(project.statusLabel) : project.status}
                          </span>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-end tabular-nums text-ink-muted">
                        {project.doneCount}/{project.taskCount}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-end tabular-nums ${
                          project.overdueTasks > 0 ? 'font-bold text-status-bad' : 'text-ink-muted'
                        }`}
                      >
                        {project.overdueTasks}
                      </td>
                      <td className="px-3 py-2.5 text-end tabular-nums text-ink-muted">
                        {project.actualHours || <span className="text-ink-faint">—</span>}
                        {project.budgetHours !== null && (
                          <span className="text-ink-faint"> / {project.budgetHours}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[12.5px] ${
                            project.delayed ? 'font-semibold text-status-bad' : 'text-ink-muted'
                          }`}
                        >
                          {project.delayed && <CalendarClock size={12} aria-hidden="true" />}
                          {project.endDate ?? '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {workload.length > 0 && (
            <section className="card p-4">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-ink">
                <Users size={16} className="text-ink-muted" />
                {t('workload.title')}
              </h2>
              <p className="mb-3 text-[11.5px] text-ink-faint">{t('workload.hint')}</p>

              <ul className="grid gap-2">
                {workload.map((person) => (
                  <li key={person.userId} className="grid grid-cols-[minmax(100px,180px)_1fr_auto] items-center gap-3">
                    {/* The person's name. This rendered `userId`, so the chart
                        was five bars labelled with uuids. */}
                    <span className="truncate text-[12.5px] font-semibold text-ink">
                      {person.name ?? t('common.unknown')}
                    </span>
                    <span className="h-3 overflow-hidden rounded bg-surface-sunken">
                      <span
                        className="block h-full rounded bg-brand-500"
                        style={{
                          width: `${Math.min(
                            100,
                            ((person.assignedHours ?? 0) /
                              Math.max(1, ...workload.map((row) => row.assignedHours ?? 0))) *
                              100
                          )}%`,
                        }}
                      />
                    </span>
                    <span className="text-end text-[12px] tabular-nums text-ink-muted">
                      {person.assignedHours === null ? (
                        // Null is not zero: nobody estimated these, and saying
                        // "0 hours" would read as "no work".
                        <span className="text-ink-faint">{t('workload.noEstimate')}</span>
                      ) : (
                        `${person.assignedHours} ${t('time.hours')}`
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'warn' | 'bad';
}) {
  const tint =
    tone === 'bad'
      ? 'border-status-bad/30 bg-status-badBg/40 text-status-bad'
      : tone === 'warn'
        ? 'border-status-warn/30 bg-status-warnBg/40 text-accent-700'
        : 'text-ink';
  return (
    <article className={`card p-3.5 ${tone === 'neutral' ? '' : tint}`}>
      <p className="text-[12px] font-semibold text-ink-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'neutral' ? 'text-ink' : ''}`}>{value}</p>
    </article>
  );
}
