import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowUpRight, CheckCircle2, CircleAlert, ListChecks, MoveLeft, MoveRight } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { useOpenApp } from '../lib/useOpenApp';
import { PERMISSIONS } from '@shared/permissions';
import { DEFAULT_DEPARTMENT, getDepartment, isDoneStage, stageLabel } from '@shared/departments';
import { isReviewer, taskState } from '@shared/workflow';
import { ModuleIcon } from '../components/ModuleIcon';
import { EmptyState } from '../components/ui';
import { CountBadge } from '../components/Shell';
import { DUE_CHIP_CLASS, PRIORITY_META, cx, daysUntil, dueLabel } from '../lib/utils';
import type { Task, WorkspaceApp } from '../lib/types';

/**
 * The home screen: every app the signed-in user is allowed to open, as one
 * grid, plus the work waiting for them underneath it.
 */
export function Launcher() {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const { apps, loading } = useWorkspace();
  const openApp = useOpenApp();

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-9">
      <Greeting name={user?.name ?? ''} />

      {loading ? (
        <TileSkeletons />
      ) : apps.length === 0 ? (
        <div className="card mt-7">
          <EmptyState title={t('launcher.noAppsTitle')} body={t('launcher.noAppsBody')} />
        </div>
      ) : (
        <AppGrid apps={apps} onOpen={openApp} />
      )}

      {can(PERMISSIONS.TASKS_VIEW) && <MyWork />}
    </div>
  );
}

function Greeting({ name }: { name: string }) {
  const { t, lang } = useI18n();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('launcher.goodMorning') : t('launcher.goodEvening');
  const firstName = name.split(/\s+/)[0] ?? '';

  const today = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <header className="mb-6 sm:mb-8">
      <h1 className="text-[22px] font-extrabold leading-tight text-ink sm:text-[27px]">
        {greeting}
        {firstName && (lang === 'en' ? `, ${firstName}` : `، ${firstName}`)} 👋
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-muted">{today}</p>
    </header>
  );
}

