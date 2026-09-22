/**
 * Filters, presets and the grid over one set of rows — shared by the Schedule
 * and the Archive, which differ only in how their rows are fetched.
 *
 * Everything here runs in the browser over rows already loaded: switching a
 * department tab, a quick filter or a view never asks Odoo anything. The
 * person's department, view and hidden columns are remembered per browser;
 * that is a convenience, and the page works identically without it.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, Inbox, Info } from 'lucide-react';
import {
  EMPTY_FILTERS,
  VIEW_PRESETS,
  activeFilterCount,
  applyFilters,
  departmentCounts,
  departmentPreset,
  maxSessionCount,
  resolveView,
  sortRows,
  visibleColumns,
} from '@shared/eventsSchedule';
import { agoLabel, type ScheduleMeta, type TrainingScheduleRow } from '../../lib/eventsSchedule';
import { EmptyState } from '../ui';
import { ScheduleMobileList } from './ScheduleMobileList';
import { ScheduleTable, ScheduleTableSkeleton, type SortState } from './ScheduleTable';
import {
  ClearFilters,
  ColumnsMenu,
  DepartmentTabs,
  FilterPanel,
  FiltersButton,
  QuickFilters,
  SearchBox,
  ViewSwitcher,
  type ScheduleFilters,
} from './ScheduleToolbar';

type Saved = { department?: string; view?: string; hidden?: Record<string, string[]> };

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

function useWideScreen() {
  const query = '(min-width: 768px)';
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
}

const WARNING_TEXT: Record<string, string> = {
  events_truncated: 'النطاق فيه كورسات أكتر من الحد المسموح في طلب واحد — ضيّق الفترة علشان تشوفهم كلهم.',
  sessions_truncated: 'عدد المحاضرات في النطاق ده كبير، وممكن بعض الكورسات تظهر بمحاضرات ناقصة. ضيّق الفترة.',
};

export function ScheduleWorkspace({
  storageKey,
  rows,
  meta,
  loading,
  stale,
  fetchedAt,
  onOpen,
  rangeControl,
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
  onOpen: (id: number) => void;
  rangeControl: ReactNode;
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
  const [view, setView] = useState<string>(saved.view ?? 'auto');
  const [hiddenByView, setHiddenByView] = useState<Record<string, string[]>>(saved.hidden ?? {});
  // History reads newest first; the live schedule keeps its status-first order.
  const [sort, setSort] = useState<SortState>(archive ? { key: 'start', dir: 'desc' } : null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const wide = useWideScreen();
  const now = useMemo(() => new Date(), [rows]);

  useEffect(() => {
    writeSaved(storageKey, { department: filters.department, view, hidden: hiddenByView });
  }, [storageKey, filters.department, view, hiddenByView]);

  useEffect(() => {
    if (!onSearch) return;
    const timer = window.setTimeout(() => onSearch(filters.search.trim()), 450);
    return () => window.clearTimeout(timer);
  }, [filters.search, onSearch]);

  const preset = departmentPreset(filters.department);
  const activeView = resolveView(view, filters.department);
  const hidden = hiddenByView[activeView] ?? [];

  const filtered = useMemo(() => (rows ? sortRows(applyFilters(rows, filters, now), sort) : []), [rows, filters, sort, now]);
  const counts = useMemo(() => (rows ? departmentCounts(rows, filters, now) : null), [rows, filters, now]);
  const columns = useMemo(
    () => visibleColumns(activeView, { hidden, sessionCount: maxSessionCount(filtered) }),
    [activeView, hidden, filtered]
  );
  const filterCount = activeFilterCount(archive ? { ...filters, showClosed: false } : filters);
  const coordinatorKnown = Boolean(meta?.discoveredFields?.coordinator);
  const warnings = (meta?.warnings ?? []).filter((warning) => WARNING_TEXT[warning]);
  const schemaNotes = [
    ...(meta?.missingFields?.length ? [`حقول ناقصة في أودو: ${meta.missingFields.join(', ')}`] : []),
    ...(meta?.warnings ?? []).filter((warning) => !WARNING_TEXT[warning]),
  ];

  const clear = () => setFilters({ ...EMPTY_FILTERS, department: filters.department, showClosed: Boolean(archive) });

  return (
    <div className="grid gap-3">
      <DepartmentTabs value={filters.department} counts={counts} onChange={(department) => setFilters({ ...filters, department })} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={filters.search}
          onChange={(search) => setFilters({ ...filters, search })}
          placeholder="دوّر بالكورس، الكود، المدرّب، الباقة، الكوردينيتور…"
        />
        {rangeControl}
        <FiltersButton count={filterCount} open={filtersOpen} onToggle={() => setFiltersOpen(!filtersOpen)} />
        {wide && (
          <>
            <ViewSwitcher value={activeView} special={preset.view} onChange={setView} />
            <ColumnsMenu view={activeView} hidden={hidden} onChange={(next) => setHiddenByView({ ...hiddenByView, [activeView]: next })} />
          </>
        )}
      </div>

      {filtersOpen && <FilterPanel filters={filters} onChange={setFilters} meta={meta} showStatus />}

      {!archive && (
        <QuickFilters value={filters.quick} onChange={(quick) => setFilters({ ...filters, quick })} discoveredFields={meta?.discoveredFields} />
      )}

      {stale && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-accent-100 bg-status-warnBg px-3.5 py-2.5 text-[12.5px] font-semibold text-accent-700">
          <AlertCircle size={15} className="shrink-0" />
          أودو مش متاح دلوقتي. بنعرض آخر مزامنة ناجحة {agoLabel(fetchedAt)} — الأرقام ممكن تكون اتغيرت.
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="flex items-center gap-2 rounded-xl bg-status-warnBg px-3.5 py-2 text-[12px] font-semibold text-accent-700">
          <AlertCircle size={14} className="shrink-0" />
          {WARNING_TEXT[warning]}
        </p>
      ))}
      {schemaNotes.length > 0 && (
        <details className="rounded-xl border border-surface-line bg-white/70 px-3.5 py-2 text-[12px] text-ink-muted">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
            <Info size={14} className="text-brand-500" />
            إعداد حقول أودو مش كامل — بعض الأعمدة هتظهر فاضية
          </summary>
          <ul className="mt-1.5 grid gap-0.5 ps-6 font-mono text-[11px]" dir="ltr">
            {schemaNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-muted">
        <span>
          {rows ? (
            <>
              <b className="tabular-nums text-ink">{filtered.length.toLocaleString('en-US')}</b> كورس
              {filtered.length !== rows.length && <> من {rows.length.toLocaleString('en-US')}</>}
              {!archive && !filters.showClosed && !filters.status.length && ' · المنتهي والملغي مخفي'}
            </>
          ) : (
            'جارٍ التحميل…'
          )}
        </span>
        <ClearFilters count={filterCount + (filters.search ? 1 : 0)} onClear={clear} />
      </div>

      {!rows ? (
        <ScheduleTableSkeleton />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Inbox size={26} />}
            title={rows.length === 0 ? (archive ? 'مفيش كورسات منتهية في الفترة دي' : 'مفيش كورسات في الفترة دي') : 'مفيش كورسات مطابقة للفلاتر'}
            body={rows.length === 0 ? 'جرّب فترة أوسع.' : 'غيّر القسم أو امسح الفلاتر.'}
            action={
              rows.length > 0 ? (
                <button type="button" className="btn-ghost btn-sm" onClick={clear}>
                  امسح الفلاتر
                </button>
              ) : undefined
            }
          />
        </div>
      ) : wide ? (
        <ScheduleTable
          rows={filtered}
          columns={columns}
          grouped={Boolean(VIEW_PRESETS[activeView as keyof typeof VIEW_PRESETS]?.grouped)}
          groupLabel={preset.groupLabel}
          labels={VIEW_PRESETS[activeView as keyof typeof VIEW_PRESETS]?.labels}
          sort={sort}
          onSort={setSort}
          onOpen={onOpen}
          now={now}
          coordinatorKnown={coordinatorKnown}
          dimmed={loading}
        />
      ) : (
        <ScheduleMobileList rows={filtered} onOpen={onOpen} />
      )}
      {footer}
    </div>
  );
}
