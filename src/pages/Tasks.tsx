import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  CalendarClock,
  Download,
  GripVertical,
  Inbox,
  LayoutGrid,
  ListPlus,
  Paperclip,
  Plus,
  Search,
  Table2,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { PERMISSIONS } from '@shared/permissions';
import {
  DEFAULT_DEPARTMENT,
  DEPARTMENTS,
  STAGE_TYPES,
  STAGE_TYPE_LABELS,
  getDepartment,
  getJobRole,
  getStages,
  getSubteam,
  subteamLabel,
  stageType,
} from '@shared/departments';
import { assigneesOf, isAssignee, isReviewer, stageWriteVerdict } from '@shared/workflow';
import { TaskDialog, TaskMeta } from '../components/TaskDialog';
import { ScoreChip, StateBadge, returnedLabel, stateOf } from '../components/TaskWorkflow';
import { ModuleIcon } from '../components/ModuleIcon';
import { Avatar, EmptyState, Segmented, useToast } from '../components/ui';
import {
  DUE_CHIP_CLASS,
  DUE_TONE_CLASS,
  PRIORITY_META,
  cx,
  dueLabel,
  hexWithAlpha,
  scoreTextTone,
  timeAgo,
} from '../lib/utils';
import type {
  PerformanceMetrics,
  PerformanceOverview,
  PerformancePerson,
  DirectoryUser,
  StageType,
  Task,
} from '../lib/types';

interface Column {
  id: string;
  label: string;
  /** Which tasks belong here, given the current department filter. */
  match: (task: Task) => boolean;
}

/** Where a lifted card would land if it were dropped right now. */
interface DropTarget {
  columnId: string;
  /** Insert position among the column's cards, the dragged one excluded. */
  index: number;
}

interface DragState {
  taskId: string;
  pointerId: number;
  /** The card's own size, so the ghost and the gap match what was lifted. */
  width: number;
  height: number;
  /** Where inside the card the pointer grabbed it. */
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  target: DropTarget | null;
}

/** Pixels of pointer travel before a mouse press turns into a drag, not a click. */
const DRAG_THRESHOLD = 6;
/** How close to the viewport edge a drag has to get before the page scrolls. */
const EDGE = 90;
/** Keep an already-open board current when somebody else assigns or edits work. */
const TASK_POLL_MS = 20_000;

