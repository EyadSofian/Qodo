import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  BellDot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  LayoutGrid,
  ListChecks,
  MoveLeft,
  MoveRight,
  Search,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { useOpenApp } from '../lib/useOpenApp';
import { PERMISSIONS } from '@shared/permissions';
import { DEFAULT_DEPARTMENT, getDepartment, isDoneStage, stageLabel } from '@shared/departments';
import { isAssignee, isReviewer, taskState } from '@shared/workflow';
import { ModuleIcon } from '../components/ModuleIcon';
import { EmptyState } from '../components/ui';
import { CountBadge } from '../components/Shell';
import { TaskTiming } from '../components/TaskWorkflow';
import { PRIORITY_META, cx, daysUntil, hexWithAlpha } from '../lib/utils';
import { deliveryLatenessDays } from '@shared/taskTiming';
import type { Task, WorkspaceApp } from '../lib/types';

const TASK_POLL_MS = 20_000;
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The home screen, laid out as a command deck: a night band with the greeting
 * and the numbers that need you, then one sheet holding every app you may open
 * (grouped, filterable), then the work waiting for you.
 */
export function Launcher() {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const { apps, loading } = useWorkspace();
  const openApp = useOpenApp();
  const canTasks = can(PERMISSIONS.TASKS_VIEW);
  const work = useMyWork(canTasks);

  return (
    <div>
      <CommandDeck name={user?.name ?? ''} work={canTasks ? work : null} appCount={apps.length} />

      <div className="relative mx-auto -mt-20 w-full max-w-[1600px] px-3 sm:-mt-24 sm:px-6">
        {loading ? (
          <div className="lx-sheet">
            <TileSkeletons />
          </div>
        ) : apps.length === 0 ? (
          <div className="lx-sheet">
            <EmptyState title={t('launcher.noAppsTitle')} body={t('launcher.noAppsBody')} />
          </div>
        ) : (
          <AppDeck apps={apps} onOpen={openApp} />
        )}

        {canTasks && <MyWork work={work} />}
      </div>
    </div>
  );
}

/* ── Data ────────────────────────────────────────────────────────── */

interface MyWorkSummary {
  open: Task[];
  toReview: number | null;
  overdue: number;
  doneThisWeek: number;
  next: Task[];
}

