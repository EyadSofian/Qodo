/**
 * Qodo Projects — a project at a glance.
 *
 * Deliberately not a dashboard. A dashboard is configurable widgets over
 * arbitrary data and belongs in Phase 9; this is the fixed set of numbers that
 * answer "is this project alright" the moment somebody opens it, computed from
 * the same endpoints the other tabs use rather than from a second aggregation
 * that could disagree with them.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Layers, ListChecks, Users } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { phasesApi, projectTasksApi, projectsApi } from '../../../lib/projects/api';
import type { Phase, ProjectMember } from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { Spinner } from '../../../components/ui';

export function ProjectOverview() {
  const { detail } = useProject();
  const { t, lang } = useI18n();
  const projectId = detail.project.id;

  const [phases, setPhases] = useState<Phase[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Four small reads rather than one aggregate endpoint. Each is a page of
      // one where only the total matters, so the cost is four counts in SQL —
      // and every number here is the same number the tab it belongs to shows.
      const [phaseResult, memberResult, allTasks, overdueTasks] = await Promise.all([
        phasesApi.list(projectId),
        projectsApi.members(projectId).catch(() => ({ members: [] as ProjectMember[] })),
        projectTasksApi.list(projectId, { limit: 1 }),
        projectTasksApi.list(projectId, { overdue: true, limit: 1 }),
      ]);
      setPhases(phaseResult.phases);
      setMembers(memberResult.members);
      setTaskTotal(allTasks.total);
      setOverdue(overdueTasks.total);
    } catch (caught) {
      setError(errorMessage(caught, lang));
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
      <div className="card grid place-items-center py-16">
        <Spinner size={22} className="text-brand-500" />
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="card px-4 py-6 text-center text-sm font-semibold text-status-bad">
        {error}
      </p>
    );
  }

  const done = phases.reduce((sum, phase) => sum + phase.doneCount, 0);
  const tracked = phases.reduce((sum, phase) => sum + phase.taskCount, 0);

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<Layers size={16} />} label={t('projects.nav.phases')} value={phases.length} />
        <Stat icon={<ListChecks size={16} />} label={t('projectTasks.title')} value={taskTotal} />
        <Stat
          icon={<CheckCircle2 size={16} />}
          label={t('phases.progress', { done, total: tracked })}
          value={tracked === 0 ? '—' : `${Math.round((done / tracked) * 100)}%`}
        />
        <Stat
          icon={<AlertTriangle size={16} />}
          label={t('projectTasks.filter.overdue')}
          value={overdue}
          // Only tinted when there is something to be alarmed about. A red card
          // that always says zero teaches people to stop reading it.
          tone={overdue > 0 ? 'bad' : 'neutral'}
        />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
          <Users size={16} className="text-ink-muted" />
          {t('projects.nav.members')}
          <span className="chip bg-surface-sunken text-ink-muted">{members.length}</span>
        </h2>
        {members.length === 0 ? (
          <p className="text-[13px] text-ink-muted">{t('common.none')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {members.map((member) => (
              <li key={member.userId} className="chip bg-surface-sunken text-ink-muted">
                {member.name ?? t('common.unknown')}
                <span className="text-ink-faint">· {member.role}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.project.description && (
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-bold text-ink">{t('projects.field.description')}</h2>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted">
            {detail.project.description}
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: 'neutral' | 'bad';
}) {
  return (
    <article
      className={`card p-3.5 ${tone === 'bad' ? 'border-status-bad/30 bg-status-badBg/40' : ''}`}
    >
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-muted">
        <span className={tone === 'bad' ? 'text-status-bad' : 'text-ink-faint'} aria-hidden="true">
          {icon}
        </span>
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold tabular-nums ${
          tone === 'bad' ? 'text-status-bad' : 'text-ink'
        }`}
      >
        {value}
      </p>
    </article>
  );
}
