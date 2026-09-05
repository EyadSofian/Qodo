/**
 * Qodo Projects — one project.
 *
 * The shell every project module renders inside. Its job is to load the project
 * once, resolve what this person may do in it, and give the modules a stable
 * frame — so moving between Tasks and Phases is a route change, not a reload.
 *
 * The navigation is a persistent horizontal strip rather than a left rail. Zoho
 * uses a rail; we have one already — the workspace Shell's — and a second
 * vertical column beside it would leave a phone with two columns of chrome and
 * a sliver of content. The strip scrolls horizontally on small screens, which is
 * the same affordance the scope tabs on the projects list use.
 */

import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CalendarRange,
  Banknote,
  Bug,
  Building2,
  Clock,
  FolderKanban,
  GanttChartSquare,
  Layers,
  ListChecks,
  Users,
} from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/api';
import { projectsApi } from '../../lib/projects/api';
import type { ProjectDetail as ProjectDetailShape } from '../../lib/projects/types';
import { EmptyState, Spinner } from '../../components/ui';
import type { ProjectOutletContext } from '../../lib/projects/useProject';

/** The modules inside a project, in the order the work happens. */
const TABS = [
  { to: '', end: true, labelKey: 'projects.nav.overview', icon: FolderKanban },
  { to: 'phases', end: false, labelKey: 'projects.nav.phases', icon: Layers },
  { to: 'tasks', end: false, labelKey: 'projects.nav.tasks', icon: ListChecks },
  { to: 'gantt', end: false, labelKey: 'projects.nav.gantt', icon: GanttChartSquare },
  { to: 'issues', end: false, labelKey: 'projects.nav.issues', icon: Bug },
  { to: 'timesheet', end: false, labelKey: 'projects.nav.timesheet', icon: Clock },
  { to: 'budget', end: false, labelKey: 'projects.nav.budget', icon: Banknote },
  { to: 'members', end: false, labelKey: 'projects.nav.members', icon: Users },
  { to: 'activity', end: false, labelKey: 'projects.nav.activity', icon: Activity },
] as const;

export function ProjectDetail() {
  const { projectId = '' } = useParams();
  const { t, lang, dir } = useI18n();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<ProjectDetailShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await projectsApi.get(projectId));
    } catch (caught) {
      setError(errorMessage(caught, lang));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, lang]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="grid min-h-[50dvh] place-items-center">
        <Spinner size={24} className="text-brand-500" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
        <div className="card">
          <EmptyState
            icon={<FolderKanban size={34} />}
            title={t('projects.error.load')}
            body={error ?? undefined}
            action={
              <button type="button" className="btn-ghost btn-sm" onClick={() => navigate('/projects')}>
                {t('projects.backToList')}
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const { project, permissions } = detail;
  const context: ProjectOutletContext = {
    detail,
    reload: load,
    can: (permission) => permissions.includes(permission),
  };

  // The back arrow has to point at the reader's own start edge, which is the
  // right in Arabic. An arrow that always points left is the classic RTL tell.
  const BackArrow = dir === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
      <header className="mb-4">
        <button
          type="button"
          onClick={() => navigate('/projects')}
          className="btn-quiet btn-sm -ms-3 mb-1.5"
        >
          <BackArrow size={15} />
          {t('projects.backToList')}
        </button>

        <div className="flex flex-wrap items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-1 h-8 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: project.color }}
          />
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-ink">
              {project.name}
              <span className="chip bg-surface-sunken font-mono text-ink-muted">{project.key}</span>
              {detail.membership.implicit && (
                // Somebody with access but no membership row should know why
                // they can see this, rather than assuming they were added.
                <span className="chip bg-status-infoBg text-status-info">
                  {detail.membership.implicit === 'portal'
                    ? t('projects.access.portal')
                    : t('role.admin')}
                </span>
              )}
            </h1>
            <dl className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
              {project.customerId && (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">{t('projects.field.customer')}</dt>
                  <Building2 size={13} aria-hidden="true" />
                  <dd>{project.customerId}</dd>
                </div>
              )}
              {(project.startDate || project.endDate) && (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">{t('projects.field.endDate')}</dt>
                  <CalendarRange size={13} aria-hidden="true" />
                  <dd>{project.startDate ?? '—'} → {project.endDate ?? '—'}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </header>

      <nav
        aria-label={project.name}
        className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b border-surface-line"
      >
        {TABS.map(({ to, end, labelKey, icon: Icon }) => (
          <NavLink
            key={to || 'overview'}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                isActive
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-ink-muted hover:border-surface-line hover:text-ink'
              }`
            }
          >
            <Icon size={15} aria-hidden="true" />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      <Outlet context={context} />
    </div>
  );
}
