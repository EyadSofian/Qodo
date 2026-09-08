/**
 * Qodo Projects — the projects list.
 *
 * The first screen of the module, and the one everything else is reached from.
 * Its job is to answer "what is running, what is mine, and what needs me"
 * without a click, which is why the density is closer to a spreadsheet than to
 * a marketing grid: an operations manager at Engosoft opens this with forty
 * projects on it, not four.
 *
 * The scope tabs are the information architecture. Active / Mine / Favorites
 * are three questions about the same set, and Archived and Recycle bin are the
 * two places work goes when it stops — kept as tabs rather than hidden in a
 * menu because "where did that project go" is a question people actually ask,
 * and a tab answers it before it is asked.
 *
 * Everything here is a request to the server. Filtering, sorting and paging
 * happen in SQL — this component never receives a list it then narrows, which
 * is the whole reason Projects has a relational schema (ADR-2).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Building2,
  CalendarRange,
  Database,
  FolderKanban,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Plus,
  Search,
  Settings2,
  Star,
  Table2,
  Trash2,
  Users,
} from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/api';
import { projectsApi } from '../../lib/projects/api';
import type { Project, ProjectScope } from '../../lib/projects/types';
import { EmptyState, Segmented, useToast } from '../../components/ui';
import { ProjectCreateDialog } from '../../components/projects/ProjectCreateDialog';
import { useProjectPermissions } from '../../lib/projects/useProjectPermissions';
import { projectHealth } from '../../lib/projects/health';
import {
  DueBadge,
  ErrorState,
  HelpTip,
  PageHeader,
  ProgressMeter,
  SkeletonCards,
  SkeletonRows,
  StatusPill,
  TonePill,
} from '../../components/projects/ui';

/**
 * The tabs, and what each one asks the server for.
 *
 * `mine` and `favorites` are the *active* scope with an extra filter rather
 * than scopes of their own — a favourite that has been archived should not
 * reappear in the favourites tab, and modelling them as filters is what makes
 * that true without a special case.
 */
type Tab = 'active' | 'mine' | 'favorites' | 'archived' | 'trashed';

const TAB_QUERY: Record<Tab, { scope: ProjectScope; mine?: boolean; favorites?: boolean }> = {
  active: { scope: 'active' },
  mine: { scope: 'active', mine: true },
  favorites: { scope: 'active', favorites: true },
  archived: { scope: 'archived' },
  trashed: { scope: 'trashed' },
};

const PAGE_SIZE = 24;

