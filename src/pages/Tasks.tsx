import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, ListPlus, Plus, Search } from 'lucide-react';
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
  getStages,
  stageType,
} from '@shared/departments';
import { TaskDialog, TaskMeta } from '../components/TaskDialog';
import { ModuleIcon } from '../components/ModuleIcon';
import { EmptyState, Segmented, useToast } from '../components/ui';
import { DUE_TONE_CLASS, PRIORITY_META, cx, dueLabel, hexWithAlpha } from '../lib/utils';
import type { StageType, Task } from '../lib/types';

interface Column {
  id: string;
  label: string;
  /** Which tasks belong here, given the current department filter. */
  match: (task: Task) => boolean;
}

export function Tasks() {
  const { user, can } = useAuth();
  const { t, lang } = useI18n();
  const { directory } = useWorkspace();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  // '' = every department, which falls back to the canonical progress columns.
  const [department, setDepartment] = useState<string>(user?.department ?? DEFAULT_DEPARTMENT);
  const [assignee, setAssignee] = useState('');
  const [query, setQuery] = useState('');
  const [dialogTask, setDialogTask] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogColumn, setDialogColumn] = useState<string | null>(null);
  const [mobileColumn, setMobileColumn] = useState(0);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const seesAll = can(PERMISSIONS.TASKS_VIEW_ALL);

  const load = useCallback(async () => {
    const data = await api.get<{ tasks: Task[] }>('/tasks');
    setTasks(data.tasks);
    return data.tasks;
  }, []);

  useEffect(() => {
    load().catch(() => setTasks([]));
  }, [load]);

  useEffect(() => {
    if (seesAll) setScope('all');
  }, [seesAll]);

  // A ?task=… link from a notification or search opens straight into the card.
  const deepLink = params.get('task');
  useEffect(() => {
    if (!deepLink || !tasks) return;
    const match = tasks.find((t) => t.id === deepLink);
    if (match) {
      setDialogTask(match);
      setDialogOpen(true);
    }
    params.delete('task');
    setParams(params, { replace: true });
  }, [deepLink, tasks, params, setParams]);

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
      if (scope === 'mine' && task.assigneeId !== user?.id && task.createdBy !== user?.id) return false;
      if (assignee && task.assigneeId !== assignee) return false;
      if (term) {
        const haystack = `${task.title} ${task.description} ${task.labels.join(' ')}`.toLowerCase();
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

  /**
   * Move optimistically so the card lands where it was dropped immediately,
   * then reconcile with the server. On failure the board reloads rather than
   * trying to unwind the local edit.
   */
  const moveTask = async (taskId: string, columnId: string) => {
    const task = tasks?.find((t) => t.id === taskId);
    if (!task) return;

    // Dropping into a canonical column (no department selected) means "make it
    // this much done" — resolved to the matching stage in the task's own
    // department, since a `review` column has a different id in each.
    const taskDepartment = task.department ?? DEFAULT_DEPARTMENT;
    const targetStage = department
      ? columnId
      : (getStages(taskDepartment).find((s) => s.type === (columnId as StageType))?.id ?? task.stage);

    if (targetStage === task.stage) return;

    const order = Math.min(0, ...(byColumn[columnId] ?? []).map((t) => t.order)) - 1;
    setTasks((list) =>
      (list ?? []).map((t) => (t.id === taskId ? { ...t, stage: targetStage, order } : t))
    );

    try {
      await api.patch(`/tasks/${taskId}`, { stage: targetStage, order });
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
      load().catch(() => {});
    }
  };

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
            {seesAll ? t('tasks.teamBoard') : t('tasks.myBoard')}
          </p>
        </div>
        {can(PERMISSIONS.TASKS_CREATE) && (
          <button type="button" onClick={() => openNew(null)} className="btn-primary btn-sm gap-1.5">
            <Plus size={16} />
            {t('tasks.new')}
          </button>
        )}
      </header>

      {/* Department picker — the control that reshapes the board. */}
      <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <DepartmentChip
          active={department === ''}
          label={t('tasks.allDepartments')}
          color="#64748B"
          onClick={() => setDepartment('')}
        />
        {DEPARTMENTS.map((d) => (
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {seesAll && (
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

        {seesAll && directory.length > 1 && (
          <select
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            className="field w-auto min-w-[9rem]"
            aria-label={t('tasks.assignee')}
          >
            <option value="">{t('tasks.allPeople')}</option>
            {directory.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Phone: one column at a time — five side by side would be 60px wide. */}
      <div className="mb-3 md:hidden">
        <Segmented
          value={String(mobileColumn)}
          onChange={(value) => setMobileColumn(Number(value))}
          options={columns.map((column, index) => ({
            value: String(index),
            label: column.label,
            count: byColumn[column.id]?.length ?? 0,
          }))}
        />
      </div>

      {tasks === null ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-56 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {columns.map((column, index) => (
            <section
              key={column.id}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(column.id);
              }}
              onDragLeave={() => setDragOver((current) => (current === column.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(null);
                const id = event.dataTransfer.getData('text/task-id');
                if (id) moveTask(id, column.id);
              }}
              className={cx(
                'flex-col rounded-2xl border p-2.5 transition-colors',
                dragOver === column.id ? 'border-brand-400 bg-brand-50/70' : 'border-surface-line bg-white/60',
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
                {can(PERMISSIONS.TASKS_CREATE) && department && (
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
                {(byColumn[column.id] ?? []).map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    showDepartment={!department}
                    onOpen={() => {
                      setDialogTask(task);
                      setDialogOpen(true);
                    }}
                  />
                ))}

                {(byColumn[column.id]?.length ?? 0) === 0 && (
                  <p className="rounded-xl border border-dashed border-surface-line px-3 py-6 text-center text-[12px] text-ink-faint">
                    {t('tasks.emptyColumn')}
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {tasks !== null && filtered.length === 0 && (
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

function TaskCard({
  task,
  showDepartment,
  onOpen,
}: {
  task: Task;
  showDepartment: boolean;
  onOpen: () => void;
}) {
  const { t, lang } = useI18n();
  const due = dueLabel(task.dueDate, t, lang);
  const priority = PRIORITY_META[task.priority];
  const department = getDepartment(task.department ?? DEFAULT_DEPARTMENT);
  const isDone = stageType(task.department ?? DEFAULT_DEPARTMENT, task.stage) === 'done';

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/task-id', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-xl border border-surface-line bg-white p-3 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-card active:scale-[0.99]"
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
        {task.priority !== 'normal' && (
          <span className={cx('chip shrink-0', priority.className)}>{t(priority.key)}</span>
        )}
      </div>

      {showDepartment && (
        <p className="mb-1 text-[11px] font-semibold" style={{ color: department.color }}>
          {lang === 'en' ? department.en : department.ar}
        </p>
      )}

      <TaskMeta task={task} />

      {due && (
        <p className={cx('mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold', DUE_TONE_CLASS[due.tone])}>
          <CalendarClock size={13} />
          {due.text}
        </p>
      )}
    </article>
  );
}
