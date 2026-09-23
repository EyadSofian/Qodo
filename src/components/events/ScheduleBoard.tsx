/**
 * The schedule as the business reads it: Department → Package → optional
 * Level → Course, in the order the layout keeps (the workbook's, until a
 * layout manager changes it).
 *
 * A package is a section with its own accent and a header that says how many
 * courses it holds and how they are doing; a level inside it is a light
 * labelled divider, never a card inside a card. The course cards are the same
 * cards as everywhere else. Courses the layout does not place yet are never
 * dropped — they collect at the end.
 *
 * In edit mode the same board grows handles and menus. Every change goes to
 * the editor's draft (see useLayoutEditor); nothing is saved per drag, and
 * nothing here can touch Odoo. Drag-and-drop uses a handle, not the whole
 * card, and every drag has a menu equivalent (Move up/down, Move to…) for
 * keyboards and touch screens.
 */

import { useEffect, useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Eye,
  EyeOff,
  FolderInput,
  GripVertical,
  Layers,
  ListPlus,
  MoreHorizontal,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  Unlink,
  X,
} from 'lucide-react';
import * as Layout from '@shared/eventsLayout';
import { departmentLabel, sortRows, STATUS_LABELS } from '@shared/eventsSchedule';
import type { Arranged, ArrangedPackage, EventLayout, PlacedRow } from '../../lib/eventsLayout';
import { agoLabel, type StatusCanonical } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { Spinner, useToast } from '../ui';
import { CourseCard } from './CourseCard';
import { CourseListRow } from './CourseListRow';
import {
  AddCourseDialog,
  ConfirmDialog,
  DeletePackageDialog,
  DisplayDialog,
  GroupDialog,
  MoveCourseDialog,
  PackageDialog,
  accentTone,
} from './LayoutDialogs';
import { STATUS_TONE, TONE, departmentTone } from './tones';
import type { LayoutEditor } from './useLayoutEditor';

/* ── collapse, remembered per browser ────────────────────────────── */

const COLLAPSE_KEY = 'qodo.events.collapsed.v1';

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      } catch {
        // Nothing depends on it: a private window just forgets.
      }
      return next;
    });
  return { collapsed, toggle };
}

/* ── a small menu ────────────────────────────────────────────────── */

type MenuItem = { label: string; icon: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean } | 'divider';

function ActionMenu({ items, label, tone = 'light' }: { items: MenuItem[]; label: string; tone?: 'light' | 'dark' }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span className="relative" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={cx(
          'grid h-8 w-8 place-items-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
          tone === 'dark' ? 'text-slate-600 hover:bg-white/80' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
        )}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div role="menu" className="absolute end-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_18px_40px_-12px_rgba(15,23,42,0.35)]">
          {items.map((item, index) =>
            item === 'divider' ? (
              <hr key={`d${index}`} className="my-1 border-slate-100" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  item.onClick();
                }}
                className={cx(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-start text-[13px] font-semibold disabled:opacity-40',
                  item.danger ? 'text-rose-700 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'
                )}
              >
                <span className="shrink-0 opacity-80">{item.icon}</span>
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </span>
  );
}

/* ── drag and drop ───────────────────────────────────────────────── */

type Drag = { kind: 'course'; id: number } | { kind: 'package'; id: string } | { kind: 'group'; id: string } | null;
type Hover = { key: string; side?: 'before' | 'after' } | null;

/** Before/after the card under the pointer, in reading order (RTL aware). */
function sideOf(event: DragEvent<HTMLElement>, axis: 'x' | 'y'): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect();
  if (axis === 'y') return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
  const firstHalf = event.clientX < rect.left + rect.width / 2;
  return rtl ? (firstHalf ? 'after' : 'before') : firstHalf ? 'before' : 'after';
}

function DragHandle({ label, onArm }: { label: string; onArm: () => void }) {
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={label}
      title="اسحب"
      onPointerDown={onArm}
      className="grid h-8 w-7 cursor-grab touch-none place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"
    >
      <GripVertical size={17} />
    </span>
  );
}

/* ── the board ───────────────────────────────────────────────────── */

type Dialog =
  | { kind: 'addPackage'; department: string | null }
  | { kind: 'editPackage'; packageId: string }
  | { kind: 'deletePackage'; packageId: string }
  | { kind: 'addGroup'; packageId: string }
  | { kind: 'renameGroup'; groupId: string; label: string }
  | { kind: 'deleteGroup'; groupId: string; label: string }
  | { kind: 'move'; eventId: number }
  | { kind: 'display'; eventId: number }
  | { kind: 'addCourse'; packageId: string; groupId: string | null; label: string }
  | { kind: 'reset' }
  | { kind: 'discard' }
  | null;