export function ProjectsList() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const tab = (params.get('tab') as Tab) || 'active';
  const layout = params.get('layout') === 'table' ? 'table' : 'grid';

  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Favourites are optimistic: the star is the fastest interaction on the page
  // and waiting a round trip for it feels broken. The set is reconciled from
  // the server on the next load.
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const [search, setSearch] = useState(params.get('q') ?? '');

  // Debounced, because the alternative is a query per keystroke against a
  // table this product is designed to fill with hundreds of thousands of rows.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // What this person may do in Projects is a permission-set question, and only
  // the server can answer it — a workspace role does not imply a Projects one.
  // This hides the button; the endpoint is still what refuses.
  const { can } = useProjectPermissions();
  const canCreate = can('project.create');
  // The demo endpoints need `permissions.manage` *and* the workspace admin
  // role. Only the first is knowable here; the server enforces both, and this
  // is only deciding whether to offer a link.
  const canManageDemo = can('permissions.manage');

  /**
   * One loader for every tab.
   *
   * `requestId` guards against the out-of-order response: typing quickly fires
   * three searches, and without this the slowest one wins and the list shows
   * results for a query the box no longer contains.
   */
  const requestId = useRef(0);

  const load = useCallback(
    async (nextOffset = 0) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const result = await projectsApi.list({
          ...TAB_QUERY[tab],
          q: search || undefined,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        if (id !== requestId.current) return;
        setProjects(result.projects);
        setTotal(result.total);
        setOffset(result.offset);
      } catch (caught) {
        if (id !== requestId.current) return;
        setError(errorMessage(caught, lang));
        setProjects([]);
        setTotal(0);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [tab, search, lang]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const setTab = (next: Tab) => {
    const updated = new URLSearchParams(params);
    updated.set('tab', next);
    setParams(updated, { replace: true });
  };

  const setLayout = (next: 'grid' | 'table') => {
    const updated = new URLSearchParams(params);
    updated.set('layout', next);
    setParams(updated, { replace: true });
  };

  /**
   * Every row action runs the same way: call, report, reload.
   *
   * Written once rather than five times because the part that matters is the
   * error branch — an archive that the server refused must not leave the card
   * looking archived, and the reload is what guarantees the screen agrees with
   * the database rather than with what the click hoped for.
   */
  const act = async (action: () => Promise<unknown>, successKey?: Parameters<typeof t>[0]) => {
    try {
      await action();
      if (successKey) toast.push(t(successKey), 'ok');
      await load(offset);
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  const toggleFavorite = async (project: Project) => {
    const next = !starred.has(project.id);
    setStarred((current) => {
      const updated = new Set(current);
      if (next) updated.add(project.id);
      else updated.delete(project.id);
      return updated;
    });
    try {
      await projectsApi.favorite(project.id, next);
      if (tab === 'favorites') await load(offset);
    } catch (caught) {
      // Put the star back where it was — an optimistic update that silently
      // stays wrong is worse than one that never happened.
      setStarred((current) => {
        const updated = new Set(current);
        if (next) updated.delete(project.id);
        else updated.add(project.id);
        return updated;
      });
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  const tabs = useMemo(
    () =>
      [
        { value: 'active' as Tab, label: t('projects.scope.active') },
        { value: 'mine' as Tab, label: t('projects.scope.mine') },
        { value: 'favorites' as Tab, label: t('projects.scope.favorites') },
        { value: 'archived' as Tab, label: t('projects.scope.archived') },
        { value: 'trashed' as Tab, label: t('projects.scope.trashed') },
      ],
    [t]
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
      <PageHeader
        icon={<FolderKanban size={22} />}
        title={t('projects.title')}
        description={t('projects.subtitle')}
        actions={
          <>
            <Link to="/projects/portfolio" className="btn-ghost btn-sm">
              <LayoutDashboard size={16} />
              {t('portfolio.title')}
            </Link>
            {can('customization.manage') && (
              <Link to="/projects/settings" className="btn-ghost btn-sm">
                <Settings2 size={16} />
                {t('projectSettings.title')}
              </Link>
            )}
            {canCreate && (
              <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
                <Plus size={16} />
                {t('projects.new')}
              </button>
            )}
          </>
        }
      />

      {/* Toolbar. Tabs on one side, the tools that act on them on the other —
          the arrangement flips with the document direction on its own because
          nothing here is positioned left or right explicitly. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={tab} onChange={setTab} options={tabs} className="flex-1 min-w-[280px]" />

        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute inset-y-0 start-3 my-auto text-ink-faint"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('projects.search')}
            aria-label={t('projects.search')}
            className="field !w-[240px] ps-9"
          />
        </div>

        <div
          role="group"
          aria-label={t('projects.view.grid')}
          className="flex rounded-xl border border-surface-line bg-white p-1"
        >
          <button
            type="button"
            onClick={() => setLayout('grid')}
            aria-pressed={layout === 'grid'}
            title={t('projects.view.grid')}
            className={`btn-quiet !min-h-9 rounded-lg px-2.5 ${
              layout === 'grid' ? 'bg-navy text-white hover:bg-navy hover:text-white' : ''
            }`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            type="button"
            onClick={() => setLayout('table')}
            aria-pressed={layout === 'table'}
            title={t('projects.view.table')}
            className={`btn-quiet !min-h-9 rounded-lg px-2.5 ${
              layout === 'table' ? 'bg-navy text-white hover:bg-navy hover:text-white' : ''
            }`}
          >
            <Table2 size={16} />
          </button>
        </div>
      </div>

      {/* Loading shows the shape of what is coming rather than a spinner in an
          empty box, so the page does not jump when the rows land. */}
      {loading && projects.length === 0 ? (
        layout === 'grid' ? (
          <SkeletonCards cards={6} />
        ) : (
          <div className="card p-4">
            <SkeletonRows rows={8} />
          </div>
        )
      ) : error ? (
        <ErrorState body={error} onRetry={() => void load(0)} />
      ) : projects.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FolderKanban size={34} />}
            title={search ? t('projects.empty.search') : t(`projects.empty.${tab}` as Parameters<typeof t>[0])}
            body={
              search
                ? t('projects.empty.searchHint')
                : t(`projects.empty.${tab}Hint` as Parameters<typeof t>[0])
            }
            action={
              canCreate && tab === 'active' && !search ? (
                <div className="flex flex-col items-center gap-2">
                  <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
                    <Plus size={16} />
                    {t('projects.new')}
                  </button>
                  {/* The second way out of an empty workspace.
                      Somebody opening Projects for the first time has nothing
                      to look at and no idea what a filled screen would even
                      contain — "create a project" asks them to invent the
                      example. This offers them one instead. Shown only to
                      administrators, because they are the only people the
                      endpoint would accept. */}
                  {canManageDemo && (
                    <Link to="/projects/settings?tab=demo" className="btn-ghost btn-sm">
                      <Database size={15} />
                      {t('demo.load')}
                    </Link>
                  )}
                </div>
              ) : undefined
            }
          />
        </div>
      ) : layout === 'grid' ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard
                project={project}
                tab={tab}
                starred={starred.has(project.id)}
                onToggleFavorite={() => void toggleFavorite(project)}
                onArchive={() => void act(() => projectsApi.archive(project.id))}
                onUnarchive={() => void act(() => projectsApi.unarchive(project.id))}
                onDelete={() => void act(() => projectsApi.remove(project.id))}
                onRestore={() => void act(() => projectsApi.restore(project.id))}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ProjectTable
          projects={projects}
          tab={tab}
          starred={starred}
          onToggleFavorite={(project) => void toggleFavorite(project)}
          onArchive={(project) => void act(() => projectsApi.archive(project.id))}
          onUnarchive={(project) => void act(() => projectsApi.unarchive(project.id))}
          onDelete={(project) => void act(() => projectsApi.remove(project.id))}
          onRestore={(project) => void act(() => projectsApi.restore(project.id))}
        />
      )}

      {total > PAGE_SIZE && (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label={t('projects.title')}>
          <p className="text-[13px] font-semibold text-ink-muted">
            {t('projects.count', { n: total })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={offset === 0 || loading}
              onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
            >
              {lang === 'en' ? 'Previous' : 'السابق'}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => void load(offset + PAGE_SIZE)}
            >
              {lang === 'en' ? 'Next' : 'التالي'}
            </button>
          </div>
        </nav>
      )}

      <ProjectCreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast.push(t('projects.created'), 'ok');
          void load(0);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One project, two ways                                                */
/* ------------------------------------------------------------------ */

interface RowActions {
  onToggleFavorite: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
}

function ProjectCard({
  project,
  tab,
  starred,
  ...actions
}: { project: Project; tab: Tab; starred: boolean } & RowActions) {
  const { t } = useI18n();

  // One verdict, computed the same way on every screen in the module. The card
  // shows the worst true thing about the project rather than a score, because
  // "behind plan" is actionable and 0.72 is not.
  const health = projectHealth({
    progress: project.progress ?? null,
    startDate: project.startDate,
    endDate: project.endDate,
    status: project.status ?? null,
    overdueTasks: project.overdueTasks ?? 0,
  });

  return (
    <article className="card group relative flex h-full flex-col gap-3 p-4 transition-shadow hover:shadow-lift">
      <div className="flex items-start gap-3">
        {/* The colour bar carries the project's identity at a glance. It is a
            4px rail rather than a filled card because forty saturated cards on
            one screen is noise, not information. */}
        <span
          aria-hidden="true"
          className="mt-0.5 h-9 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: project.color }}
        />
        <div className="min-w-0 flex-1">
          <Link
            to={`/projects/${project.id}`}
            className="block truncate text-[15px] font-bold text-ink hover:text-brand-600"
          >
            {project.name}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-ink-faint">
            <span className="chip bg-surface-sunken font-mono text-ink-muted">{project.key}</span>
            {/* Demo projects sit in the same list as real work, so they say so.
                Somebody who finds a shop launch in their workspace is entitled
                to know at a glance that nobody on their team created it. */}
            {project.isDemo && (
              <span className="chip bg-accent-50 text-accent-700" title={t('demo.subtitle')}>
                {t('demo.badge')}
              </span>
            )}
            {project.customerName && (
              <span className="inline-flex min-w-0 items-center gap-1 truncate">
                <Building2 size={12} aria-hidden="true" />
                <span className="truncate">{project.customerName}</span>
              </span>
            )}
          </p>
        </div>
        <FavoriteButton starred={starred} onToggle={actions.onToggleFavorite} />
      </div>

      {/* Status and health together. The status is what somebody set; the
          health is what the dates and the progress actually say, and the two
          disagreeing is exactly the thing worth seeing. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {project.status && <StatusPill status={project.status} />}
        {/* Dropped when it would only repeat the status chip beside it —
            "Completed · Complete" spends two chips on one fact. */}
        {!health.redundantWithStatus && (
          <TonePill tone={health.tone} title={t('health.hint')}>
            {t(health.labelKey)}
          </TonePill>
        )}
        {(project.overdueTasks ?? 0) > 0 && (
          <TonePill tone="bad" icon={<AlertTriangle size={12} aria-hidden="true" />}>
            {t('projectTasks.overdueCount', { n: project.overdueTasks ?? 0 })}
          </TonePill>
        )}
      </div>

      {project.description && (
        <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-muted">{project.description}</p>
      )}

      {project.progress !== null && project.progress !== undefined && (
        <ProgressMeter
          value={project.progress}
          startDate={project.startDate}
          endDate={project.endDate}
          tone={health.tone === 'neutral' ? 'info' : health.tone}
        />
      )}

      <dl className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-muted">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">{t('projects.field.members')}</dt>
          <Users size={13} aria-hidden="true" />
          <dd>{t('projects.memberCount', { n: project.memberCount })}</dd>
        </div>
        {(project.taskCount ?? 0) > 0 && (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">{t('projectTasks.title')}</dt>
            <ListChecks size={13} aria-hidden="true" />
            <dd className="tabular-nums">
              {project.doneCount ?? 0}/{project.taskCount}
            </dd>
          </div>
        )}
        {project.endDate && (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">{t('projects.field.endDate')}</dt>
            <CalendarRange size={13} aria-hidden="true" />
            <dd>
              <DueBadge date={project.endDate} status={project.status ?? null} showDate={false} />
            </dd>
          </div>
        )}
      </dl>

      <RowMenu project={project} tab={tab} {...actions} />
    </article>
  );
}

function ProjectTable({
  projects,
  tab,
  starred,
  onToggleFavorite,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
}: {
  projects: Project[];
  tab: Tab;
  starred: Set<string>;
  onToggleFavorite: (project: Project) => void;
  onArchive: (project: Project) => void;
  onUnarchive: (project: Project) => void;
  onDelete: (project: Project) => void;
  onRestore: (project: Project) => void;
}) {
  const { t } = useI18n();

  return (
    // The wrapper scrolls, not the page — §75 and §73 both land here: a wide
    // table on a phone must never make the whole document scroll sideways.
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[900px] text-start text-sm">
        <thead>
          {/* Uppercasing is dropped in Arabic, which has no case and reads
              worse letter-spaced. The weight carries the header instead. */}
          <tr className="border-b border-surface-line text-[12px] font-semibold text-ink-faint">
            <th scope="col" className="w-10 px-3 py-2.5" />
            <th scope="col" className="px-3 py-2.5 text-start font-semibold">
              {t('projects.field.name')}
            </th>
            <th scope="col" className="px-3 py-2.5 text-start font-semibold">
              {t('projects.field.status')}
            </th>
            <th scope="col" className="px-3 py-2.5 text-start font-semibold">
              <span className="inline-flex items-center gap-1">
                {t('health.label')}
                <HelpTip body="health.hint" />
              </span>
            </th>
            <th scope="col" className="w-40 px-3 py-2.5 text-start font-semibold">
              {t('progress.label')}
            </th>
            <th scope="col" className="px-3 py-2.5 text-start font-semibold">
              {t('projects.field.customer')}
            </th>
            <th scope="col" className="px-3 py-2.5 text-start font-semibold">
              {t('projects.field.endDate')}
            </th>
            <th scope="col" className="w-12 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const health = projectHealth({
              progress: project.progress ?? null,
              startDate: project.startDate,
              endDate: project.endDate,
              status: project.status ?? null,
              overdueTasks: project.overdueTasks ?? 0,
            });

            return (
              <tr key={project.id} className="border-b border-surface-line last:border-0 hover:bg-surface-sunken/60">
                <td className="px-3 py-2.5">
                  <FavoriteButton
                    starred={starred.has(project.id)}
                    onToggle={() => onToggleFavorite(project)}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <Link
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-2 font-semibold text-ink hover:text-brand-600"
                  >
                    <span
                      aria-hidden="true"
                      className="h-4 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{project.name}</span>
                      <span className="block font-mono text-[11px] font-normal text-ink-faint">
                        {project.key}
                        {project.isDemo && (
                          <span className="ms-1.5 font-sans text-accent-700">· {t('demo.badge')}</span>
                        )}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <StatusPill status={project.status ?? null} />
                </td>
                <td className="px-3 py-2.5">
                  {health.redundantWithStatus ? (
                    <span className="text-[12px] text-ink-faint">—</span>
                  ) : (
                    <TonePill tone={health.tone}>{t(health.labelKey)}</TonePill>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <ProgressMeter
                    value={project.progress ?? null}
                    startDate={project.startDate}
                    endDate={project.endDate}
                    tone={health.tone === 'neutral' ? 'info' : health.tone}
                    showLabel={false}
                  />
                  <span className="mt-1 block text-[11px] tabular-nums text-ink-faint">
                    {project.progress === null || project.progress === undefined
                      ? '—'
                      : `${project.progress}%`}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-ink-muted">{project.customerName ?? '—'}</td>
                <td className="px-3 py-2.5">
                  <DueBadge date={project.endDate} status={project.status ?? null} />
                </td>
                <td className="px-3 py-2.5">
                  <RowMenu
                    project={project}
                    tab={tab}
                    onArchive={() => onArchive(project)}
                    onUnarchive={() => onUnarchive(project)}
                    onDelete={() => onDelete(project)}
                    onRestore={() => onRestore(project)}
                    compact
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FavoriteButton({ starred, onToggle }: { starred: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={starred}
      aria-label={starred ? t('projects.action.unfavorite') : t('projects.action.favorite')}
      title={starred ? t('projects.action.unfavorite') : t('projects.action.favorite')}
      className="btn-quiet !min-h-8 shrink-0 rounded-lg p-1.5"
    >
      <Star
        size={16}
        className={starred ? 'fill-accent-500 text-accent-500' : 'text-ink-faint'}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * The row's actions.
 *
 * Rendered as plain buttons rather than a dropdown: there are at most three,
 * and a menu that hides three items behind a click costs more than it saves.
 * Which three depends on where the project already is — an archived project
 * offers "unarchive", a trashed one offers "restore", and neither offers both.
 */
function RowMenu({
  project,
  tab,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  compact,
}: { project: Project; tab: Tab; compact?: boolean } & Omit<RowActions, 'onToggleFavorite'>) {
  const { t } = useI18n();

  const button = (
    label: string,
    icon: JSX.Element,
    onClick: () => void,
    tone: 'quiet' | 'danger' = 'quiet'
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={`${label} — ${project.name}`}
      className={`${tone === 'danger' ? 'btn-danger' : 'btn-quiet'} !min-h-8 rounded-lg px-2`}
    >
      {icon}
      {!compact && <span className="text-[12px]">{label}</span>}
    </button>
  );

  return (
    <div
      className={
        compact
          ? 'flex justify-end gap-1'
          : 'flex flex-wrap gap-1 border-t border-surface-line pt-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100'
      }
    >
      {tab === 'trashed'
        ? button(t('projects.action.restore'), <ArchiveRestore size={15} />, onRestore)
        : tab === 'archived'
          ? button(t('projects.action.unarchive'), <ArchiveRestore size={15} />, onUnarchive)
          : (
            <>
              {button(t('projects.action.archive'), <Archive size={15} />, onArchive)}
              {button(t('projects.action.delete'), <Trash2 size={15} />, onDelete, 'danger')}
            </>
          )}
    </div>
  );
}
