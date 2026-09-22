/**
 * The course dashboard body — filters, the course cards (or list), and the
 * details panel beside them. Shared by the live schedule and the archive,
 * which differ only in how their rows are fetched and which date control
 * sits in the toolbar.
 *
 * Everything here runs over rows already loaded: a department, a filter or a
 * view switch never asks Odoo anything. The chosen department and view are
 * remembered per browser as a convenience; nothing depends on it.
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertCircle, Info, SearchX } from 'lucide-react';
import { EMPTY_FILTERS, activeFilterCount, applyFilters, departmentCounts, resolveViewMode, sortRows } from '@shared/eventsSchedule';
import { agoLabel, type ScheduleMeta, type TrainingScheduleRow } from '../../lib/eventsSchedule';
import { CourseCard, CourseCardSkeleton } from './CourseCard';
import { DockedCourseDetails } from './CourseDetailsDrawer';
import { CourseListRow, CourseListSkeleton } from './CourseListRow';
import { GLASS } from './tones';
import {
  DepartmentChips,
  FiltersPopover,
  InstructorSelect,
  SearchField,
  SmartFilters,
  StatusSelect,
  TypeSelect,
  ViewSwitch,
  type ScheduleFilters,
} from './EventsFilters';

type Saved = { department?: string; view?: string };

function readSaved(key: string): Saved {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function writeSaved(key: string, value: Saved) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage just forget; nothing depends on it.
  }
}

const WARNING_TEXT: Record<string, string> = {
  events_truncated: 'الفترة دي فيها كورسات أكتر من الحد المسموح في طلب واحد — ضيّق الفترة علشان تشوفهم كلهم.',
  sessions_truncated: 'المحاضرات في الفترة دي كتير، وممكن بعض الكورسات تظهر بمحاضرات ناقصة. ضيّق الفترة.',
};

/**
 * Card columns follow the width the grid actually has, not the window: with
 * the details panel docked the same screen holds two cards where it held
 * three. At most `max` columns, none narrower than `min`.
 */