function useMyWork(enabled: boolean) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refresh = () => {
      if (!active || document.visibilityState !== 'visible') return;
      api
        .get<{ tasks: Task[] }>('/tasks')
        .then((data) => active && setTasks(data.tasks))
        .catch(() => active && setTasks((current) => current ?? []));
    };
    refresh();
    const timer = window.setInterval(refresh, TASK_POLL_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled]);

  const mine = useMemo<MyWorkSummary | null>(() => {
    if (!tasks || !user) return null;
    const open = tasks.filter(
      (t) => isAssignee(user, t) && !isDoneStage(t.department ?? DEFAULT_DEPARTMENT, t.stage)
    );
    return {
      open,
      // A manager's real backlog is not their own tasks — it is other people's
      // work sitting in their queue, blocking the board behind it.
      toReview: isReviewer(user)
        ? tasks.filter((t) => taskState(t) === 'submitted' && !isAssignee(user, t)).length
        : null,
      // Work already handed in is judged on the hand-in, not on today. Counting
      // a task somebody delivered on time as overdue because it is still
      // sitting in review puts a manager's queue on the employee's tally.
      overdue: open.filter((t) => {
        const late = deliveryLatenessDays(t);
        return late === null ? (daysUntil(t.dueDate) ?? 99) < 0 : late > 0;
      }).length,
      doneThisWeek: tasks.filter(
        (t) =>
          isAssignee(user, t) &&
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

  return { loaded: tasks !== null, mine };
}

type MyWork = ReturnType<typeof useMyWork>;

/* ── Command deck ────────────────────────────────────────────────── */

function CommandDeck({ name, work, appCount }: { name: string; work: MyWork | null; appCount: number }) {
  const { t, lang } = useI18n();
  const { unread } = useWorkspace();
  const now = useClock();
  const greeting = now.getHours() < 12 ? t('launcher.goodMorning') : t('launcher.goodEvening');
  const firstName = name.split(/\s+/)[0] ?? '';
  const locale = lang === 'en' ? 'en-GB' : 'ar-EG';

  const today = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(now);

  const mine = work?.mine;
  const metrics: MetricProps[] = work
    ? [
        { label: t('launcher.statOpen'), value: mine?.open.length ?? 0, icon: ListChecks, tone: '42 167 240', to: '/tasks' },
        {
          label: t('launcher.statOverdue'),
          value: mine?.overdue ?? 0,
          icon: CircleAlert,
          tone: mine?.overdue ? '248 113 113' : '148 163 184',
          to: '/tasks',
        },
        mine?.toReview === null || mine?.toReview === undefined
          ? { label: t('launcher.statDoneWeek'), value: mine?.doneThisWeek ?? 0, icon: Trophy, tone: '52 211 153', to: '/tasks' }
          : { label: t('launcher.statReview'), value: mine.toReview, icon: Eye, tone: '251 191 36', to: '/tasks' },
        { label: t('launcher.statUnread'), value: unread, icon: BellDot, tone: '167 139 250' },
      ]
    : [
        { label: t('shell.apps'), value: appCount, icon: LayoutGrid, tone: '42 167 240' },
        { label: t('launcher.statUnread'), value: unread, icon: BellDot, tone: '167 139 250' },
      ];

  return (
    <section className="lx-band">
      <div className="lx-band-grid" aria-hidden="true" />
      <div className="lx-noise" aria-hidden="true" />
      <span className="lx-orb" aria-hidden="true" style={{ width: 520, height: 520, background: '#1D6FB8', top: -240, insetInlineEnd: -140 }} />
      <span
        className="lx-orb"
        aria-hidden="true"
        style={{ width: 380, height: 380, background: '#7C3AED', top: 20, insetInlineStart: -160, opacity: 0.32, animationDelay: '-8s' }}
      />
      <span
        className="lx-orb"
        aria-hidden="true"
        style={{ width: 280, height: 280, background: '#F5821F', bottom: -190, left: '42%', opacity: 0.22, animationDelay: '-14s' }}
      />

      <div className="mx-auto w-full max-w-[1600px] px-4 pb-28 pt-7 sm:px-6 sm:pb-36 sm:pt-11">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <motion.div
            className="min-w-0"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-1.5 font-display text-[11.5px] font-medium text-white/75 ring-1 ring-white/10">
              <span className="lx-live-dot" aria-hidden="true" />
              {t('launcher.kicker')}
              <span className="text-white/30">·</span>
              <Clock3 size={12} className="text-white/50" />
              <span className="tabular-nums">{time}</span>
            </span>
            <h1 className="mt-4 font-display text-[29px] font-semibold leading-[1.2] tracking-tight sm:text-[42px]">
              {greeting}
              {firstName && (
                <>
                  {lang === 'en' ? ', ' : '، '}
                  <span className="bg-gradient-to-r from-sky-300 via-white to-amber-200 bg-clip-text text-transparent">
                    {firstName}
                  </span>
                </>
              )}
            </h1>
            <p className="mt-2 text-[14px] text-white/55">{today}</p>
          </motion.div>

          <div
            className={cx(
              'grid min-w-0 gap-2.5 sm:gap-3 lg:w-[min(46rem,58%)] lg:shrink-0',
              metrics.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 lg:w-[min(24rem,40%)]'
            )}
          >
            {metrics.map((metric, index) => (
              <motion.div
                key={metric.label}
                className="min-w-0"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.12 + index * 0.07, ease: EASE }}
              >
                <Metric {...metric} />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

interface MetricProps {
  label: string;
  value: number;
  icon: LucideIcon;
  /** An "r g b" triple, so the edge and glow can take it at any alpha. */
  tone: string;
  to?: string;
}

function Metric({ label, value, icon: Icon, tone, to }: MetricProps) {
  const shown = useCountUp(value);
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-white/60">{label}</span>
        <Icon size={16} style={{ color: `rgb(${tone})` }} className="shrink-0" />
      </span>
      <span className="font-display text-[30px] font-semibold leading-none tabular-nums sm:text-[34px]">{shown}</span>
    </>
  );
  const style = { '--lx-tone': tone } as CSSProperties;
  return to ? (
    <Link to={to} className="lx-metric h-full" style={style}>
      {body}
    </Link>
  ) : (
    <div className="lx-metric h-full" style={style}>
      {body}
    </div>
  );
}

/** Ticks the minute over, so the clock in the kicker never goes stale. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Rolls a figure up to its new value — skipped for reduced motion or a hidden tab. */
function useCountUp(target: number, duration = 750) {
  const [value, setValue] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const start = from.current;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || document.hidden || start === target) {
      from.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const tick = (at: number) => {
      const progress = Math.min(1, (at - began) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      from.current = Math.round(start + (target - start) * eased);
      setValue(from.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

/* ── Apps ────────────────────────────────────────────────────────── */

const GROUPS = ['workspace', 'operations', 'admin'] as const;
type Group = (typeof GROUPS)[number];

/** Growth and people apps are business-unit dashboards too; they share a shelf. */
const groupOf = (app: WorkspaceApp): Group =>
  app.group === 'workspace' ? 'workspace' : app.group === 'admin' ? 'admin' : 'operations';

function AppDeck({ apps, onOpen }: { apps: WorkspaceApp[]; onOpen: (app: WorkspaceApp) => void }) {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<Group | 'all'>('all');
  const [query, setQuery] = useState('');

  const present = GROUPS.filter((group) => apps.some((app) => groupOf(app) === group));
  const needle = query.trim().toLowerCase();
  const visible = apps.filter(
    (app) =>
      (filter === 'all' || groupOf(app) === filter) &&
      (!needle || `${app.nameAr} ${app.nameEn ?? ''}`.toLowerCase().includes(needle))
  );
  const sections: Array<{ group: Group | null; apps: WorkspaceApp[] }> =
    filter === 'all' && !needle && present.length > 1
      ? present.map((group) => ({ group, apps: visible.filter((app) => groupOf(app) === group) }))
      : [{ group: null, apps: visible }];

  let index = 0;

  return (
    <motion.section
      className="lx-sheet"
      aria-label={t('shell.apps')}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
    >
      <div className="mb-4 flex flex-col gap-3 px-1 sm:mb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-[19px] font-semibold text-navy sm:text-[21px]">{t('launcher.appsTitle')}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">{t('launcher.appsSubtitle', { n: apps.length })}</p>
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          {present.length > 1 && (
            <div
              role="group"
              aria-label={t('shell.allApps')}
              className="no-scrollbar flex min-w-0 overflow-x-auto rounded-2xl bg-slate-100/90 p-1 ring-1 ring-slate-200/70"
            >
              {(['all', ...present] as const).map((group) => (
                <button
                  key={group}
                  type="button"
                  aria-pressed={filter === group}
                  onClick={() => setFilter(group)}
                  className="lx-seg"
                >
                  {filter === group && (
                    <motion.span
                      layoutId="lx-seg-pill"
                      className="absolute inset-0 rounded-xl bg-navy shadow-[0_8px_18px_-10px_rgb(11_37_69/0.9)]"
                      transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                    />
                  )}
                  <span className="relative whitespace-nowrap">
                    {group === 'all' ? t('launcher.groupAll') : t(`launcher.group.${group}` as 'launcher.group.admin')}
                  </span>
                </button>
              ))}
            </div>
          )}

          <label className="relative block sm:w-56">
            <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('launcher.filterApps')}
              aria-label={t('launcher.filterApps')}
              className="h-11 w-full rounded-2xl border border-slate-200/80 bg-white ps-9 pe-3 text-[13px] text-ink placeholder:text-ink-faint transition-shadow focus:border-brand-300 focus:outline-none focus:ring-4 focus:ring-brand-100"
            />
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="px-2 py-10 text-center text-[13px] text-ink-faint">{t('launcher.noAppMatch')}</p>
      ) : (
        <div className="space-y-6 sm:space-y-7">
          {sections.map(({ group, apps: shelf }) =>
            shelf.length === 0 ? null : (
              <div key={group ?? 'all'}>
                {group && (
                  <div className="mb-3 flex items-center gap-3 px-1">
                    <span className="font-display text-[12.5px] font-medium text-ink-muted">
                      {t(`launcher.group.${group}` as 'launcher.group.admin')}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-display text-[10.5px] font-medium tabular-nums text-ink-faint">
                      {shelf.length}
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-l from-transparent via-slate-200 to-slate-200 rtl:bg-gradient-to-r" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
                  {shelf.map((app) => (
                    <AppCard key={app.id} app={app} index={index++} lang={lang} onOpen={onOpen} />
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </motion.section>
  );
}

function AppCard({
  app,
  index,
  lang,
  onOpen,
}: {
  app: WorkspaceApp;
  index: number;
  lang: 'ar' | 'en';
  onOpen: (app: WorkspaceApp) => void;
}) {
  const { t, dir } = useI18n();
  const { taskCounts } = useWorkspace();
  // Only the built-in Tasks tile has a number the hub actually knows. The other
  // apps own their own data, so guessing a badge for them would be a lie.
  const badge = app.id === 'tasks' ? taskCounts.mine + taskCounts.awaitingMyReview : 0;
  const external = app.kind === 'external';
  const GoIcon = external ? ArrowUpRight : dir === 'rtl' ? MoveLeft : MoveRight;
  const name = lang === 'en' && app.nameEn ? app.nameEn : app.nameAr;
  // Descriptions are only written in Arabic; English readers get the name alone.
  const description = lang === 'ar' ? app.descAr : undefined;

  const style = {
    '--lx-c': app.color,
    '--lx-glow': hexWithAlpha(app.color, 0.13),
    '--lx-line': hexWithAlpha(app.color, 0.38),
    '--lx-shadow': hexWithAlpha(app.color, 0.6),
  } as CSSProperties;

  const track = (event: PointerEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${event.clientX - box.left}px`);
    event.currentTarget.style.setProperty('--my', `${event.clientY - box.top}px`);
  };

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(app)}
      onPointerMove={track}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.18 + Math.min(index * 0.035, 0.45), ease: EASE }}
      whileTap={{ scale: 0.98 }}
      className="lx-card p-3.5 sm:p-4"
      style={style}
      title={external ? t('launcher.externalApp') : undefined}
    >
      <span className="relative flex items-start justify-between gap-2">
        <span className="relative">
          <ModuleIcon name={app.icon} color={app.color} size={46} variant="solid" className="lx-card-icon" />
          {badge > 0 && <CountBadge value={badge} urgent={taskCounts.overdue > 0} />}
        </span>
        <span className="lx-card-go" aria-hidden="true">
          <GoIcon size={15} />
        </span>
      </span>

      <span className="relative mt-3.5 block min-w-0 sm:mt-4">
        <span className="line-clamp-1 font-display text-[14px] font-semibold leading-snug text-navy sm:text-[15px]">
          {name}
        </span>
        {description && (
          <span className="mt-1 hidden text-[12.5px] leading-relaxed text-ink-muted sm:line-clamp-2">{description}</span>
        )}
      </span>

      <span className="relative mt-auto flex items-center gap-1.5 pt-3 text-[11px] font-medium text-ink-faint">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: app.color }} />
        {external ? t('launcher.external') : t('launcher.internal')}
      </span>
    </motion.button>
  );
}

function TileSkeletons() {
  return (
    <div>
      <div className="mb-5 space-y-2 px-1">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-3 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-4 rounded-[20px] border border-slate-100 bg-white p-4">
            <div className="skeleton h-[46px] w-[46px] rounded-2xl" />
            <div className="skeleton h-3.5 w-24" />
            <div className="skeleton hidden h-3 w-full sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── My work ─────────────────────────────────────────────────────── */

function MyWork({ work }: { work: MyWork }) {
  const { t, lang, dir } = useI18n();
  const { appById } = useWorkspace();
  const { loaded, mine } = work;

  if (!loaded) return <div className="skeleton mt-5 h-48 rounded-[28px] sm:mt-6" />;

  const ArrowIcon = dir === 'rtl' ? MoveLeft : MoveRight;

  return (
    <motion.section
      className="lx-sheet mt-5 overflow-hidden !p-0 sm:mt-6"
      aria-label={t('launcher.myWork')}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.25, ease: EASE }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-navy text-white shadow-[0_10px_20px_-10px_rgb(29_111_184/0.9)]">
            <ListChecks size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[17px] font-semibold text-navy">{t('launcher.myWork')}</h2>
            {mine && mine.doneThisWeek > 0 && (
              <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600">
                <Trophy size={12} />
                {t('launcher.doneWeekChip', { n: mine.doneThisWeek })}
              </span>
            )}
          </div>
        </div>
        <Link
          to="/tasks"
          className="group inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 font-display text-[12.5px] font-medium text-navy transition-colors hover:bg-navy hover:text-white"
        >
          {t('launcher.wholeBoard')}
          <ArrowIcon size={14} className="transition-transform group-hover:ltr:translate-x-0.5 group-hover:rtl:-translate-x-0.5" />
        </Link>
      </div>

      {mine && mine.next.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {mine.next.map((task) => {
            const app = appById(task.appId);
            const departmentId = task.department ?? DEFAULT_DEPARTMENT;
            const department = getDepartment(departmentId);
            return (
              <li key={task.id}>
                <Link
                  to={`/tasks?task=${task.id}`}
                  className="group relative flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50/80 sm:px-5"
                >
                  <span
                    className="h-9 w-1 shrink-0 rounded-full transition-transform group-hover:scale-y-110"
                    style={{ background: department.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">{task.title}</span>
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
                  <TaskTiming task={task} variant="chip" />
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
    </motion.section>
  );
}
