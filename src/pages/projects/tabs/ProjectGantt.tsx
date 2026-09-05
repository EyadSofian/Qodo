/**
 * Qodo Projects — the Gantt tab.
 *
 * Loads the tasks, the computed schedule, the dependency graph and — if one has
 * been captured — the baseline variance, then hands them to the chart.
 *
 * The interaction that matters is the drag. It does not write: it asks the
 * server what *would* happen, shows the answer ("this shifts four tasks and
 * pushes the project six working days later"), and commits only if the person
 * agrees. A chart that silently reschedules half a project because somebody
 * nudged a bar is not a faster tool, it is a lost afternoon.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, Flag, GitBranch, RotateCcw } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { projectTasksApi, scheduleApi } from '../../../lib/projects/api';
import type {
  BaselineVariance,
  ProjectBaseline,
  ProjectSchedule,
  ProjectTask,
  TaskDependency,
} from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { EmptyState, Segmented, Spinner, useToast } from '../../../components/ui';
import { Gantt, type GanttZoom } from '../../../components/projects/Gantt';

export function ProjectGantt() {
  const { detail, can } = useProject();
  const { t, lang } = useI18n();
  const toast = useToast();
  const projectId = detail.project.id;

  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [schedule, setSchedule] = useState<ProjectSchedule | null>(null);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [baselines, setBaselines] = useState<ProjectBaseline[]>([]);
  const [baselineId, setBaselineId] = useState('');
  const [variance, setVariance] = useState<BaselineVariance[] | null>(null);
  const [zoom, setZoom] = useState<GanttZoom>('week');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [taskResult, scheduleResult, dependencyResult, baselineResult] = await Promise.all([
        projectTasksApi.list(projectId, { limit: 200, sort: 'start' }),
        scheduleApi.get(projectId),
        scheduleApi.dependencies(projectId),
        scheduleApi.baselines(projectId),
      ]);
      setTasks(taskResult.tasks);
      setSchedule(scheduleResult);
      setDependencies(dependencyResult.dependencies);
      setBaselines(baselineResult.baselines);
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

  // The variance is only fetched when a baseline is actually selected — most
  // projects have none, and a request that always returns nothing is a request
  // that should not be made.
  useEffect(() => {
    if (!baselineId) {
      setVariance(null);
      return;
    }
    let alive = true;
    scheduleApi
      .variance(projectId, baselineId)
      .then(({ variance: loaded }) => {
        if (alive) setVariance(loaded);
      })
      .catch(() => {
        if (alive) setVariance(null);
      });
    return () => {
      alive = false;
    };
  }, [projectId, baselineId]);

  /**
   * Preview, confirm, commit.
   *
   * `window.confirm` rather than a bespoke dialog: the question is one sentence
   * with two answers, it must interrupt, and a custom modal here would be a
   * third confirmation pattern in a codebase that already has two.
   */
  const move = async (taskId: string, startDate: string) => {
    try {
      const preview = await scheduleApi.previewMove(projectId, taskId, startDate);
      if (!preview.ok) {
        toast.push(t('gantt.cycle'), 'bad');
        return;
      }

      const others = Math.max(0, preview.changes.length - 1);
      const slip = preview.projectSlipDays ?? 0;

      if (others > 0) {
        const message =
          slip !== 0
            ? t('gantt.moveConfirm', { n: others, days: slip })
            : t('gantt.moveConfirmNoSlip', { n: others });
        if (!window.confirm(message)) return;
      }

      await scheduleApi.commitMove(projectId, taskId, startDate);
      toast.push(t('gantt.moved'), 'ok');
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  const captureBaseline = async () => {
    try {
      const { baseline } = await scheduleApi.captureBaseline(projectId);
      toast.push(t('gantt.baselineCaptured'), 'ok');
      setBaselines((current) => [baseline, ...current]);
      setBaselineId(baseline.id);
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  if (loading) {
    return (
      <div className="card grid place-items-center py-16">
        <Spinner size={22} className="text-brand-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <EmptyState
          icon={<CalendarRange size={32} />}
          title={t('projects.error.load')}
          body={error}
          action={
            <button type="button" className="btn-ghost btn-sm" onClick={() => void load()}>
              <RotateCcw size={15} />
              {t('projects.error.retry')}
            </button>
          }
        />
      </div>
    );
  }

  const criticalCount = schedule?.ok ? schedule.criticalPath.length : 0;

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={zoom}
          onChange={setZoom}
          options={[
            { value: 'day' as GanttZoom, label: t('gantt.zoom.day') },
            { value: 'week' as GanttZoom, label: t('gantt.zoom.week') },
            { value: 'month' as GanttZoom, label: t('gantt.zoom.month') },
          ]}
        />

        {baselines.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="sr-only">{t('gantt.baseline')}</span>
            <select
              className="field !w-auto !py-1.5 !text-[13px]"
              value={baselineId}
              onChange={(event) => setBaselineId(event.target.value)}
            >
              <option value="">{t('gantt.noBaseline')}</option>
              {baselines.map((baseline) => (
                <option key={baseline.id} value={baseline.id}>
                  {baseline.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {can('baseline.create') && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => void captureBaseline()}>
            <Flag size={15} />
            {t('gantt.captureBaseline')}
          </button>
        )}

        {schedule?.ok === false && (
          <p role="alert" className="chip bg-status-badBg text-status-bad">
            <GitBranch size={12} aria-hidden="true" />
            {t('gantt.cycle')}
          </p>
        )}

        {criticalCount > 0 && (
          <p className="chip bg-status-badBg text-status-bad">
            {t('gantt.criticalPath')}: {criticalCount}
          </p>
        )}
      </div>

      <Gantt
        tasks={tasks}
        schedule={schedule}
        dependencies={dependencies}
        variance={variance}
        zoom={zoom}
        canEdit={can('task.edit_schedule')}
        onMove={(taskId, startDate) => void move(taskId, startDate)}
      />
    </section>
  );
}