function gridColumns(max: number, min: number): CSSProperties {
  const gap = 16;
  return {
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, max(${min}px, calc((100% - ${(max - 1) * gap}px) / ${max}))), 1fr))`,
    gap,
  };
}

export function CourseWorkspace({
  storageKey,
  rows,
  meta,
  loading,
  stale,
  fetchedAt,
  selectedId,
  onOpen,
  onClose,
  docked,
  version,
  dateControl,
  kpis,
  archive,
  onSearch,
  footer,
}: {
  storageKey: string;
  rows: TrainingScheduleRow[] | null;
  meta: ScheduleMeta | null;
  loading: boolean;
  stale?: boolean;
  fetchedAt?: string;
  selectedId: number | null;
  onOpen: (id: number) => void;
  onClose: () => void;
  /** Wide screen: the details panel sits beside the cards instead of over them. */
  docked: boolean;
  version: number;
  dateControl: ReactNode;
  kpis?: ReactNode;
  /** Archive mode: closed courses are the point, and search also reaches Odoo. */
  archive?: boolean;
  onSearch?: (query: string) => void;
  footer?: ReactNode;
}) {
  const saved = useMemo(() => readSaved(storageKey), [storageKey]);
  const [filters, setFilters] = useState<ScheduleFilters>(() => ({
    ...EMPTY_FILTERS,
    department: saved.department ?? 'all',
    showClosed: Boolean(archive),
  }));
  const [view, setView] = useState<string>(() => resolveViewMode(saved.view ?? 'cards'));
  const now = useMemo(() => new Date(), [rows]);

  useEffect(() => {
    writeSaved(storageKey, { department: filters.department, view });
  }, [storageKey, filters.department, view]);

  useEffect(() => {
    if (!onSearch) return;
    const timer = window.setTimeout(() => onSearch(filters.search.trim()), 450);
    return () => window.clearTimeout(timer);
  }, [filters.search, onSearch]);

  const sort = useMemo(() => (archive ? ({ key: 'start', dir: 'desc' } as const) : null), [archive]);
  const filtered = useMemo(() => (rows ? sortRows(applyFilters(rows, filters, now), sort) : []), [rows, filters, sort, now]);
  const counts = useMemo(() => (rows ? departmentCounts(rows, filters, now) : null), [rows, filters, now]);

  const narrowing = activeFilterCount(archive ? { ...filters, showClosed: false } : filters) + (filters.search ? 1 : 0);
  const warnings = (meta?.warnings ?? []).filter((warning) => WARNING_TEXT[warning]);
  const schemaNotes = [
    ...(meta?.missingFields?.length ? [`حقول ناقصة في أودو: ${meta.missingFields.join(', ')}`] : []),
    ...(meta?.warnings ?? []).filter((warning) => !WARNING_TEXT[warning]),
  ];
  const panelOpen = docked && selectedId !== null;
  const clear = () => setFilters({ ...EMPTY_FILTERS, department: filters.department, showClosed: Boolean(archive) });

  return (
    <div className="grid min-w-0 gap-4">
      {kpis}

      <DepartmentChips value={filters.department} counts={counts} onChange={(department) => setFilters({ ...filters, department })} />

      <section aria-label="البحث والفلاتر" className={`relative z-20 grid min-w-0 gap-3 rounded-2xl p-3.5 ${GLASS}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SearchField value={filters.search} onChange={(search) => setFilters({ ...filters, search })} />
          <StatusSelect filters={filters} onChange={setFilters} />
          <TypeSelect filters={filters} onChange={setFilters} meta={meta} />
          <InstructorSelect filters={filters} onChange={setFilters} meta={meta} />
          {dateControl}
          <FiltersPopover filters={filters} onChange={setFilters} meta={meta} archive={archive} />
          <div className="ms-auto">
            <ViewSwitch value={view} onChange={setView} />
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0 flex-1">
            {!archive && (
              <SmartFilters value={filters.quick} onChange={(quick) => setFilters({ ...filters, quick })} discoveredFields={meta?.discoveredFields} />
            )}
          </div>
          <p className="shrink-0 text-[13px] font-medium text-slate-600">
            {rows ? (
              <>
                <b className="tabular-nums text-slate-900">{filtered.length.toLocaleString('en-US')}</b> كورس
                {filtered.length !== rows.length && <> من {rows.length.toLocaleString('en-US')}</>}
              </>
            ) : (
              'جارٍ التحميل…'
            )}
          </p>
          {narrowing > 0 && (
            <button type="button" onClick={clear} className="shrink-0 rounded-full bg-rose-50 px-3 py-1 text-[12.5px] font-bold text-rose-700 hover:bg-rose-100">
              امسح الفلاتر
            </button>
          )}
        </div>
      </section>

      {stale && rows && (
        <p role="status" className="flex items-center gap-2.5 rounded-2xl border border-amber-300 bg-gradient-to-l from-amber-50 to-orange-50 px-4 py-3 text-[13px] font-bold text-amber-900 shadow-sm">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500 text-white">
            <AlertCircle size={16} />
          </span>
          أودو مش متاح دلوقتي — بنعرض آخر مزامنة ناجحة من أودو ({agoLabel(fetchedAt)}).
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2 text-[12.5px] font-semibold text-amber-800">
          <AlertCircle size={14} className="shrink-0" />
          {WARNING_TEXT[warning]}
        </p>
      ))}
      {schemaNotes.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white/70 px-3.5 py-2 text-[12px] text-slate-600">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
            <Info size={14} className="text-blue-600" />
            إعداد حقول أودو مش كامل — بعض البيانات هتظهر ناقصة
          </summary>
          <ul className="mt-1.5 grid gap-0.5 ps-6 font-mono text-[11px]" dir="ltr">
            {schemaNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex min-w-0 items-start gap-4">
        <div className={loading && rows ? 'min-w-0 flex-1 opacity-60 transition-opacity' : 'min-w-0 flex-1 transition-opacity'}>
          {!rows ? (
            view === 'list' ? (
              <CourseListSkeleton />
            ) : (
              <div className="grid" style={gridColumns(panelOpen ? 2 : 3, panelOpen ? 340 : 440)}>
                {Array.from({ length: 6 }, (_, i) => (
                  <CourseCardSkeleton key={i} />
                ))}
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className={`grid place-items-center rounded-3xl px-6 py-16 text-center ${GLASS}`}>
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-lg shadow-blue-500/30">
                <SearchX size={26} />
              </span>
              <h3 className="mt-4 text-[17px] font-extrabold text-slate-900">
                {rows.length === 0 ? (archive ? 'مفيش كورسات منتهية في الفترة دي' : 'مفيش كورسات في الفترة دي') : 'مفيش كورسات مطابقة'}
              </h3>
              <p className="mt-1 max-w-sm text-[13px] text-slate-600">
                {rows.length === 0 ? 'جرّب فترة أوسع.' : 'مفيش كورسات مطابقة للفلاتر اللي اخترتها.'}
              </p>
              {rows.length > 0 && (
                <button type="button" onClick={clear} className="mt-5 inline-flex h-10 items-center rounded-xl bg-blue-600 px-5 text-[13.5px] font-bold text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700">
                  امسح الفلاتر
                </button>
              )}
            </div>
          ) : view === 'list' ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05),0_12px_32px_-16px_rgba(15,23,42,0.18)]">
              {filtered.map((row) => (
                <CourseListRow key={row.id} row={row} now={now} selected={row.id === selectedId} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <div className="grid" style={gridColumns(panelOpen ? 2 : 3, panelOpen ? 340 : 440)}>
              {filtered.map((row) => (
                <CourseCard key={row.id} row={row} now={now} selected={row.id === selectedId} onOpen={onOpen} />
              ))}
            </div>
          )}
          {footer && <div className="mt-4 grid">{footer}</div>}
        </div>

        {docked && <DockedCourseDetails id={selectedId} version={version} onClose={onClose} />}
      </div>
    </div>
  );
}