export function Tasks() {
  const { user, can } = useAuth();
  const { t, lang, dir } = useI18n();
  const { directory, reloadTaskCounts } = useWorkspace();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [view, setView] = useState<'table' | 'board' | 'review' | 'overview'>('table');
  const [overview, setOverview] = useState<PerformanceOverview | null>(null);
  // '' = every department, which falls back to the canonical progress columns.
  const [department, setDepartment] = useState<string>(user?.department ?? DEFAULT_DEPARTMENT);
  const [assignee, setAssignee] = useState('');
  const [query, setQuery] = useState('');
  const [dialogTask, setDialogTask] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogColumn, setDialogColumn] = useState<string | null>(null);
  const [mobileColumn, setMobileColumn] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);

  const columnRefs = useRef<Record<string, HTMLElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  /** A mouse press that has not travelled far enough to become a drag yet. */
  const armed = useRef<{ taskId: string; pointerId: number; x: number; y: number } | null>(null);
  /** Live pointer position, so edge-scrolling can read it without re-rendering. */
  const pointerY = useRef(0);

  const seesAll = can(PERMISSIONS.TASKS_VIEW_ALL);
  const seesTeam = can(PERMISSIONS.TASKS_VIEW_TEAM) || seesAll;
  /** Managers and admins — the people a submitted task is actually waiting on. */
  const reviews = isReviewer(user);
  const availableDepartments = seesAll
    ? DEPARTMENTS
    : DEPARTMENTS.filter((item) => item.id === (user?.department ?? DEFAULT_DEPARTMENT));
  const filterDirectory = department
    ? directory.filter((person) => person.department === department)
    : directory;

  const load = useCallback(async () => {
    const data = await api.get<{ tasks: Task[] }>('/tasks');
    setTasks(data.tasks);
    // Every mutation on this page ends here, so this is the one place that
    // keeps the nav badge from lagging a minute behind the board.
    reloadTaskCounts().catch(() => {});
    return data.tasks;
  }, [reloadTaskCounts]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active || document.visibilityState !== 'visible') return;
      load().catch(() => {
        // Preserve the last good board during a transient polling failure. Only
        // the first load needs an empty fallback so the skeleton can finish.
        setTasks((current) => current ?? []);
      });
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
  }, [load]);

  useEffect(() => {
    if (seesTeam) setScope('all');
  }, [seesTeam]);

  useEffect(() => {
    if (view !== 'overview') return;
    setOverview(null);
    const queryString = department ? `?department=${encodeURIComponent(department)}` : '';
    api
      .get<PerformanceOverview>(`/tasks/overview${queryString}`)
      .then(setOverview)
      .catch(() => setOverview({
        scope: 'self',
        summary: emptyMetrics(),
        people: [],
        statuses: [],
      }));
  }, [view, department]);

  // A ?task=… link from a notification or search fetches that row directly.
  // The board list may predate an assignment, so searching only the cached list
  // makes the notification appear broken and then discards its task id.
  const deepLink = params.get('task');
  useEffect(() => {
    if (!deepLink) return;
    let active = true;
    api
      .get<{ task: Task }>(`/tasks/${encodeURIComponent(deepLink)}`)
      .then(({ task: fresh }) => {
        if (!active) return;
        setTasks((list) => {
          const current = list ?? [];
          return current.some((task) => task.id === fresh.id)
            ? current.map((task) => (task.id === fresh.id ? fresh : task))
            : [fresh, ...current];
        });
        setDialogTask(fresh);
        setDialogOpen(true);
      })
      .catch((err) => {
        if (active) push(errorMessage(err, lang), 'bad');
      })
      .finally(() => {
        if (!active) return;
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.delete('task');
          return next;
        }, { replace: true });
      });
    return () => {
      active = false;
    };
  }, [deepLink, lang, push, setParams]);

  /**
   * Columns follow Odoo's model: pick a department and the board becomes that
   * department's own stages. With no department selected there is no shared
   * column set to show, so it falls back to the canonical progress spine every
   * stage maps onto.
   */
  const columns = useMemo<Column[]>(() => {
    if (department) {
      return getStages(department).map((stage) => ({
        id: stage.id,
        label: lang === 'en' ? stage.en : stage.ar,
        match: (task) => task.stage === stage.id,
      }));
    }
    return (STAGE_TYPES as StageType[]).map((type) => ({
      id: type,
      label: STAGE_TYPE_LABELS[type][lang],
      match: (task: Task) => stageType(task.department ?? DEFAULT_DEPARTMENT, task.stage) === type,
    }));
  }, [department, lang]);

  useEffect(() => {
    setMobileColumn(0);
  }, [department]);

  const filtered = useMemo(() => {
    if (!tasks) return [];
    const term = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (department && (task.department ?? DEFAULT_DEPARTMENT) !== department) return false;
      if (scope === 'mine' && !isAssignee(user, task) && task.createdBy !== user?.id) return false;
      if (assignee && !assigneesOf(task).includes(assignee)) return false;
      if (term) {
        const haystack = [
          task.reference,
          task.title,
          task.description,
          task.objective,
          task.definitionOfDone,
          task.labels.join(' '),
        ].join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [tasks, scope, assignee, query, user, department]);

  const byColumn = useMemo(() => {
    const groups: Record<string, Task[]> = {};
    for (const column of columns) groups[column.id] = [];
    for (const task of filtered) {
      const column = columns.find((c) => c.match(task));
      if (column) groups[column.id].push(task);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort(
        (a, b) => a.order - b.order || PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank
      );
    }
    return groups;
  }, [filtered, columns]);

  const openNew = (columnId: string | null) => {
    setDialogTask(null);
    setDialogColumn(columnId);
    setDialogOpen(true);
  };

  const openTask = useCallback((task: Task) => {
    setDialogTask(task);
    setDialogOpen(true);
  }, []);

  /** Everything handed in and still waiting, oldest first — review before new work. */
  const reviewQueue = useMemo(() => {
    if (!tasks) return [];
    return tasks
      .filter((task) => stateOf(task) === 'submitted')
      .filter((task) => !department || (task.department ?? DEFAULT_DEPARTMENT) === department)
      .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  }, [tasks, department]);

  /**
   * Who may pick a card up at all. For the person doing the work a stage is the
   * result of an action — start it, hand it in — so dragging is a reviewer's
   * tool. Letting an employee drag would only ever end in a refusal from the
   * API, and a card that springs back is a worse answer than one that never
   * lifted.
   */
  const canMove = useCallback((_task: Task) => isReviewer(user), [user]);

  /**
   * Move optimistically so the card lands where it was dropped immediately,
   * then reconcile with the server. On failure the board reloads rather than
   * trying to unwind the local edit.
   *
   * A drop onto one of the two gate columns is not a move. Review means the
   * work is being handed in, and done means it is being approved — both carry
   * requirements a drag cannot express, so the card stays put and the task
   * opens on the gate that is asking for something.
   */
  const moveTask = useCallback(
    async (taskId: string, columnId: string, index: number) => {
      const task = tasks?.find((t) => t.id === taskId);
      if (!task) return;

      // Dropping into a canonical column (no department selected) means "make it
      // this much done" — resolved to the matching stage in the task's own
      // department, since a `review` column has a different id in each.
      const taskDepartment = task.department ?? DEFAULT_DEPARTMENT;
      const targetStage = department
        ? columnId
        : (getStages(taskDepartment).find((s) => s.type === (columnId as StageType))?.id ??
          task.stage);

      const column = byColumn[columnId] ?? [];
      const here = column.findIndex((t) => t.id === taskId);
      // Same column, same slot: the card was picked up and put back down.
      if (targetStage === task.stage && here === index) return;

      const verdict = stageWriteVerdict(user, task, taskDepartment, targetStage);
      if (verdict === 'forbidden') {
        push(t('flow.managerOnly'), 'bad');
        return;
      }
      // Every other non-'ok' verdict names an action with something to collect —
      // an answer to the assignment, a deliverable, a score — so the task opens
      // on whichever gate is asking rather than the card moving on its own.
      if (verdict !== 'ok') {
        openTask(task);
        return;
      }

      // Order is a sparse rank, so a drop only has to land between its new
      // neighbours — the rest of the column never has to be rewritten.
      const siblings = column.filter((t) => t.id !== taskId);
      const order = orderBetween(siblings[index - 1]?.order, siblings[index]?.order);

      setTasks((list) =>
        (list ?? []).map((t) => (t.id === taskId ? { ...t, stage: targetStage, order } : t))
      );

      try {
        await api.patch(`/tasks/${taskId}`, { stage: targetStage, order });
      } catch (err) {
        push(errorMessage(err, lang), 'bad');
        load().catch(() => {});
      }
    },
    [tasks, department, byColumn, push, lang, load, user, t, openTask]
  );

  /**
   * Which column the pointer is over, and how far down it — measured from the
   * live card rects so the gap opens exactly where the card will land. Columns
   * hidden on phones measure as zero-sized and simply never match.
   */
  const locate = useCallback(
    (taskId: string, x: number, y: number): DropTarget | null => {
      for (const column of columns) {
        const box = columnRefs.current[column.id]?.getBoundingClientRect();
        if (!box || box.width === 0) continue;
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;

        const siblings = (byColumn[column.id] ?? []).filter((t) => t.id !== taskId);
        let index = siblings.length;
        for (let i = 0; i < siblings.length; i += 1) {
          const rect = cardRefs.current[siblings[i].id]?.getBoundingClientRect();
          if (rect && y < rect.top + rect.height / 2) {
            index = i;
            break;
          }
        }
        return { columnId: column.id, index };
      }
      return null;
    },
    [columns, byColumn]
  );

  const liftCard = useCallback((taskId: string, pointerId: number, x: number, y: number) => {
    const rect = cardRefs.current[taskId]?.getBoundingClientRect();
    if (!rect) return;
    setDrag({
      taskId,
      pointerId,
      width: rect.width,
      height: rect.height,
      offsetX: x - rect.left,
      offsetY: y - rect.top,
      x,
      y,
      target: null,
    });
  }, []);

  /**
   * A mouse can start a drag anywhere on the card because it never scrolls by
   * dragging. Touch has to come from the grip, otherwise lifting a card and
   * scrolling the column would be the same gesture.
   */
  const armDrag = useCallback(
    (task: Task, event: React.PointerEvent, fromHandle: boolean) => {
      if (!canMove(task) || drag) return;
      if (event.pointerType === 'mouse') {
        if (event.button !== 0) return;
        if (fromHandle) {
          event.preventDefault();
          liftCard(task.id, event.pointerId, event.clientX, event.clientY);
        } else {
          armed.current = {
            taskId: task.id,
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
        }
        return;
      }
      if (!fromHandle) return;
      liftCard(task.id, event.pointerId, event.clientX, event.clientY);
    },
    [canMove, drag, liftCard]
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (drag) {
        if (event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        pointerY.current = event.clientY;
        const target = locate(drag.taskId, event.clientX, event.clientY);
        setDrag((current) =>
          current ? { ...current, x: event.clientX, y: event.clientY, target } : current
        );
        return;
      }
      const pending = armed.current;
      if (!pending || event.pointerId !== pending.pointerId) return;
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < DRAG_THRESHOLD) return;
      armed.current = null;
      liftCard(pending.taskId, pending.pointerId, event.clientX, event.clientY);
    };

    const end = (event: PointerEvent) => {
      armed.current = null;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.target) moveTask(drag.taskId, drag.target.columnId, drag.target.index);
      setDrag(null);
    };

    const cancel = () => {
      armed.current = null;
      setDrag(null);
    };

    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }, [drag, locate, liftCard, moveTask]);

  // Long boards run past the fold, so hold the pointer near an edge to scroll.
  useEffect(() => {
    if (!drag) return;
    pointerY.current = drag.y;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    const timer = window.setInterval(() => {
      if (pointerY.current < EDGE) window.scrollBy(0, -14);
      else if (pointerY.current > window.innerHeight - EDGE) window.scrollBy(0, 14);
    }, 16);
    return () => {
      window.clearInterval(timer);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    // Only the identity of the lifted card matters — the position lives in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.taskId]);

  /**
   * Keyboard equivalent of the drag: Alt with the arrows walks a focused card
   * through the board, which is the only way to move one without a pointer.
   */
  const nudge = useCallback(
    (task: Task, event: React.KeyboardEvent) => {
      if (!event.altKey || !canMove(task)) return;
      const columnIndex = columns.findIndex((column) => column.match(task));
      if (columnIndex < 0) return;
      const column = byColumn[columns[columnIndex].id] ?? [];
      const here = column.findIndex((t) => t.id === task.id);

      // Arrows are visual, so the next column sits to the left in Arabic.
      const sideways = dir === 'rtl' ? { ArrowLeft: 1, ArrowRight: -1 } : { ArrowLeft: -1, ArrowRight: 1 };
      const step = sideways[event.key as 'ArrowLeft' | 'ArrowRight'];
      if (step) {
        const next = columns[columnIndex + step];
        if (!next) return;
        event.preventDefault();
        setMobileColumn(columnIndex + step);
        moveTask(task.id, next.id, (byColumn[next.id] ?? []).length);
        return;
      }

      if (event.key === 'ArrowUp' && here > 0) {
        event.preventDefault();
        moveTask(task.id, columns[columnIndex].id, here - 1);
      } else if (event.key === 'ArrowDown' && here < column.length - 1) {
        event.preventDefault();
        moveTask(task.id, columns[columnIndex].id, here + 1);
      }
    },
    [canMove, columns, byColumn, moveTask, dir]
  );

  const draggedTask = drag ? tasks?.find((t) => t.id === drag.taskId) ?? null : null;

  const onSaved = (saved: Task) => {
    setTasks((list) => {
      const current = list ?? [];
      return current.some((t) => t.id === saved.id)
        ? current.map((t) => (t.id === saved.id ? saved : t))
        : [saved, ...current];
    });
  };

  const onDeleted = (id: string) => setTasks((list) => (list ?? []).filter((t) => t.id !== id));

  if (!can(PERMISSIONS.TASKS_VIEW)) {
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        <EmptyState title={t('tasks.noPermission')} body={t('tasks.noPermissionBody')} />
      </div>
    );
  }

  const accent = department ? getDepartment(department).color : '#1D6FB8';

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold text-ink sm:text-[24px]">{t('tasks.title')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {seesTeam ? t('tasks.teamBoard') : t('tasks.myBoard')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(PERMISSIONS.TASKS_EXPORT) && (
            <a
              href={`/api/tasks/export.csv?lang=${lang}${department ? `&department=${encodeURIComponent(department)}` : ''}`}
              className="btn-ghost btn-sm gap-1.5"
              download
            >
              <Download size={15} />
              {t('tasks.export')}
            </a>
          )}
          {can(PERMISSIONS.TASKS_CREATE) && (
            <button type="button" onClick={() => openNew(null)} className="btn-primary btn-sm gap-1.5">
              <Plus size={16} />
              {t('tasks.new')}
            </button>
          )}
        </div>
      </header>

      <Segmented
        className="mb-4 w-fit"
        value={view}
        onChange={setView}
        options={[
          { value: 'table', label: t('tasks.table'), icon: <Table2 size={14} /> },
          { value: 'board', label: t('tasks.board'), icon: <LayoutGrid size={14} /> },
          // Only a reviewer has a queue; for everyone else the tab would be empty
          // by definition, because nobody is waiting on them.
          ...(reviews
            ? [
                {
                  value: 'review' as const,
                  label: t('flow.reviewQueue'),
                  icon: <Inbox size={14} />,
                  count: reviewQueue.length,
                },
              ]
            : []),
          { value: 'overview', label: t('tasks.overview'), icon: <BarChart3 size={14} /> },
        ]}
      />

      {/* Department picker — the control that reshapes the board. */}
      <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {seesAll && (
          <DepartmentChip
            active={department === ''}
            label={t('tasks.allDepartments')}
            color="#64748B"
            onClick={() => setDepartment('')}
          />
        )}
        {availableDepartments.map((d) => (
          <DepartmentChip
            key={d.id}
            active={department === d.id}
            label={lang === 'en' ? d.en : d.ar}
            color={d.color}
            icon={d.icon}
            onClick={() => setDepartment(d.id)}
          />
        ))}
      </div>

      {(view === 'table' || view === 'board') && <div className="mb-4 flex flex-wrap items-center gap-2">
        {seesTeam && (
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: t('common.all') },
              { value: 'mine', label: t('tasks.mine') },
            ]}
          />
        )}

        <label className="relative flex min-w-[10rem] flex-1 items-center sm:max-w-xs">
          <Search size={15} className="absolute start-3 text-ink-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('tasks.searchPlaceholder')}
            className="field ps-9"
          />
        </label>

        {seesTeam && filterDirectory.length > 1 && (
          <select
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            className="field w-auto min-w-[9rem]"
            aria-label={t('tasks.assignee')}
          >
            <option value="">{t('tasks.allPeople')}</option>
            {filterDirectory.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        )}
      </div>}

      {/* Phone: one column at a time — five side by side would be 60px wide. */}
      {view === 'board' && <div className="mb-3 md:hidden">
        <Segmented
          value={String(mobileColumn)}
          onChange={(value) => setMobileColumn(Number(value))}
          options={columns.map((column, index) => ({
            value: String(index),
            label: column.label,
            count: byColumn[column.id]?.length ?? 0,
          }))}
        />
      </div>}

      {view === 'overview' ? (
        <PerformancePanel data={overview} />
      ) : tasks === null ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-56 rounded-2xl" />
          ))}
        </div>
      ) : view === 'review' ? (
        <ReviewQueue tasks={reviewQueue} onOpen={openTask} />
      ) : view === 'table' ? (
        <TaskTable tasks={filtered} onOpen={openTask} />
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {columns.map((column, index) => {
            const cards = (byColumn[column.id] ?? []).filter((task) => task.id !== drag?.taskId);
            const gapAt = drag?.target?.columnId === column.id ? drag.target.index : null;
            return (
            <section
              key={column.id}
              ref={(node) => {
                columnRefs.current[column.id] = node;
              }}
              className={cx(
                'flex-col rounded-2xl border p-2.5 transition-colors',
                gapAt !== null ? 'border-brand-400 bg-brand-50/70' : 'border-surface-line bg-white/60',
                mobileColumn === index ? 'col-span-full flex md:col-span-1' : 'hidden md:flex'
              )}
            >
              <header className="mb-2 flex items-center justify-between gap-2 px-1">
                <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-ink">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
                  <span className="truncate">{column.label}</span>
                  <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 text-[11px] font-semibold text-ink-muted">
                    {byColumn[column.id]?.length ?? 0}
                  </span>
                </h2>
                {can(PERMISSIONS.TASKS_CREATE) &&
                  department &&
                  (stageType(department, column.id) === 'open' ||
                    stageType(department, column.id) === 'active') && (
                  <button
                    type="button"
                    onClick={() => openNew(column.id)}
                    className="btn-quiet !min-h-8 shrink-0 rounded-lg px-1.5"
                    aria-label={t('tasks.newIn', { stage: column.label })}
                  >
                    <Plus size={15} />
                  </button>
                )}
              </header>

              <div className="flex flex-col gap-2">
                {cards.map((task, position) => (
                  <Fragment key={task.id}>
                    {gapAt === position && <DropGap height={drag!.height} />}
                    <TaskCard
                      task={task}
                      movable={canMove(task)}
                      showDepartment={!department}
                      forReviewer={reviews}
                      cardRef={(node) => {
                        cardRefs.current[task.id] = node;
                      }}
                      onPointerDown={(event, fromHandle) => armDrag(task, event, fromHandle)}
                      onKeyDown={(event) => nudge(task, event)}
                      onOpen={() => openTask(task)}
                    />
                  </Fragment>
                ))}

                {gapAt === cards.length && <DropGap height={drag!.height} />}

                {cards.length === 0 && gapAt === null && (
                  <p className="rounded-xl border border-dashed border-surface-line px-3 py-6 text-center text-[12px] text-ink-faint">
                    {t('tasks.emptyColumn')}
                  </p>
                )}
              </div>
            </section>
            );
          })}
        </div>
      )}

      {/* The lifted card rides above the board so it can cross column edges. */}
      {drag && draggedTask && (
        <div
          className="pointer-events-none fixed z-50 opacity-95"
          style={{
            left: drag.x - drag.offsetX,
            top: drag.y - drag.offsetY,
            width: drag.width,
            transform: 'rotate(1.5deg) scale(1.02)',
          }}
        >
          <div className="shadow-2xl">
            <TaskCard task={draggedTask} movable showDepartment={!department} onOpen={() => {}} />
          </div>
        </div>
      )}

      {(view === 'table' || view === 'board') && tasks !== null && filtered.length === 0 && (
        <div className="card mt-4">
          <EmptyState
            icon={<ListPlus size={26} />}
            title={t('tasks.noMatch')}
            body={query ? t('tasks.noMatchSearch') : t('tasks.noMatchEmpty')}
            action={
              can(PERMISSIONS.TASKS_CREATE) ? (
                <button type="button" onClick={() => openNew(null)} className="btn-primary btn-sm mt-1">
                  <Plus size={15} />
                  {t('tasks.new')}
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      <TaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        task={dialogTask}
        defaultDepartment={department || user?.department || DEFAULT_DEPARTMENT}
        defaultStage={department ? dialogColumn : null}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </div>
  );
}

function TaskTable({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const { t, lang } = useI18n();
  const { userById } = useWorkspace();

  if (tasks.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-surface-line bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] table-fixed border-collapse text-start">
          <thead className="bg-navy text-white">
            <tr className="text-[11.5px] font-bold">
              {[
                t('tasks.taskDate'),
                t('tasks.team'),
                t('tasks.assignee'),
                t('tasks.titleField'),
                t('tasks.descField'),
                t('tasks.dueDate'),
                t('tasks.notes'),
                t('tasks.stage'),
                t('tasks.deliverables'),
                t('tasks.score'),
              ].map((label) => (
                <th key={label} className="whitespace-nowrap px-3 py-3 text-start">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-line">
            {tasks.map((task) => {
              const department = getDepartment(task.department ?? DEFAULT_DEPARTMENT);
              const owners: DirectoryUser[] = assigneesOf(task).flatMap((id: string) => {
                const person = userById(id);
                return person ? [person] : [];
              });
              const type = stageType(task.department ?? DEFAULT_DEPARTMENT, task.stage) as StageType;
              const due = dueLabel(task.dueDate, t, lang);
              const stage = getStages(task.department ?? DEFAULT_DEPARTMENT).find(
                (item) => item.id === task.stage
              );
              return (
                <tr key={task.id} className="group align-top transition-colors hover:bg-surface-sunken/70">
                  <td className="whitespace-nowrap px-3 py-3 text-[12px] text-ink-muted">
                    {formatTaskDate(task.taskDate ?? task.createdAt?.slice(0, 10), lang)}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-bold"
                      style={{ color: department.color }}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: department.color }} />
                      {lang === 'en' ? department.en : department.ar}
                    </span>
                    {task.subteam && (
                      <span className="mt-1 block whitespace-nowrap text-[10.5px] text-ink-faint">
                        {subteamLabel(task.department, task.subteam, lang)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[12px] text-ink">
                    {owners.length > 0 ? (
                      <span className="grid gap-1">
                        {owners.map((person: DirectoryUser) => (
                          <span
                            key={person.id}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <span
                              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white"
                              style={{ background: person.avatarColor }}
                            >
                              {person.name.slice(0, 1)}
                            </span>
                            {person.name}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-ink-faint">{t('tasks.unassigned')}</span>
                    )}
                  </td>
                  <td className="max-w-[220px] px-3 py-3">
                    <button
                      type="button"
                      onClick={() => onOpen(task)}
                      className="text-start text-[12.5px] font-bold leading-relaxed text-ink hover:text-brand-600 hover:underline"
                    >
                      {task.title}
                    </button>
                  </td>
                  <td className="max-w-[230px] px-3 py-3 text-[11.5px] leading-relaxed text-ink-muted">
                    <p className="line-clamp-3">{task.description || '—'}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span
                      className={cx(
                        'text-[11.5px] font-semibold',
                        due ? DUE_TONE_CLASS[due.tone] : 'text-ink-faint'
                      )}
                    >
                      {task.dueDate ? formatTaskDate(task.dueDate, lang) : '—'}
                    </span>
                  </td>
                  <td className="max-w-[210px] px-3 py-3 text-[11.5px] leading-relaxed text-ink-muted">
                    <p className="line-clamp-3">{task.notes || '—'}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className={cx('chip', statusTone(type))}>
                      {stage ? (lang === 'en' ? stage.en : stage.ar) : task.stage}
                    </span>
                    {task.reworkCount > 0 && (
                      <span className="mt-1 block whitespace-nowrap text-[10.5px] text-ink-faint">
                        {returnedLabel(task.reworkCount, t)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-center">
                    {task.attachmentCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-muted">
                        <Paperclip size={12} />
                        <span className="ltr tabular-nums">{task.attachmentCount}</span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {task.score === null || task.score === undefined ? (
                      <span className="text-[11px] text-ink-faint">—</span>
                    ) : (
                      <ScoreChip score={task.score} size="sm" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The manager's inbox.
 *
 * Everything handed in and still waiting, oldest first. Kanban practice is that
 * review takes priority over starting new work — if this queue grows, the whole
 * board stalls behind it — so it gets its own tab with a count on it rather than
 * being a column you have to notice.
 */
function ReviewQueue({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const { t, lang } = useI18n();
  const { userById } = useWorkspace();

  if (tasks.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<Inbox size={26} />}
          title={t('flow.reviewQueueEmpty')}
          body={t('flow.reviewQueueEmptyBody')}
        />
      </div>
    );
  }

  return (
    <section>
      <p className="mb-3 text-[12.5px] text-ink-muted">{t('flow.reviewQueueHint')}</p>
      <ul className="grid gap-2.5">
        {tasks.map((task) => {
          const owners: DirectoryUser[] = assigneesOf(task).flatMap((id: string) => {
            const person = userById(id);
            return person ? [person] : [];
          });
          const department = getDepartment(task.department ?? DEFAULT_DEPARTMENT);
          const due = dueLabel(task.dueDate, t, lang);
          return (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => onOpen(task)}
                className="flex w-full flex-wrap items-center gap-3 rounded-2xl border border-surface-line bg-white px-4 py-3.5 text-start shadow-sm transition-shadow hover:shadow-card"
                style={{ borderInlineStartWidth: 3, borderInlineStartColor: department.color }}
              >
                {owners[0] && (
                  <Avatar name={owners[0].name} color={owners[0].avatarColor} size={34} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold text-ink">{task.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-faint">
                    <span>
                      {owners.length === 0
                        ? t('tasks.unassigned')
                        : owners.map((person: DirectoryUser) => person.name).join('، ')}
                    </span>
                    <span style={{ color: department.color }}>
                      {lang === 'en' ? department.en : department.ar}
                    </span>
                    <span>{t('flow.waitingSince', { when: timeAgo(task.submittedAt, t) })}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {task.attachmentCount > 0 && (
                    <span className="chip bg-surface-sunken text-ink-muted">
                      <Paperclip size={12} />
                      <span className="ltr tabular-nums">{task.attachmentCount}</span>
                    </span>
                  )}
                  {task.reworkCount > 0 && (
                    <span className="chip bg-status-warnBg text-accent-600">
                      {returnedLabel(task.reworkCount, t)}
                    </span>
                  )}
                  {due && <span className={cx('chip', DUE_CHIP_CLASS[due.tone])}>{due.text}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PerformancePanel({ data }: { data: PerformanceOverview | null }) {
  const { t, lang } = useI18n();
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="skeleton h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  const summary = data.summary;
  // The row reads as the lifecycle does: how much work, how much got through,
  // how cleanly, how punctually, how well — and what is stuck.
  const cards = [
    { label: t('performance.total'), value: summary.total, tone: 'text-ink', hint: undefined },
    { label: t('performance.completed'), value: summary.completed, tone: 'text-status-ok', hint: undefined },
    {
      label: t('performance.firstPass'),
      value: `${summary.firstPassRate}%`,
      tone: 'text-brand-600',
      hint: t('performance.firstPassHint'),
    },
    { label: t('performance.onTime'), value: `${summary.onTimeRate}%`, tone: 'text-teal-600', hint: undefined },
    {
      label: t('performance.averageScore'),
      value: summary.averageScore ?? '—',
      tone: summary.averageScore === null ? 'text-ink-faint' : scoreTextTone(summary.averageScore),
      hint: undefined,
    },
    {
      label: t('performance.awaitingReview'),
      value: summary.awaitingReview,
      tone: summary.awaitingReview ? 'text-accent-600' : 'text-ink-faint',
      hint: undefined,
    },
    { label: t('performance.overdue'), value: summary.overdue, tone: 'text-status-bad', hint: undefined },
  ];
  const totalStatuses = data.statuses.reduce((sum, status) => sum + status.count, 0);

  return (
    <section>
      <div className="mb-4 rounded-2xl border border-surface-line bg-navy px-5 py-4 text-white shadow-sm">
        <h2 className="text-[17px] font-extrabold">{t('performance.title')}</h2>
        <p className="mt-1 text-[12.5px] text-white/70">
          {data.scope === 'self' ? t('performance.selfHint') : t('performance.teamHint')}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {cards.map((card) => (
          <article
            key={card.label}
            className="rounded-2xl border border-surface-line bg-white p-4 shadow-sm"
            title={card.hint}
          >
            <p className="text-[11.5px] font-semibold text-ink-faint">{card.label}</p>
            <p className={cx('mt-2 text-[25px] font-black tabular-nums', card.tone)}>{card.value}</p>
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)]">
        <div className="overflow-hidden rounded-2xl border border-surface-line bg-white shadow-sm">
          <div className="border-b border-surface-line px-4 py-3">
            <h3 className="text-[13px] font-extrabold text-ink">
              {data.scope === 'self' ? t('performance.title') : t('tasks.allPeople')}
            </h3>
          </div>
          {data.people.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12.5px] text-ink-faint">{t('performance.noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-start">
                <thead className="bg-surface-sunken text-[11px] font-bold text-ink-muted">
                  <tr>
                    <th className="px-4 py-2.5 text-start">{t('performance.person')}</th>
                    <th className="px-3 py-2.5 text-center">{t('performance.total')}</th>
                    <th className="px-3 py-2.5 text-center">{t('performance.completed')}</th>
                    <th className="px-3 py-2.5 text-center">{t('performance.awaitingReview')}</th>
                    <th className="px-3 py-2.5 text-center">{t('performance.returned')}</th>
                    <th className="px-3 py-2.5 text-center">{t('performance.overdue')}</th>
                    <th className="px-3 py-2.5 text-center">{t('performance.onTime')}</th>
                    <th className="px-3 py-2.5 text-center">{t('performance.averageScore')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-line">
                  {data.people.map((person) => (
                    <PerformanceRow key={person.user.id} person={person} lang={lang} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-surface-line bg-white p-4 shadow-sm">
          <h3 className="text-[13px] font-extrabold text-ink">{t('performance.statusMix')}</h3>
          <div className="mt-4 grid gap-3">
            {data.statuses.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-ink-faint">{t('performance.noData')}</p>
            ) : (
              data.statuses.map((status) => {
                const department = getDepartment(status.department);
                const percentage = totalStatuses ? Math.round((status.count / totalStatuses) * 100) : 0;
                return (
                  <div key={status.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-[11.5px]">
                      <span className="font-semibold text-ink">
                        {lang === 'en' ? status.labelEn : status.labelAr}
                      </span>
                      <span className="tabular-nums text-ink-faint">{status.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${percentage}%`, background: department.color }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PerformanceRow({
  person,
  lang,
}: {
  person: PerformancePerson;
  lang: 'ar' | 'en';
}) {
  const subteam = getSubteam(person.user.department, person.user.subteam);
  const role = getJobRole(person.user.department, person.user.subteam, person.user.jobRole);
  return (
    <tr className="text-[12px] text-ink">
      <td className="px-4 py-3">
        {/* The row is a summary; the profile is where the tasks behind these
            numbers actually are. */}
        <Link
          to={`/people/${person.user.id}`}
          className="flex items-center gap-2.5 rounded-lg transition-colors hover:text-brand-600"
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
            style={{ background: person.user.avatarColor }}
          >
            {person.user.name.slice(0, 1)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-bold">{person.user.name}</span>
            {(role || subteam) && (
              <span className="block truncate text-[10.5px] text-ink-faint">
                {role ? (lang === 'en' ? role.en : role.ar) : lang === 'en' ? subteam?.en : subteam?.ar}
              </span>
            )}
          </span>
        </Link>
      </td>
      <MetricCell value={person.total} />
      <MetricCell value={person.completed} className="text-status-ok" />
      <MetricCell
        value={person.awaitingReview}
        className={person.awaitingReview ? 'text-accent-600' : 'text-ink-faint'}
      />
      <MetricCell value={person.returned} className={person.returned ? 'text-ink-muted' : 'text-ink-faint'} />
      <MetricCell value={person.overdue} className={person.overdue ? 'text-status-bad' : ''} />
      <MetricCell value={`${person.onTimeRate}%`} />
      <MetricCell
        value={person.averageScore ?? '—'}
        className={person.averageScore === null ? 'text-ink-faint' : scoreTextTone(person.averageScore)}
      />
    </tr>
  );
}

function MetricCell({
  value,
  className,
}: {
  value: string | number;
  className?: string;
}) {
  return <td className={cx('px-3 py-3 text-center font-bold tabular-nums', className)}>{value}</td>;
}

function emptyMetrics(): PerformanceMetrics {
  return {
    total: 0,
    completed: 0,
    active: 0,
    overdue: 0,
    awaitingReview: 0,
    returned: 0,
    completionRate: 0,
    onTimeRate: 0,
    firstPassRate: 0,
    averageScore: null,
    scoredTasks: 0,
    effortPoints: 0,
    estimatedMinutes: 0,
    averageDays: null,
    medianDays: null,
    fastestDays: null,
    slowestDays: null,
    timedTasks: 0,
  };
}

/**
 * A rank that sits strictly between the two neighbours a card was dropped
 * between, so only the moved card has to be written back. Halving a gap is
 * exact in binary, and a board would need ~50 drops into the same seam before
 * the two numbers stopped being distinguishable.
 */
function orderBetween(before: number | undefined, after: number | undefined) {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

function formatTaskDate(value: string | null | undefined, lang: 'ar' | 'en') {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-EG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function statusTone(type: StageType) {
  return {
    open: 'bg-surface-sunken text-ink-muted',
    active: 'bg-status-infoBg text-brand-600',
    review: 'bg-status-warnBg text-accent-600',
    done: 'bg-status-okBg text-status-ok',
  }[type];
}

function DepartmentChip({
  active,
  label,
  color,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  color: string;
  icon?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition-all',
        active ? 'border-transparent text-white shadow-sm' : 'border-surface-line bg-white text-ink-muted hover:bg-surface-sunken'
      )}
      style={active ? { background: color } : { borderColor: hexWithAlpha(color, 0.28) }}
    >
      {icon && <ModuleIcon name={icon} color={active ? '#FFFFFF' : color} size={15} variant="plain" />}
      {label}
    </button>
  );
}

/** The gap a lifted card leaves behind, sized to the card it will be replaced by. */
function DropGap({ height }: { height: number }) {
  return (
    <div
      className="rounded-xl border-2 border-dashed border-brand-400 bg-brand-50/60"
      style={{ height }}
      aria-hidden
    />
  );
}

function TaskCard({
  task,
  movable,
  showDepartment,
  forReviewer,
  onOpen,
  cardRef,
  onPointerDown,
  onKeyDown,
}: {
  task: Task;
  movable: boolean;
  showDepartment: boolean;
  /** Whether the person looking is the one a submitted card is waiting on. */
  forReviewer?: boolean;
  onOpen: () => void;
  cardRef?: (node: HTMLElement | null) => void;
  onPointerDown?: (event: React.PointerEvent, fromHandle: boolean) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
}) {
  const { t, lang } = useI18n();
  const due = dueLabel(task.dueDate, t, lang);
  const priority = PRIORITY_META[task.priority];
  const department = getDepartment(task.department ?? DEFAULT_DEPARTMENT);
  const state = stateOf(task);
  const isDone = state === 'approved';
  // A card in a review column, or one that came back, is carrying news — say so
  // rather than making the column position the only clue.
  const flagged = state === 'submitted' || task.reviewDecision === 'changes_requested';

  return (
    <article
      ref={cardRef}
      onPointerDown={(event) => onPointerDown?.(event, false)}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
          return;
        }
        onKeyDown?.(event);
      }}
      role="button"
      tabIndex={0}
      className={cx(
        'cursor-pointer rounded-xl border border-surface-line bg-white p-3 text-start shadow-sm transition-shadow hover:shadow-card',
        movable && 'cursor-grab active:cursor-grabbing'
      )}
      style={{ borderInlineStartWidth: 3, borderInlineStartColor: department.color }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h3
          className={cx(
            'text-[13.5px] font-semibold leading-snug text-ink',
            isDone && 'text-ink-muted line-through decoration-1'
          )}
        >
          {task.title}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
        {task.priority !== 'normal' && (
          <span className={cx('chip shrink-0', priority.className)}>{t(priority.key)}</span>
        )}
        {movable && onPointerDown && (
          // `touch-none` claims the gesture from the scroller, so the grip is
          // the one place a finger can lift a card without the column moving.
          <button
            type="button"
            aria-label={t('tasks.dragHandle')}
            onPointerDown={(event) => {
              event.stopPropagation();
              onPointerDown(event, true);
            }}
            onClick={(event) => event.stopPropagation()}
            className="-me-1 touch-none rounded-md p-1 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink-muted"
          >
            <GripVertical size={15} />
          </button>
        )}
        </div>
      </div>

      {showDepartment && (
        <p className="mb-1 text-[11px] font-semibold" style={{ color: department.color }}>
          {lang === 'en' ? department.en : department.ar}
        </p>
      )}

      <TaskMeta task={task} />

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {due && (
          <span
            className={cx(
              'inline-flex items-center gap-1 text-[11.5px] font-semibold',
              DUE_TONE_CLASS[due.tone]
            )}
          >
            <CalendarClock size={13} />
            {due.text}
          </span>
        )}
        {task.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-faint">
            <Paperclip size={12} />
            <span className="ltr tabular-nums">{task.attachmentCount}</span>
          </span>
        )}
        {isDone && task.score !== null && task.score !== undefined && (
          <ScoreChip score={task.score} size="sm" />
        )}
        {flagged && <StateBadge task={task} forReviewer={forReviewer} />}
      </div>
    </article>
  );
}