function AppGrid({ apps, onOpen }: { apps: WorkspaceApp[]; onOpen: (app: WorkspaceApp) => void }) {
  const { t, lang } = useI18n();
  const { taskCounts } = useWorkspace();

  // Only the built-in Tasks tile has a number the hub actually knows. The other
  // apps own their own data, so guessing a badge for them would be a lie.
  const badgeFor = (app: WorkspaceApp) =>
    app.id === 'tasks' ? taskCounts.mine + taskCounts.awaitingMyReview : 0;

  return (
    <section aria-label={t('shell.apps')}>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
        {apps.map((app, index) => (
          <motion.button
            key={app.id}
            type="button"
            onClick={() => onOpen(app)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, delay: Math.min(index * 0.035, 0.4), ease: [0.22, 1, 0.36, 1] }}
            whileTap={{ scale: 0.97 }}
            className="group relative flex flex-col items-center gap-2.5 rounded-2xl border border-white/70 bg-white/85 px-2 py-4 text-center shadow-tile backdrop-blur transition-all duration-200 hover:-translate-y-1 hover:border-white hover:bg-white hover:shadow-lift sm:gap-3 sm:px-3 sm:py-5"
            title={app.descAr}
          >
            {app.kind === 'external' && (
              <ArrowUpRight
                size={13}
                className="absolute end-2 top-2 text-ink-faint/60 transition-colors group-hover:text-brand-500"
                aria-label={t('launcher.externalApp')}
              />
            )}
            <span className="relative">
              <ModuleIcon
                name={app.icon}
                color={app.color}
                size={54}
                className="transition-transform duration-200 group-hover:scale-[1.06]"
              />
              {badgeFor(app) > 0 && (
                <CountBadge value={badgeFor(app)} urgent={taskCounts.overdue > 0} />
              )}
            </span>
            <span className="line-clamp-2 text-[12.5px] font-bold leading-tight text-ink sm:text-[13.5px]">
              {lang === 'en' && app.nameEn ? app.nameEn : app.nameAr}
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

function TileSkeletons() {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex flex-col items-center gap-3 rounded-2xl bg-white/60 px-3 py-5">
          <div className="skeleton h-[54px] w-[54px] rounded-2xl" />
          <div className="skeleton h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/* ── My work ─────────────────────────────────────────────────────── */

function MyWork() {
  const { user } = useAuth();
  const { t, lang, dir } = useI18n();
  const { appById } = useWorkspace();
  const [tasks, setTasks] = useState<Task[] | null>(null);

  useEffect(() => {
    api
      .get<{ tasks: Task[] }>('/tasks')
      .then((data) => setTasks(data.tasks))
      .catch(() => setTasks([]));
  }, []);

  const mine = useMemo(() => {
    if (!tasks || !user) return null;
    const open = tasks.filter(
      (t) => t.assigneeId === user.id && !isDoneStage(t.department ?? DEFAULT_DEPARTMENT, t.stage)
    );
    return {
      open,
      // A manager's real backlog is not their own tasks — it is other people's
      // work sitting in their queue, blocking the board behind it.
      toReview: isReviewer(user)
        ? tasks.filter((t) => taskState(t) === 'submitted' && t.assigneeId !== user.id).length
        : null,
      overdue: open.filter((t) => (daysUntil(t.dueDate) ?? 99) < 0).length,
      doneThisWeek: tasks.filter(
        (t) =>
          t.assigneeId === user.id &&
          t.completedAt &&
          Date.now() - new Date(t.completedAt).getTime() < 7 * 86_400_000
      ).length,
      // Undated work sinks below anything with a deadline.
      next: [...open]
        .sort((a, b) => {
          const dayA = daysUntil(a.dueDate) ?? 9999;
          const dayB = daysUntil(b.dueDate) ?? 9999;
          return dayA - dayB || PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;
        })
        .slice(0, 5),
    };
  }, [tasks, user]);

  if (tasks === null) return <div className="skeleton mt-8 h-40 rounded-2xl" />;

  const ArrowIcon = dir === 'rtl' ? MoveLeft : MoveRight;

  return (
    <section className="mt-8 sm:mt-10" aria-label={t('launcher.myWork')}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-ink">
          <ListChecks size={18} className="text-brand-500" />
          {t('launcher.myWork')}
        </h2>
        <Link to="/tasks" className="flex items-center gap-1 text-[12.5px] font-semibold text-brand-500 hover:underline">
          {t('launcher.wholeBoard')}
          <ArrowIcon size={14} />
        </Link>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="card overflow-hidden">
          {mine && mine.next.length > 0 ? (
            <ul className="divide-y divide-surface-line">
              {mine.next.map((task) => {
                const due = dueLabel(task.dueDate, t, lang);
                const app = appById(task.appId);
                const departmentId = task.department ?? DEFAULT_DEPARTMENT;
                const department = getDepartment(departmentId);
                return (
                  <li key={task.id}>
                    <Link
                      to={`/tasks?task=${task.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: department.color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-ink">
                          {task.title}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-faint">
                          {app && (
                            <span className="inline-flex items-center gap-1">
                              <ModuleIcon name={app.icon} color={app.color} size={13} variant="plain" />
                              {lang === 'en' && app.nameEn ? app.nameEn : app.nameAr}
                            </span>
                          )}
                          <span>{stageLabel(departmentId, task.stage, lang)}</span>
                        </span>
                      </span>
                      {due && <span className={cx('chip shrink-0', DUE_CHIP_CLASS[due.tone])}>{due.text}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<CheckCircle2 size={26} />}
              title={t('launcher.noOpenTasks')}
              body={t('launcher.noOpenTasksBody')}
            />
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          <Stat label={t('launcher.statOpen')} value={mine?.open.length ?? 0} tone="info" />
          <Stat label={t('launcher.statOverdue')} value={mine?.overdue ?? 0} tone={mine?.overdue ? 'bad' : 'muted'} />
          {mine?.toReview === null || mine?.toReview === undefined ? (
            <Stat label={t('launcher.statDoneWeek')} value={mine?.doneThisWeek ?? 0} tone="ok" />
          ) : (
            <Stat
              label={t('flow.awaitingYou')}
              value={mine.toReview}
              tone={mine.toReview ? 'warn' : 'muted'}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'info' | 'bad' | 'ok' | 'warn' | 'muted';
}) {
  const tones = {
    info: 'text-brand-600',
    bad: 'text-status-bad',
    ok: 'text-status-ok',
    warn: 'text-accent-600',
    muted: 'text-ink-muted',
  };
  return (
    <div className="card flex flex-col justify-center gap-1 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
      <span className="order-2 text-[12px] font-semibold text-ink-muted lg:order-1">{label}</span>
      <span className={cx('order-1 text-2xl font-extrabold tabular-nums lg:order-2', tones[tone])}>
        {value}
        {tone === 'bad' && value > 0 && <CircleAlert size={15} className="mb-1 ms-1 inline" />}
      </span>
    </div>
  );
}
