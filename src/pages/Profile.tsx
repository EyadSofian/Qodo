/**
 * One person's page: who they are, how their work is going, and the two lists
 * that answer the only questions anybody actually opens this for — what have
 * they finished, and what is still on their plate.
 *
 * Everything here is read from endpoints that already enforce their own rules.
 * `/tasks` is filtered by the caller's visibility, and `/tasks/overview` hands
 * an employee only their own performance row, so opening a colleague's page
 * shows their work without exposing scores that are not yours to read. The
 * page states that rather than rendering an empty panel.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {AlarmClock, ArrowRight, CalendarClock, Lock, Mail} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import {
  departmentLabel,
  getDepartment,
  isDoneStage,
  jobRoleLabel,
  stageLabel,
  subteamLabel,
} from '@shared/departments';
import { ScoreChip, StateBadge } from '../components/TaskWorkflow';
import { ModuleIcon } from '../components/ModuleIcon';
import { Avatar, EmptyState, Spinner } from '../components/ui';
import { BarList, ChartCard, SplitBar } from '../components/Charts';
import { DUE_CHIP_CLASS, cx, dueLabel } from '../lib/utils';
import type { PerformanceOverview, PerformancePerson, Task } from '../lib/types';
import { assigneesOf } from '@shared/workflow';

export function Profile() {
  const { id = '' } = useParams();
  const { t, lang } = useI18n();
  const { user: me } = useAuth();
  const { userById } = useWorkspace();

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [metrics, setMetrics] = useState<PerformancePerson | null>(null);

  const person = userById(id);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ tasks: Task[] }>('/tasks')
      .then(({ tasks: list }) => {
        if (!cancelled) setTasks(list.filter((task) => assigneesOf(task).includes(id)));
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      });

    // Absent for a colleague's page when the reader is not a manager — that is
    // the privacy rule doing its job, not a failure.
    api
      .get<PerformanceOverview>('/tasks/overview')
      .then((data) => {
        if (!cancelled) setMetrics(data.people.find((row) => row.user.id === id) ?? null);
      })
      .catch(() => {
        if (!cancelled) setMetrics(null);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const { open, done } = useMemo(() => {
    const list = tasks ?? [];
    return {
      open: list.filter((task) => !isDoneStage(task.department, task.stage)),
      done: list.filter((task) => isDoneStage(task.department, task.stage)),
    };
  }, [tasks]);

  if (!person) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState icon={<Lock size={24} />} title={t('profile.notFound')} />
        <div className="mt-5 text-center">
          <Link to="/users" className="btn-ghost btn-sm">
            {t('users.title')}
          </Link>
        </div>
      </div>
    );
  }

  const department = getDepartment(person.department);
  const branch = subteamLabel(person.department, person.subteam, lang);
  const job = jobRoleLabel(person.department, person.subteam, person.jobRole, lang);

  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 py-6">
      <header className="overflow-hidden rounded-2xl border border-surface-line bg-white shadow-card">
        <div className="h-1.5" style={{ backgroundColor: department.color }} />
        <div className="flex flex-wrap items-start gap-4 p-5">
          <Avatar name={person.name} color={person.avatarColor} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-extrabold text-ink">
              {person.name}
              {person.id === me?.id && (
                <span className="ms-2 align-middle text-[12px] font-semibold text-ink-faint">
                  ({t('profile.self')})
                </span>
              )}
            </h1>
            {person.title && (
              <p className="mt-0.5 text-[13px] text-ink-muted">{person.title}</p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="chip bg-surface-sunken text-ink-muted">
                <ModuleIcon name={department.icon} color={department.color} size={13} variant="plain" />
                {departmentLabel(person.department, lang)}
              </span>
              {branch && <span className="chip bg-surface-sunken text-ink-muted">{branch}</span>}
              {job && <span className="chip bg-brand-50 text-brand-600">{job}</span>}
            </div>
            <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-ink-faint">
              <Mail size={13} />
              <span className="ltr">{person.email}</span>
            </p>
          </div>
        </div>
      </header>

      {metrics ? (
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label={t('performance.total')} value={metrics.total} />
          <Tile label={t('profile.done')} value={metrics.completed} tone="text-status-ok" />
          <Tile label={t('profile.remaining')} value={metrics.active} tone="text-brand-600" />
          <Tile label={t('performance.overdue')} value={metrics.overdue} tone="text-status-bad" />
          <Tile label={t('performance.onTime')} value={`${metrics.onTimeRate}%`} tone="text-teal-600" />
          <Tile
            label={t('performance.averageScore')}
            value={metrics.averageScore === null ? '—' : metrics.averageScore}
            tone="text-accent-600"
          />
        </section>
      ) : (
        <p className="flex items-center gap-2 rounded-2xl border border-surface-line bg-white px-4 py-3 text-[12.5px] text-ink-muted">
          <Lock size={14} className="shrink-0 text-ink-faint" />
          {t('profile.metricsPrivate')}
        </p>
      )}

      {metrics && <PerformanceCharts metrics={metrics} />}

      {tasks === null ? (
        <div className="flex items-center justify-center gap-2 py-14 text-ink-muted">
          <Spinner size={18} />
          {t('common.loading')}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <TaskList title={t('profile.remaining')} empty={t('profile.noOpen')} tasks={open} />
          <TaskList title={t('profile.done')} empty={t('profile.noDone')} tasks={done} />
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone = 'text-ink',
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-surface-line bg-white p-3.5 shadow-card">
      <p className="text-[11.5px] font-semibold text-ink-faint">{label}</p>
      <p className={cx('mt-1 text-[22px] font-extrabold tabular-nums', tone)}>{value}</p>
    </div>
  );
}

function TaskList({ title, empty, tasks }: { title: string; empty: string; tasks: Task[] }) {
  const { t, lang } = useI18n();

  return (
    <section className="overflow-hidden rounded-2xl border border-surface-line bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-surface-line px-4 py-3">
        <h2 className="text-[14px] font-extrabold text-ink">{title}</h2>
        <span className="chip bg-surface-sunken tabular-nums text-ink-muted">{tasks.length}</span>
      </div>

      {tasks.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px] text-ink-faint">{empty}</p>
      ) : (
        <ul className="divide-y divide-surface-line">
          {tasks.map((task) => {
            const due = task.dueDate ? dueLabel(task.dueDate, t, lang) : null;
            return (
              <li key={task.id}>
                <Link
                  to={`/tasks?task=${task.id}`}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-ink">{task.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StateBadge task={task} />
                      <span className="chip bg-surface-sunken text-ink-muted">
                        {stageLabel(task.department, task.stage, lang)}
                      </span>
                      {due && (
                        <span className={cx('chip', DUE_CHIP_CLASS[due.tone])}>
                          <CalendarClock size={12} />
                          {due.text}
                        </span>
                      )}
                      {Number.isFinite(task.score) && <ScoreChip score={task.score as number} size="sm" />}
                    </div>
                  </div>
                  <ArrowRight size={15} className="mt-1 shrink-0 text-ink-faint rtl:rotate-180" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The two questions a person asks about their own record: how much is left, and
 * how long things take me.
 *
 * Kept to three panels on purpose. A profile is read in a few seconds before
 * somebody goes back to work, and a wall of charts is how a page stops being
 * read at all — the numbers that answer nothing stay in the tiles above.
 */
