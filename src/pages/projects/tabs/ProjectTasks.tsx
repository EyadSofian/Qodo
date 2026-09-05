/**
 * Qodo Projects — the tasks of one project.
 *
 * Two views over the same data. The list is the default because it is the one
 * that answers "what is late and who has it" for forty tasks at once; the board
 * is for moving work, not for reading it.
 *
 * The rule that shapes this file: **a drag is a request.** Moving a card writes
 * through the same endpoint a form does, the server re-checks
 * `task.edit_status` and the required-checklist guard, and a refused move puts
 * the card back. A board that lets a gesture do what a form may not is not a
 * faster UI, it is a hole.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  LayoutGrid,
  ListChecks,
  Plus,
  Rows3,
} from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { projectTasksApi, taskListsApi } from '../../../lib/projects/api';
import type { ProjectTask, TaskList } from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { EmptyState, Segmented, Spinner, useToast } from '../../../components/ui';
import { TaskCreateDialog } from '../../../components/projects/TaskCreateDialog';

type Filter = 'all' | 'mine' | 'overdue';

export function ProjectTasks() {
  const { detail, can } = useProject();
  const { t, lang } = useI18n();
  const toast = useToast();
  const projectId = detail.project.id;

  const [view, setView] = useState<'list' | 'board'>('list');
  const [filter, setFilter] = useState<Filter>('all');
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parentTaskId?: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, ProjectTask[]>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tasksResult, listsResult] = await Promise.all([
        projectTasksApi.list(projectId, {
          // Only roots. A subtask arrives when its parent is expanded, which is
          // what keeps a project with five thousand tasks from sending all of
          // them to draw a screen that shows twenty.
          topLevel: true,
          mine: filter === 'mine' || undefined,
          overdue: filter === 'overdue' || undefined,
          limit: 100,
        }),
        taskListsApi.list(projectId),
      ]);
      setTasks(tasksResult.tasks);
      setTaskLists(listsResult.taskLists);
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, lang]);

  useEffect(() => {
    setLoading(true);
    setExpanded(new Set());
    setChildren({});
    void load();
  }, [load]);

  const toggleExpand = async (task: ProjectTask) => {
    const next = new Set(expanded);
    if (next.has(task.id)) {
      next.delete(task.id);
      setExpanded(next);
      return;
    }
    next.add(task.id);
    setExpanded(next);
    if (children[task.id]) return;
    try {
      const result = await projectTasksApi.list(projectId, { parentTaskId: task.id, limit: 100 });
      setChildren((current) => ({ ...current, [task.id]: result.tasks }));
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  /**
   * Move a task to another status.
   *
   * Optimistic, then reconciled. The refusal that matters is
   * `checklist_incomplete` — the server rejects completing a task with an open
   * required item, and the card must visibly go back rather than sitting in the
   * wrong column until the next reload.
   */
  const moveTask = async (task: ProjectTask, statusId: string) => {
    const previous = tasks;
    setTasks((current) =>
      current.map((row) => (row.id === task.id ? { ...row, statusId } : row))
    );
    try {
      await projectTasksApi.update(projectId, task.id, { statusId });
      await load();
    } catch (caught) {
      setTasks(previous);
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  const filters = useMemo(
    () => [
      { value: 'all' as Filter, label: t('projectTasks.filter.all') },
      { value: 'mine' as Filter, label: t('projectTasks.filter.mine') },
      { value: 'overdue' as Filter, label: t('projectTasks.filter.overdue') },
    ],
    [t]
  );

  if (loading) {
    return (
      <div className="card grid place-items-center py-16">
        <Spinner size={22} className="text-brand-500" />
      </div>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented value={filter} onChange={setFilter} options={filters} className="flex-1 min-w-[240px]" />

        <div role="group" className="flex rounded-xl border border-surface-line bg-white p-1">
          <button
            type="button"
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            title={t('projectTasks.view.list')}
            className={`btn-quiet !min-h-9 rounded-lg px-2.5 ${
              view === 'list' ? 'bg-navy text-white hover:bg-navy hover:text-white' : ''
            }`}
          >
            <Rows3 size={16} />
          </button>
          <button
            type="button"
            onClick={() => setView('board')}
            aria-pressed={view === 'board'}
            title={t('projectTasks.view.board')}
            className={`btn-quiet !min-h-9 rounded-lg px-2.5 ${
              view === 'board' ? 'bg-navy text-white hover:bg-navy hover:text-white' : ''
            }`}
          >
            <LayoutGrid size={16} />
          </button>
        </div>

        {can('task.create') && (
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreating({})}>
            <Plus size={15} />
            {t('projectTasks.new')}
          </button>
        )}
      </div>

      {error ? (
        <div className="card">
          <EmptyState icon={<ListChecks size={32} />} title={t('projects.error.load')} body={error} />
        </div>
      ) : tasks.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ListChecks size={32} />}
            title={t('projectTasks.empty')}
            body={t('projectTasks.emptyHint')}
            action={
              can('task.create') ? (
                <button type="button" className="btn-primary btn-sm" onClick={() => setCreating({})}>
                  <Plus size={15} />
                  {t('projectTasks.new')}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : view === 'list' ? (
        <TaskTree
          tasks={tasks}
          children={children}
          expanded={expanded}
          onToggle={toggleExpand}
          onAddSubtask={(task) => setCreating({ parentTaskId: task.id })}
          canCreate={can('task.create')}
        />
      ) : (
        <TaskBoard tasks={tasks} onMove={moveTask} canMove={can('task.edit_status')} />
      )}

      <TaskCreateDialog
        open={creating !== null}
        projectId={projectId}
        taskLists={taskLists}
        parentTaskId={creating?.parentTaskId}
        onClose={() => setCreating(null)}
        onCreated={() => {
          setCreating(null);
          setChildren({});
          void load();
        }}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* List view                                                            */
/* ------------------------------------------------------------------ */

function TaskTree({
  tasks,
  children,
  expanded,
  onToggle,
  onAddSubtask,
  canCreate,
}: {
  tasks: ProjectTask[];
  children: Record<string, ProjectTask[]>;
  expanded: Set<string>;
  onToggle: (task: ProjectTask) => void;
  onAddSubtask: (task: ProjectTask) => void;
  canCreate: boolean;
}) {
  return (
    <div className="card divide-y divide-surface-line">
      {tasks.map((task) => (
        <TaskRowGroup
          key={task.id}
          task={task}
          children={children}
          expanded={expanded}
          onToggle={onToggle}
          onAddSubtask={onAddSubtask}
          canCreate={canCreate}
        />
      ))}
    </div>
  );
}

function TaskRowGroup({
  task,
  children,
  expanded,
  onToggle,
  onAddSubtask,
  canCreate,
}: {
  task: ProjectTask;
  children: Record<string, ProjectTask[]>;
  expanded: Set<string>;
  onToggle: (task: ProjectTask) => void;
  onAddSubtask: (task: ProjectTask) => void;
  canCreate: boolean;
}) {
  const isOpen = expanded.has(task.id);
  return (
    <>
      <TaskRow
        task={task}
        isOpen={isOpen}
        onToggle={() => onToggle(task)}
        onAddSubtask={() => onAddSubtask(task)}
        canCreate={canCreate}
      />
      {isOpen &&
        (children[task.id] ?? []).map((child) => (
          <TaskRowGroup
            key={child.id}
            task={child}
            children={children}
            expanded={expanded}
            onToggle={onToggle}
            onAddSubtask={onAddSubtask}
            canCreate={canCreate}
          />
        ))}
    </>
  );
}

function TaskRow({
  task,
  isOpen,
  onToggle,
  onAddSubtask,
  canCreate,
}: {
  task: ProjectTask;
  isOpen: boolean;
  onToggle: () => void;
  onAddSubtask: () => void;
  canCreate: boolean;
}) {
  const { t } = useI18n();
  const overdue = isOverdue(task);
  const checklist = task.checklist;

  return (
    <div
      className="group flex flex-wrap items-center gap-2.5 px-3.5 py-2.5 hover:bg-surface-sunken/60"
      // Indentation carries the hierarchy, and it has to be padding on the
      // reader's start edge rather than a left margin, or the tree inverts in
      // Arabic.
      style={{ paddingInlineStart: `${0.875 + task.depth * 1.25}rem` }}
    >
      {task.childCount > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-label={isOpen ? t('projectTasks.hideSubtasks') : t('projectTasks.showSubtasks')}
          className="btn-quiet !min-h-7 shrink-0 rounded-md p-1"
        >
          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} className="rtl:-scale-x-100" />}
        </button>
      ) : (
        <span className="w-7 shrink-0" aria-hidden="true" />
      )}

      <span
        aria-hidden="true"
        className="h-6 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: task.status?.color ?? task.color ?? '#CBD5E1' }}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-ink">{task.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-ink-muted">
          <span className="font-mono">{task.reference}</span>
          {task.taskListName && <span>{task.taskListName}</span>}
          {task.childCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <GitBranch size={11} aria-hidden="true" />
              {t('projectTasks.subtasks', { n: task.childCount })}
            </span>
          )}
          {checklist.total > 0 && (
            <span
              className={`inline-flex items-center gap-1 ${
                checklist.requiredOpen > 0 ? 'font-semibold text-status-warn' : ''
              }`}
              title={checklist.requiredOpen > 0 ? t('projectTasks.checklistBlocked') : undefined}
            >
              <CheckSquare size={11} aria-hidden="true" />
              {t('projectTasks.checklist', { done: checklist.done, total: checklist.total })}
            </span>
          )}
        </p>
      </div>

      {task.endDate && (
        <span
          className={`chip shrink-0 ${
            overdue ? 'bg-status-badBg text-status-bad' : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          {/* Not colour alone — §74. The icon and the word carry it too. */}
          {overdue ? <AlertTriangle size={11} aria-hidden="true" /> : <Clock size={11} aria-hidden="true" />}
          {overdue ? t('projectTasks.overdue') : task.endDate}
        </span>
      )}

      <span className="w-11 shrink-0 text-end text-[12px] font-semibold tabular-nums text-ink-muted">
        {task.progress}%
      </span>

      {canCreate && task.depth < 4 && (
        <button
          type="button"
          onClick={onAddSubtask}
          title={t('projectTasks.newSubtask')}
          aria-label={`${t('projectTasks.newSubtask')} — ${task.title}`}
          className="btn-quiet !min-h-8 shrink-0 rounded-lg px-2 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Board view                                                           */
/* ------------------------------------------------------------------ */

/**
 * The board.
 *
 * Columns come from the statuses the loaded tasks actually carry, plus one for
 * the tasks with no status at all — which is the honest rendering of a project
 * whose statuses have not been configured yet, rather than an empty board.
 *
 * Dragging is native HTML5 drag-and-drop with a keyboard equivalent, because a
 * board that can only be operated with a mouse fails §74. The keyboard path is
 * the select on each card: it moves the task through the same endpoint.
 */
function TaskBoard({
  tasks,
  onMove,
  canMove,
}: {
  tasks: ProjectTask[];
  onMove: (task: ProjectTask, statusId: string) => void;
  canMove: boolean;
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState<string | null>(null);

  const columns = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color: string }>();
    for (const task of tasks) {
      if (!task.status || !task.statusId) continue;
      if (!seen.has(task.statusId)) {
        seen.set(task.statusId, {
          id: task.statusId,
          label: task.status.label.en,
          color: task.status.color,
        });
      }
    }
    return [...seen.values()];
  }, [tasks]);

  const unfiled = tasks.filter((task) => !task.statusId);

  return (
    // Horizontal scroll on the board, never on the page — §75.
    <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
      {unfiled.length > 0 && (
        <BoardColumn
          title={t('common.none')}
          color="#CBD5E1"
          tasks={unfiled}
          columns={columns}
          onMove={onMove}
          canMove={canMove}
          dragging={dragging}
          setDragging={setDragging}
        />
      )}
      {columns.map((column) => (
        <BoardColumn
          key={column.id}
          statusId={column.id}
          title={column.label}
          color={column.color}
          tasks={tasks.filter((task) => task.statusId === column.id)}
          columns={columns}
          onMove={onMove}
          canMove={canMove}
          dragging={dragging}
          setDragging={setDragging}
        />
      ))}
    </div>
  );
}

function BoardColumn({
  statusId,
  title,
  color,
  tasks,
  columns,
  onMove,
  canMove,
  dragging,
  setDragging,
}: {
  statusId?: string;
  title: string;
  color: string;
  tasks: ProjectTask[];
  columns: Array<{ id: string; label: string }>;
  onMove: (task: ProjectTask, statusId: string) => void;
  canMove: boolean;
  dragging: string | null;
  setDragging: (id: string | null) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <section
      className={`flex w-[280px] shrink-0 flex-col gap-2 rounded-2xl border p-2.5 transition-colors ${
        over ? 'border-brand-400 bg-brand-50' : 'border-surface-line bg-surface-sunken/50'
      }`}
      onDragOver={(event) => {
        if (!canMove || !statusId) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        if (!canMove || !statusId) return;
        event.preventDefault();
        const taskId = event.dataTransfer.getData('text/plain');
        const task = tasks.find((row) => row.id === taskId) ?? null;
        // The card being dropped came from another column, so it is not in this
        // column's list — the parent holds the authoritative set and re-reads it.
        if (!task && dragging) {
          const moved = { id: dragging } as ProjectTask;
          onMove(moved, statusId);
        }
        setDragging(null);
      }}
    >
      <header className="flex items-center gap-2 px-1">
        <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="flex-1 truncate text-[12.5px] font-bold uppercase tracking-wide text-ink-muted">
          {title}
        </h3>
        <span className="chip bg-white text-[11px] text-ink-muted">{tasks.length}</span>
      </header>

      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li key={task.id}>
            <article
              draggable={canMove}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', task.id);
                setDragging(task.id);
              }}
              onDragEnd={() => setDragging(null)}
              className={`card p-2.5 ${canMove ? 'cursor-grab active:cursor-grabbing' : ''} ${
                dragging === task.id ? 'opacity-50' : ''
              }`}
            >
              <p className="text-[13px] font-semibold leading-snug text-ink">{task.title}</p>
              <p className="mt-1 flex items-center gap-2 text-[11px] text-ink-muted">
                <span className="font-mono">{task.reference}</span>
                {task.endDate && <span>{task.endDate}</span>}
              </p>

              {/* The keyboard equivalent of the drag. A board operable only by
                  pointer is not accessible, and hiding this behind a hover
                  would put it out of reach of the people who need it most. */}
              {canMove && columns.length > 0 && (
                <label className="mt-2 block">
                  <span className="sr-only">{task.title}</span>
                  <select
                    className="field !py-1 !text-[12px]"
                    value={task.statusId ?? ''}
                    onChange={(event) => onMove(task, event.target.value)}
                  >
                    <option value="" disabled>
                      —
                    </option>
                    {columns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function isOverdue(task: ProjectTask): boolean {
  if (!task.endDate) return false;
  if (task.status?.category === 'done' || task.completedAt) return false;
  return task.endDate < new Date().toISOString().slice(0, 10);
}