export function ScheduleBoard({
  rows,
  allRows,
  layout,
  departments,
  editor,
  view,
  now,
  selectedId,
  onOpen,
  columns,
}: {
  /** Filtered and decorated rows; in edit mode hidden ones are included. */
  rows: PlacedRow[];
  /** Every loaded row, for the course picker. */
  allRows: PlacedRow[];
  layout: EventLayout;
  /** Canonical departments to show, or null for all. */
  departments: string[] | null;
  editor: LayoutEditor;
  view: string;
  now: Date;
  selectedId: number | null;
  onOpen: (id: number) => void;
  columns: CSSProperties;
}) {
  const { push } = useToast();
  const editing = editor.editing;
  const { collapsed, toggle } = useCollapsed();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);

  const arranged = useMemo(() => Layout.arrangeSchedule(rows, layout, { departments, keepEmpty: editing, includeHidden: editing }) as Arranged, [rows, layout, departments, editing]);
  const unassigned = useMemo(() => sortRows(arranged.unassigned, null), [arranged.unassigned]);
  const index = useMemo(() => Layout.placementIndex(layout), [layout]);
  const hiddenIds = useMemo(() => new Set(layout.hiddenInSchedule ?? []), [layout]);
  const packageList = useMemo(
    () => layout.departments.flatMap((entry) => entry.packages.map((pkg) => ({ ...pkg, department: entry.department }))),
    [layout]
  );
  const rowById = useMemo(() => new Map(allRows.map((row) => [row.id, row])), [allRows]);

  // The page scrolls itself while something is dragged near its edge.
  useEffect(() => {
    if (!drag) return;
    const onOver = (event: globalThis.DragEvent) => {
      const edge = 90;
      if (event.clientY < edge) window.scrollBy(0, -16);
      else if (event.clientY > window.innerHeight - edge) window.scrollBy(0, 16);
    };
    window.addEventListener('dragover', onOver);
    return () => window.removeEventListener('dragover', onOver);
  }, [drag]);

  // A handle pressed and released without dragging disarms, so the card is
  // not left draggable (and its text unselectable) afterwards.
  useEffect(() => {
    if (!armed) return;
    const disarm = () => setArmed(null);
    document.addEventListener('pointerup', disarm);
    return () => document.removeEventListener('pointerup', disarm);
  }, [armed]);

  const endDrag = () => {
    setDrag(null);
    setArmed(null);
    setHover(null);
  };

  /** The full, layout-ordered list a course sits in — neighbours outside the filter included. */
  const siblingsOf = (packageId: string, groupId: string | null) => {
    const pkg = packageList.find((entry) => entry.id === packageId);
    const courses = groupId ? pkg?.groups.find((group) => group.id === groupId)?.courses : pkg?.courses;
    return (courses ?? []).map((course) => course.eventId);
  };

  const dropCourseAt = (target: { packageId: string; groupId: string | null } | null, anchor: { eventId: number; side: 'before' | 'after' } | null) => {
    if (drag?.kind !== 'course') return;
    const moving = drag.id;
    if (!target) {
      editor.apply((current) => Layout.unplaceCourse(current, moving));
      return;
    }
    let beforeEventId: number | null = null;
    if (anchor) {
      if (anchor.side === 'before') beforeEventId = anchor.eventId;
      else {
        const list = siblingsOf(target.packageId, target.groupId).filter((id) => id !== moving);
        beforeEventId = list[list.indexOf(anchor.eventId) + 1] ?? null;
      }
    }
    if (beforeEventId === moving) return;
    editor.apply((current) => Layout.placeCourse(current, moving, { ...target, beforeEventId }, { code: rowById.get(moving)?.courseCode ?? null }));
  };

  /* ── course slot ─────────────────────────────────────────────── */

  const renderCourse = (row: PlacedRow, container: { packageId: string; groupId: string | null } | null) => {
    const card =
      view === 'list' ? (
        <CourseListRow row={row} now={now} selected={row.id === selectedId} onOpen={onOpen} />
      ) : (
        <CourseCard row={row} now={now} selected={row.id === selectedId} onOpen={onOpen} />
      );
    if (!editing) {
      return view === 'list' ? <div key={row.id}>{card}</div> : <div key={row.id} className="grid min-w-0">{card}</div>;
    }
    const hidden = hiddenIds.has(row.id);
    const key = `c:${row.id}`;
    const axis = view === 'list' ? 'y' : 'x';
    const siblings = container ? siblingsOf(container.packageId, container.groupId) : [];
    const position = siblings.indexOf(row.id);
    const items: MenuItem[] = [
      ...(container
        ? ([
            { label: 'لفوق', icon: <ArrowUp size={15} />, disabled: position <= 0, onClick: () => editor.apply((l) => Layout.moveCourseStep(l, row.id, -1)) },
            { label: 'لتحت', icon: <ArrowDown size={15} />, disabled: position === -1 || position >= siblings.length - 1, onClick: () => editor.apply((l) => Layout.moveCourseStep(l, row.id, 1)) },
          ] as MenuItem[])
        : []),
      { label: container ? 'انقل لباقة / مستوى…' : 'حطّه في باقة…', icon: <FolderInput size={15} />, onClick: () => setDialog({ kind: 'move', eventId: row.id }) },
      ...(container ? ([{ label: 'اسم العرض…', icon: <Pencil size={15} />, onClick: () => setDialog({ kind: 'display', eventId: row.id }) }] as MenuItem[]) : []),
      'divider',
      hidden
        ? { label: 'اظهره في الجدول', icon: <Eye size={15} />, onClick: () => editor.apply((l) => Layout.setCourseHiddenInSchedule(l, row.id, false)) }
        : { label: 'اخفيه من الجدول', icon: <EyeOff size={15} />, onClick: () => editor.apply((l) => Layout.setCourseHiddenInSchedule(l, row.id, true)) },
      ...(container
        ? ([{ label: 'شيله من الباقة', icon: <Unlink size={15} />, danger: true, onClick: () => editor.apply((l) => Layout.unplaceCourse(l, row.id)) }] as MenuItem[])
        : []),
    ];

    return (
      <div
        key={row.id}
        draggable={armed === key}
        onDragStart={(event) => {
          // Drag events bubble: the package and level around this card have
          // their own onDragStart, and must not relabel this drag as theirs.
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(row.id));
          setDrag({ kind: 'course', id: row.id });
        }}
        onDragEnd={endDrag}
        onDragOver={(event) => {
          if (drag?.kind !== 'course' || drag.id === row.id) return;
          event.preventDefault();
          event.stopPropagation();
          const side = sideOf(event, axis);
          if (hover?.key !== key || hover.side !== side) setHover({ key, side });
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dropCourseAt(container, container ? { eventId: row.id, side: sideOf(event, axis) } : null);
          endDrag();
        }}
        className={cx('relative grid min-w-0 rounded-[18px] transition', drag?.kind === 'course' && drag.id === row.id && 'scale-[0.98] opacity-40')}
      >
        {hover?.key === key && (
          <span
            aria-hidden
            className={cx(
              'pointer-events-none absolute z-20 rounded-full bg-blue-600 shadow-[0_0_0_3px_rgba(37,99,235,0.2)]',
              axis === 'x' ? 'inset-y-1 w-1' : 'inset-x-1 h-1',
              axis === 'x' && (hover.side === 'before' ? '-start-2.5' : '-end-2.5'),
              axis === 'y' && (hover.side === 'before' ? '-top-1' : '-bottom-1')
            )}
          />
        )}
        <div className="mb-1.5 flex items-center gap-1 rounded-xl border border-dashed border-violet-300 bg-violet-50/80 px-1.5 py-0.5">
          <DragHandle label={`اسحب ${row.courseName}`} onArm={() => setArmed(key)} />
          <span dir="auto" className="min-w-0 flex-1 truncate text-[12px] font-bold text-violet-900">
            {row.placement?.customLabel ? 'اسم عرض مخصّص' : row.placement?.badge ?? (container ? `#${position + 1}` : 'مش في باقة')}
          </span>
          {hidden && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-white">
              <EyeOff size={11} /> مخفي من الجدول
            </span>
          )}
          <ActionMenu items={items} label={`إجراءات ${row.courseName}`} tone="dark" />
        </div>
        <div className={cx('grid min-w-0', hidden && 'opacity-50 saturate-50')}>{card}</div>
      </div>
    );
  };

  const courseGrid = (list: PlacedRow[], container: { packageId: string; groupId: string | null } | null) =>
    view === 'list' ? (
      <div className={cx('overflow-hidden rounded-2xl border border-slate-200 bg-white', editing && 'grid gap-2 overflow-visible border-0 bg-transparent')}>
        {list.map((row) => renderCourse(row, container))}
      </div>
    ) : (
      <div className="grid" style={columns}>
        {list.map((row) => renderCourse(row, container))}
      </div>
    );

  /** An empty package or level while editing: somewhere to drop. */
  const dropZone = (key: string, target: { packageId: string; groupId: string | null } | null, text: string) => (
    <div
      onDragOver={(event) => {
        if (drag?.kind !== 'course') return;
        event.preventDefault();
        if (hover?.key !== key) setHover({ key });
      }}
      onDragLeave={() => hover?.key === key && setHover(null)}
      onDrop={(event) => {
        event.preventDefault();
        dropCourseAt(target, null);
        endDrag();
      }}
      className={cx(
        'grid place-items-center rounded-2xl border-2 border-dashed px-4 py-6 text-[12.5px] font-semibold transition-colors',
        hover?.key === key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white/50 text-slate-500'
      )}
    >
      {text}
    </div>
  );

  /* ── package section ─────────────────────────────────────────── */

  const renderPackage = (entry: ArrangedPackage, department: string, packageIndex: number, siblingCount: number) => {
    const pkg = entry.package;
    const tone = accentTone(pkg.accent);
    const all = [...entry.direct, ...entry.groups.flatMap((group) => group.rows)];
    const isCollapsed = collapsed.has(pkg.id) && !editing;
    const counts = countStatuses(all);
    const names = all.slice(0, 4).map((row) => row.courseName);
    const key = `p:${pkg.id}`;
    const stale = editing ? editor.stale.filter((ref) => ref.packageId === pkg.id) : [];

    const menu: MenuItem[] = [
      { label: 'تعديل الاسم واللون', icon: <Pencil size={15} />, onClick: () => setDialog({ kind: 'editPackage', packageId: pkg.id }) },
      { label: 'لفوق', icon: <ArrowUp size={15} />, disabled: packageIndex === 0, onClick: () => editor.apply((l) => Layout.movePackageStep(l, pkg.id, -1)) },
      { label: 'لتحت', icon: <ArrowDown size={15} />, disabled: packageIndex >= siblingCount - 1, onClick: () => editor.apply((l) => Layout.movePackageStep(l, pkg.id, 1)) },
      { label: 'ضيف مستوى / مجموعة', icon: <ListPlus size={15} />, onClick: () => setDialog({ kind: 'addGroup', packageId: pkg.id }) },
      pkg.hiddenInSchedule
        ? { label: 'اظهر الباقة في الجدول', icon: <Eye size={15} />, onClick: () => editor.apply((l) => Layout.updatePackage(l, pkg.id, { hiddenInSchedule: false })) }
        : { label: 'اخفي الباقة من الجدول', icon: <EyeOff size={15} />, onClick: () => editor.apply((l) => Layout.updatePackage(l, pkg.id, { hiddenInSchedule: true })) },
      'divider',
      { label: 'شيل الباقة من الترتيب', icon: <PackageMinus size={15} />, danger: true, onClick: () => setDialog({ kind: 'deletePackage', packageId: pkg.id }) },
    ];

    return (
      <section
        key={pkg.id}
        aria-label={pkg.label}
        draggable={armed === key}
        onDragStart={(event) => {
          if (event.target !== event.currentTarget) return;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', pkg.id);
          setDrag({ kind: 'package', id: pkg.id });
        }}
        onDragEnd={endDrag}
        className={cx(
          'relative min-w-0 rounded-3xl border bg-gradient-to-b p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-24px_rgba(15,23,42,0.35)] sm:p-4',
          tone.wash,
          editing ? 'border-violet-200' : 'border-white/80',
          pkg.hiddenInSchedule && 'opacity-70',
          drag?.kind === 'package' && drag.id === pkg.id && 'opacity-40'
        )}
      >
        <span aria-hidden className={cx('pointer-events-none absolute inset-y-6 start-0 w-1.5 rounded-e-full bg-gradient-to-b', tone.stripe)} />
        {hover?.key === key && hover.side === 'before' && <span aria-hidden className="absolute inset-x-6 -top-2.5 h-1 rounded-full bg-blue-600" />}
        <header
          onDragOver={(event) => {
            if (!drag || (drag.kind === 'package' && drag.id === pkg.id)) return;
            event.preventDefault();
            const next: Hover = drag.kind === 'package' ? { key, side: 'before' } : { key: `${key}:into` };
            if (hover?.key !== next.key || hover.side !== next.side) setHover(next);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (drag?.kind === 'package') {
              const id = drag.id;
              editor.apply((l) => Layout.movePackage(l, id, { department, beforePackageId: pkg.id }));
            } else if (drag?.kind === 'group') {
              const id = drag.id;
              editor.apply((l) => Layout.moveGroup(l, id, { packageId: pkg.id }));
            } else dropCourseAt({ packageId: pkg.id, groupId: null }, null);
            endDrag();
          }}
          className={cx(
            'flex min-w-0 items-center gap-3 rounded-2xl border bg-gradient-to-l px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]',
            tone.border,
            tone.wash,
            hover?.key === `${key}:into` && 'bg-blue-100/70 ring-2 ring-blue-400'
          )}
        >
          {editing && <DragHandle label={`اسحب باقة ${pkg.label}`} onArm={() => setArmed(key)} />}
          <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', tone.icon)}>
            <Layers size={20} />
          </span>
          <button
            type="button"
            onClick={() => !editing && toggle(pkg.id)}
            aria-expanded={!isCollapsed}
            className="min-w-0 flex-1 text-start"
            disabled={editing}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              <bdi dir="auto" className="min-w-0 truncate text-[17px] font-black tracking-tight text-slate-900 sm:text-[18px]">
                {pkg.label}
              </bdi>
              <span className={cx('shrink-0 rounded-full border px-2.5 py-0.5 text-[12px] font-bold tabular-nums', tone.soft, tone.border, tone.text)}>
                {all.length} {all.length === 1 ? 'كورس' : 'كورسات'}
              </span>
              {pkg.hiddenInSchedule && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-white">
                  <EyeOff size={11} /> مخفية من الجدول
                </span>
              )}
            </span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-600">
              <StatusSummary counts={counts} />
              {names.length > 0 && (
                <span dir="auto" className="hidden min-w-0 truncate text-slate-500 md:inline">
                  {names.join(' • ')}
                  {all.length > names.length ? ' …' : ''}
                </span>
              )}
            </span>
            {pkg.description && <span className="mt-1 block truncate text-[12.5px] text-slate-500">{pkg.description}</span>}
          </button>
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setDialog({ kind: 'addCourse', packageId: pkg.id, groupId: null, label: pkg.label })}
                className="hidden shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[12.5px] font-bold text-blue-700 shadow-sm ring-1 ring-slate-200 hover:bg-blue-50 sm:inline-flex"
              >
                <Plus size={14} /> كورس
              </button>
              <ActionMenu items={menu} label={`إجراءات باقة ${pkg.label}`} tone="dark" />
            </>
          ) : (
            <button
              type="button"
              onClick={() => toggle(pkg.id)}
              aria-label={isCollapsed ? `افتح ${pkg.label}` : `اقفل ${pkg.label}`}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/80 text-slate-600 shadow-sm ring-1 ring-slate-200 hover:text-slate-900"
            >
              <ChevronDown size={18} className={cx('transition-transform', isCollapsed && 'rotate-90 rtl:-rotate-90')} />
            </button>
          )}
        </header>

        {!isCollapsed && (
          <div className="mt-3 grid min-w-0 gap-4">
            {editing && stale.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {stale.map((ref) => (
                  <li key={ref.eventId} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12px] font-semibold text-rose-800">
                    مش موجود في أودو: #{ref.eventId}
                    {ref.code ? ` (كود ${ref.code})` : ''}
                    <button
                      type="button"
                      onClick={() => {
                        editor.apply((l) => Layout.removeReferences(l, [ref.eventId]));
                        editor.removeStale([ref.eventId]);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-0.5 font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                    >
                      <X size={12} /> شيله
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {entry.direct.length > 0 && courseGrid(entry.direct, { packageId: pkg.id, groupId: null })}
            {editing && entry.direct.length === 0 && pkg.groups.length === 0 && dropZone(`${key}:empty`, { packageId: pkg.id, groupId: null }, 'الباقة فاضية — اسحب كورس هنا أو اضغط «+ كورس»')}
            {entry.groups.map(({ group, rows: groupRows }, groupIndex) => {
              const gKey = `g:${group.id}`;
              const gMenu: MenuItem[] = [
                { label: 'غيّر الاسم', icon: <Pencil size={15} />, onClick: () => setDialog({ kind: 'renameGroup', groupId: group.id, label: group.label }) },
                { label: 'لفوق', icon: <ArrowUp size={15} />, disabled: groupIndex === 0, onClick: () => editor.apply((l) => Layout.moveGroupStep(l, group.id, -1)) },
                { label: 'لتحت', icon: <ArrowDown size={15} />, disabled: groupIndex >= pkg.groups.length - 1, onClick: () => editor.apply((l) => Layout.moveGroupStep(l, group.id, 1)) },
                'divider',
                { label: 'شيل المستوى (الكورسات تفضل في الباقة)', icon: <Trash2 size={15} />, danger: true, onClick: () => setDialog({ kind: 'deleteGroup', groupId: group.id, label: group.label }) },
              ];
              return (
                <div
                  key={group.id}
                  draggable={armed === gKey}
                  onDragStart={(event) => {
                    if (event.target !== event.currentTarget) return;
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', group.id);
                    setDrag({ kind: 'group', id: group.id });
                  }}
                  onDragEnd={endDrag}
                  className={cx('relative grid min-w-0 gap-2.5', drag?.kind === 'group' && drag.id === group.id && 'opacity-40')}
                >
                  {hover?.key === gKey && hover.side === 'before' && <span aria-hidden className="absolute inset-x-2 -top-2 h-1 rounded-full bg-blue-600" />}
                  <div
                    onDragOver={(event) => {
                      if (!drag || drag.kind === 'package' || (drag.kind === 'group' && drag.id === group.id)) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const next: Hover = drag.kind === 'group' ? { key: gKey, side: 'before' } : { key: `${gKey}:into` };
                      if (hover?.key !== next.key || hover.side !== next.side) setHover(next);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (drag?.kind === 'group') {
                        const id = drag.id;
                        editor.apply((l) => Layout.moveGroup(l, id, { packageId: pkg.id, beforeGroupId: group.id }));
                      } else dropCourseAt({ packageId: pkg.id, groupId: group.id }, null);
                      endDrag();
                    }}
                    className={cx('flex min-w-0 items-center gap-2 rounded-xl px-1', hover?.key === `${gKey}:into` && 'bg-blue-100/70 ring-2 ring-blue-400')}
                  >
                    {editing && <DragHandle label={`اسحب ${group.label}`} onArm={() => setArmed(gKey)} />}
                    <span className={cx('inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-extrabold', tone.soft, tone.border, tone.text)}>
                      <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
                      <bdi dir="auto" className="truncate">
                        {group.label}
                      </bdi>
                    </span>
                    <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-500">{groupRows.length}</span>
                    <span aria-hidden className="h-px min-w-4 flex-1 bg-gradient-to-l from-slate-300/80 to-transparent" />
                    {editing && (
                      <>
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: 'addCourse', packageId: pkg.id, groupId: group.id, label: `${pkg.label} › ${group.label}` })}
                          aria-label={`ضيف كورس في ${group.label}`}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-bold text-blue-700 hover:bg-blue-50"
                        >
                          <Plus size={13} /> <span className="hidden sm:inline">كورس</span>
                        </button>
                        <ActionMenu items={gMenu} label={`إجراءات ${group.label}`} />
                      </>
                    )}
                  </div>
                  {groupRows.length > 0
                    ? courseGrid(groupRows, { packageId: pkg.id, groupId: group.id })
                    : editing && dropZone(`${gKey}:empty`, { packageId: pkg.id, groupId: group.id }, 'مفيش كورسات هنا في الفترة دي — اسحب كورس هنا')}
                </div>
              );
            })}
            {editing && entry.elsewhere > 0 && (
              <p className="text-[12px] font-medium text-slate-500">+ {entry.elsewhere} كورس في الباقة دي برّه الفترة أو الفلاتر المعروضة (مكانهم محفوظ).</p>
            )}
          </div>
        )}
      </section>
    );
  };

  /* ── dialogs' subjects ───────────────────────────────────────── */

  const dialogPackage = dialog && 'packageId' in dialog ? packageList.find((pkg) => pkg.id === dialog.packageId) ?? null : null;
  const dialogRow = dialog && 'eventId' in dialog ? rowById.get(dialog.eventId) ?? null : null;
  const dialogPlacement = dialog && 'eventId' in dialog ? index.get(dialog.eventId) ?? null : null;
  const close = () => setDialog(null);

  const onlyDepartment = departments?.length === 1 ? departments[0] : null;

  return (
    <div className="grid min-w-0 gap-5">
      {editing && (
        <EditBanner
          editor={editor}
          onAddPackage={() => setDialog({ kind: 'addPackage', department: onlyDepartment })}
          onReset={() => setDialog({ kind: 'reset' })}
          onCancel={() => (editor.dirty ? setDialog({ kind: 'discard' }) : editor.cancel())}
          onSave={async () => {
            const result = await editor.save();
            if (result.ok) push('اتحدّث ترتيب الجدول.', 'ok');
            else if (result.message) push(result.message, 'bad');
          }}
        />
      )}

      {!editing && editor.canManage && unassigned.length > 0 && (
        <p className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-violet-200 bg-violet-50/80 px-4 py-2.5 text-[13px] font-semibold text-violet-900">
          <Sparkles size={16} className="shrink-0 text-violet-600" />
          {unassigned.length} {unassigned.length === 1 ? 'كورس محتاج' : 'كورسات محتاجة'} تترتّب في باقة.
          <button type="button" onClick={editor.begin} className="ms-auto rounded-lg bg-violet-600 px-3 py-1 text-[12.5px] font-bold text-white hover:bg-violet-700">
            رتّبهم
          </button>
        </p>
      )}

      {editor.saved?.defaultPending && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-semibold text-amber-900">
          مقدرناش نجيب ترتيب الباقات من أودو دلوقتي — الكورسات ظاهرة كلها من غير تقسيم.
        </p>
      )}

      {arranged.departments.map((dept) => (
        <div key={dept.department} className="grid min-w-0 gap-3.5">
          {(departments === null || editing) && (dept.packages.length > 0 || editing) && (
            <DepartmentHeading department={dept.department} count={dept.packages.reduce((sum, p) => sum + p.total, 0)} />
          )}
          {dept.packages.map((entry, i) => renderPackage(entry, dept.department, i, dept.packages.length))}
          {editing && (
            <div
              onDragOver={(event) => {
                if (drag?.kind !== 'package') return;
                event.preventDefault();
                if (hover?.key !== `end:${dept.department}`) setHover({ key: `end:${dept.department}` });
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (drag?.kind === 'package') {
                  const id = drag.id;
                  editor.apply((l) => Layout.movePackage(l, id, { department: dept.department, beforePackageId: null }));
                }
                endDrag();
              }}
              className={cx('rounded-2xl', hover?.key === `end:${dept.department}` && 'ring-2 ring-blue-500')}
            >
              <button
                type="button"
                onClick={() => setDialog({ kind: 'addPackage', department: dept.department })}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-violet-300 bg-white/40 px-4 py-3 text-[13px] font-bold text-violet-700 hover:bg-violet-50"
              >
                <PackagePlus size={16} /> باقة جديدة في {departmentLabel(dept.department)}
              </button>
            </div>
          )}
        </div>
      ))}

      {(unassigned.length > 0 || editing) && (
        <section
          aria-label="كورسات مش في باقة"
          onDragOver={(event) => {
            if (drag?.kind !== 'course') return;
            event.preventDefault();
            if (hover?.key !== 'unassigned') setHover({ key: 'unassigned' });
          }}
          onDrop={(event) => {
            event.preventDefault();
            dropCourseAt(null, null);
            endDrag();
          }}
          className={cx(
            'min-w-0 rounded-3xl border p-3 sm:p-4',
            editing ? 'border-2 border-dashed border-amber-300 bg-amber-50/70' : 'border-slate-200/80 bg-white/50',
            hover?.key === 'unassigned' && 'ring-2 ring-amber-500'
          )}
        >
          <header className="mb-3 flex min-w-0 flex-wrap items-center gap-2.5 px-1">
            <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-2xl', editing ? TONE.amber.icon : TONE.slate.icon)}>
              <Sparkles size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[16px] font-black text-slate-900">{editing ? 'كورسات مش متسكّنة / جديدة' : 'كورسات لسه مش في باقة'}</h3>
              <p className="text-[12.5px] text-slate-600">
                {editing
                  ? 'كورسات موجودة في أودو ومش في أي باقة — اسحبها لباقة، أو اسحب كورس هنا علشان تشيله من باقته.'
                  : 'موجودة في أودو ولسه ماتحطّتش في باقة.'}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-[12px] font-bold tabular-nums text-slate-700 ring-1 ring-slate-200">{unassigned.length}</span>
          </header>
          {unassigned.length > 0 ? courseGrid(unassigned, null) : <p className="px-1 py-3 text-[12.5px] text-slate-500">كل الكورسات المعروضة في باقات.</p>}
        </section>
      )}

      {/* ── dialogs ── */}
      <PackageDialog
        open={dialog?.kind === 'addPackage' || dialog?.kind === 'editPackage'}
        department={dialog?.kind === 'addPackage' ? dialog.department : null}
        initial={dialog?.kind === 'editPackage' && dialogPackage ? { label: dialogPackage.label, accent: dialogPackage.accent, description: dialogPackage.description } : null}
        onClose={close}
        onSubmit={(value) => {
          if (dialog?.kind === 'editPackage' && dialogPackage) {
            editor.apply((l) => Layout.updatePackage(l, dialogPackage.id, value));
          } else {
            editor.apply((l) => Layout.addPackage(l, value.department, value));
          }
          close();
        }}
      />
      <GroupDialog
        open={dialog?.kind === 'addGroup' || dialog?.kind === 'renameGroup'}
        initial={dialog?.kind === 'renameGroup' ? dialog.label : null}
        onClose={close}
        onSubmit={(label) => {
          if (dialog?.kind === 'renameGroup') {
            const id = dialog.groupId;
            editor.apply((l) => Layout.renameGroup(l, id, label));
          } else if (dialog?.kind === 'addGroup') {
            const id = dialog.packageId;
            editor.apply((l) => Layout.addGroup(l, id, label));
          }
          close();
        }}
      />
      <DeletePackageDialog
        open={dialog?.kind === 'deletePackage'}
        label={dialogPackage?.label ?? ''}
        courseCount={dialogPackage ? dialogPackage.courses.length + dialogPackage.groups.reduce((sum, group) => sum + group.courses.length, 0) : 0}
        targets={packageList.filter((pkg) => pkg.id !== dialogPackage?.id).map((pkg) => ({ id: pkg.id, label: pkg.label, department: pkg.department }))}
        onClose={close}
        onSubmit={(moveTo) => {
          if (dialogPackage) {
            const id = dialogPackage.id;
            editor.apply((l) => Layout.deletePackage(l, id, { moveTo }));
          }
          close();
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'deleteGroup'}
        title="شيل المستوى"
        body={
          <>
            المستوى <bdi className="font-bold">{dialog?.kind === 'deleteGroup' ? dialog.label : ''}</bdi> هيتشال، وكورساته هتفضل في نفس الباقة من غير مستوى.
          </>
        }
        confirm="شيل المستوى"
        danger
        onClose={close}
        onConfirm={() => {
          if (dialog?.kind === 'deleteGroup') {
            const id = dialog.groupId;
            editor.apply((l) => Layout.deleteGroup(l, id));
          }
          close();
        }}
      />
      <MoveCourseDialog
        open={dialog?.kind === 'move'}
        courseName={dialogRow?.courseName ?? ''}
        layout={layout}
        current={dialogPlacement ? { packageId: dialogPlacement.packageId, groupId: dialogPlacement.groupId } : null}
        onClose={close}
        onSubmit={(target) => {
          if (dialog?.kind === 'move') {
            const id = dialog.eventId;
            editor.apply((l) => Layout.placeCourse(l, id, target, { code: dialogRow?.courseCode ?? null }));
          }
          close();
        }}
      />
      <DisplayDialog
        open={dialog?.kind === 'display'}
        odooName={dialogRow?.odooName ?? dialogRow?.courseName ?? ''}
        initial={dialogPlacement ? { customLabel: dialogPlacement.customLabel, badge: dialogPlacement.badge, note: dialogPlacement.note } : null}
        onClose={close}
        onSubmit={(value) => {
          if (dialog?.kind === 'display') {
            const id = dialog.eventId;
            editor.apply((l) => Layout.setCourseDisplay(l, id, value));
          }
          close();
        }}
      />
      <AddCourseDialog
        open={dialog?.kind === 'addCourse'}
        target={dialog?.kind === 'addCourse' ? dialog.label : ''}
        rows={allRows}
        onClose={close}
        onPick={(course) => {
          if (dialog?.kind === 'addCourse') {
            const target = { packageId: dialog.packageId, groupId: dialog.groupId };
            editor.apply((l) => Layout.placeCourse(l, course.id, target, { code: course.code }));
          }
          close();
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'reset'}
        title="ترجع للترتيب الأصلي؟"
        body={
          <>
            <p className="font-bold text-rose-700">ده هيمسح كل التعديلات على الباقات والترتيب ويرجّع الترتيب الأصلي (من شيت الجدول).</p>
            <p className="mt-2">أودو مش هيتغيّر خالص — الكورسات زي ما هي.</p>
          </>
        }
        confirm="رجّع الأصلي"
        danger
        onClose={close}
        onConfirm={async () => {
          close();
          const result = await editor.reset();
          if (result.ok) push('رجع ترتيب الجدول للأصلي.', 'ok');
          else if (result.message) push(result.message, 'bad');
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'discard'}
        title="عندك تغييرات مش محفوظة"
        body="لو خرجت دلوقتي، التغييرات اللي عملتها على ترتيب الجدول هتضيع."
        confirm="تجاهل التغييرات"
        cancel="كمّل تعديل"
        danger
        onClose={close}
        onConfirm={() => {
          close();
          editor.cancel();
        }}
      />
    </div>
  );
}

/* ── pieces ──────────────────────────────────────────────────────── */

function countStatuses(rows: PlacedRow[]) {
  const counts: Partial<Record<StatusCanonical, number>> = {};
  for (const row of rows) if (row.statusCanonical) counts[row.statusCanonical] = (counts[row.statusCanonical] ?? 0) + 1;
  return counts;
}

function StatusSummary({ counts }: { counts: Partial<Record<StatusCanonical, number>> }) {
  const order: StatusCanonical[] = ['in_progress', 'planned', 'hold', 'finished', 'canceled'];
  const parts = order.filter((status) => counts[status]);
  if (parts.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      {parts.map((status) => (
        <span key={status} className="inline-flex items-center gap-1 font-semibold">
          <span aria-hidden className={cx('h-2 w-2 rounded-full', TONE[STATUS_TONE[status]].dot)} />
          <span className="tabular-nums text-slate-800">{counts[status]}</span> {STATUS_LABELS[status]}
        </span>
      ))}
    </span>
  );
}

function DepartmentHeading({ department, count }: { department: string; count: number }) {
  const tone = TONE[departmentTone(department)];
  return (
    <div className="flex min-w-0 items-center gap-3 px-1 pt-1">
      <span className={cx('inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[14px] font-black', tone.soft, tone.border, tone.text)}>
        <span aria-hidden className={cx('h-2 w-2 rounded-full', tone.dot)} />
        {departmentLabel(department)}
      </span>
      <span className="text-[12.5px] font-semibold tabular-nums text-slate-500">{count} كورس</span>
      <span aria-hidden className="h-px flex-1 bg-gradient-to-l from-slate-300 to-transparent" />
    </div>
  );
}

function EditBanner({
  editor,
  onAddPackage,
  onReset,
  onCancel,
  onSave,
}: {
  editor: LayoutEditor;
  onAddPackage: () => void;
  onReset: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="تعديل ترتيب الجدول"
      className="relative z-30 sm:sticky sm:top-[calc(var(--topbar-h)+0.75rem)] overflow-hidden rounded-2xl border border-violet-300/70 bg-gradient-to-l from-violet-100/85 via-indigo-50/85 to-amber-50/85 px-4 py-3 shadow-[0_18px_40px_-18px_rgba(76,29,149,0.45),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-violet-900/5 backdrop-blur-xl"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-600/30">
          <Pencil size={18} />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-[15px] font-black text-violet-950">بتعدّل ترتيب الجدول</p>
          <p className="text-[12.5px] leading-relaxed text-violet-900/80">
            اسحب الباقات والكورسات من <GripVertical size={12} className="inline" /> علشان ترتّبها. التغييرات مش هتتنشر غير لما تحفظ — وأودو مش بيتغيّر.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={editor.undo} disabled={!editor.canUndo} title="تراجع (Ctrl/⌘ + Z)" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/80 px-3 text-[12.5px] font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-white disabled:opacity-40">
            <Undo2 size={15} /> تراجع
          </button>
          <button type="button" onClick={onAddPackage} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/80 px-3 text-[12.5px] font-bold text-violet-800 ring-1 ring-violet-200 hover:bg-white">
            <PackagePlus size={15} /> باقة
          </button>
          <button type="button" onClick={onReset} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/60 px-3 text-[12.5px] font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50">
            <RotateCcw size={15} /> الترتيب الأصلي
          </button>
          <span aria-hidden className="mx-1 hidden h-6 w-px bg-violet-300 sm:block" />
          <button type="button" onClick={onCancel} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3.5 text-[13px] font-bold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50">
            إلغاء
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={editor.saving || !editor.dirty || Boolean(editor.conflict)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-l from-violet-600 to-indigo-600 px-4 text-[13px] font-bold text-white shadow-lg shadow-violet-600/30 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50"
          >
            {editor.saving ? <Spinner size={14} /> : <Save size={15} />} احفظ الترتيب
          </button>
        </div>
      </div>
      {editor.conflict && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-800">
          حد تاني عدّل ترتيب الجدول{editor.conflict.updatedBy?.name ? ` (${editor.conflict.updatedBy.name}${editor.conflict.updatedAt ? `، ${agoLabel(editor.conflict.updatedAt)}` : ''})` : ''}. حمّل آخر نسخة قبل ما تحفظ — تعديلاتك الحالية هتضيع.
          <button type="button" onClick={() => void editor.reloadLatest()} className="ms-auto rounded-lg bg-rose-600 px-3 py-1 font-bold text-white hover:bg-rose-700">
            حمّل آخر نسخة
          </button>
        </div>
      )}
      {!editor.dirty && !editor.conflict && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-violet-900/70">
          <Tag size={12} /> مفيش تغييرات لسه.
        </p>
      )}
    </div>
  );
}