function PerformanceCharts({ metrics }: { metrics: PerformancePerson }) {
  const { t } = useI18n();

  const timed = metrics.timedTasks > 0;
  const quality = [
    { label: t('performance.onTime'), value: metrics.onTimeRate, display: `${metrics.onTimeRate}\u066A` },
    { label: t('performance.firstPass'), value: metrics.firstPassRate, display: `${metrics.firstPassRate}\u066A` },
    { label: t('profile.completionRate'), value: metrics.completionRate, display: `${metrics.completionRate}\u066A` },
  ];

  return (
    <section className="grid gap-3 lg:grid-cols-3">
      <ChartCard title={t('profile.workload')} hint={t('profile.workloadHint')}>
        <SplitBar
          parts={[
            { label: t('profile.done'), value: metrics.completed },
            { label: t('profile.remaining'), value: metrics.active },
          ]}
        />
        {metrics.overdue > 0 && (
          <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-status-badBg px-2.5 py-2 text-[12px] font-semibold text-status-bad">
            <AlarmClock size={14} className="shrink-0" />
            {t('profile.overdueNote', { n: metrics.overdue })}
          </p>
        )}
      </ChartCard>

      <ChartCard title={t('profile.speed')} hint={t('profile.speedHint')}>
        {timed ? (
          <div className="grid gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[30px] font-extrabold leading-none tabular-nums text-ink">
                {metrics.medianDays}
              </span>
              <span className="text-[13px] font-semibold text-ink-muted">{t('profile.daysTypical')}</span>
            </div>
            {/* The mean sits underneath rather than beside: where the two
                disagree it is one slow task pulling, and the median is the
                honest headline. */}
            <BarList
              data={[
                { label: t('profile.fastest'), value: metrics.fastestDays ?? 0, display: `${metrics.fastestDays} ${t('profile.day')}` },
                { label: t('profile.average'), value: metrics.averageDays ?? 0, display: `${metrics.averageDays} ${t('profile.day')}` },
                { label: t('profile.slowest'), value: metrics.slowestDays ?? 0, display: `${metrics.slowestDays} ${t('profile.day')}` },
              ]}
            />
            <p className="text-[11.5px] text-ink-faint">
              {t('profile.timedFrom', { n: metrics.timedTasks })}
            </p>
          </div>
        ) : (
          <p className="py-6 text-center text-[12.5px] text-ink-faint">{t('profile.noTiming')}</p>
        )}
      </ChartCard>

      <ChartCard title={t('profile.quality')} hint={t('profile.qualityHint')}>
        <BarList data={quality} max={100} />
      </ChartCard>
    </section>
  );
}
