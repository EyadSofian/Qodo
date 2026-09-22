/**
 * Filters and the course list over one set of rows — shared by the Schedule
 * and the Archive, which differ only in how their rows are fetched.
 *
 * Everything here runs in the browser over rows already loaded: switching a
 * department, a quick filter or the view never asks Odoo anything. The chosen
 * department and view are remembered per browser; that is a convenience, and
 * the page works identically without it.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, Inbox, Info } from 'lucide-react';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  departmentCounts,
  resolveViewMode,
  sortRows,
} from '@shared/eventsSchedule';
import { agoLabel, type ScheduleMeta, type TrainingScheduleRow } from '../../lib/eventsSchedule';
import { EmptyState } from '../ui';
import { CourseCard, CourseListRow } from './CourseCard';
import {
  ClearFilters,
  DepartmentTabs,
  FilterPanel,
  FiltersButton,
  QuickFilters,
  SearchBox,
  ViewModeSwitch,
  type ScheduleFilters,
} from './ScheduleToolbar';

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

/** The compact list needs room for its columns; below this it is cards. */
function useWideScreen() {
  const query = '(min-width: 640px)';
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

export function CourseListSkeleton({ view = 'cards' }: { view?: string }) {
  if (view === 'list') {
    return (
      <div className="overflow-hidden rounded-2xl border border-surface-line bg-white" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-surface-line px-4 py-3.5 last:border-b-0">
            <div className="h-3.5 flex-[2.2] animate-pulse rounded bg-surface-sunken" />
            <div className="hidden h-3 flex-1 animate-pulse rounded bg-surface-sunken sm:block" />
            <div className="hidden h-3 flex-[1.4] animate-pulse rounded bg-surface-sunken lg:block" />
            <div className="h-5 w-20 shrink-0 animate-pulse rounded-full bg-surface-sunken" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-[232px] animate-pulse rounded-2xl border border-surface-line bg-white" />
      ))}
    </div>
  );
}

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
  // History is denser and read in bulk, so it opens as a list.
  const [view, setView] = useState<string>(() => resolveViewMode(saved.view ?? (archive ? 'list' : 'cards')));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const wide = useWideScreen();
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

  const filterCount = activeFilterCount(archive ? { ...filters, showClosed: false } : filters);
  const warnings = (meta?.warnings ?? []).filter((warning) => WARNING_TEXT[warning]);
  const schemaNotes = [
    ...(meta?.missingFields?.length ? [`حقول ناقصة في أودو: ${meta.missingFields.join(', ')}`] : []),
    ...(meta?.warnings ?? []).filter((warning) => !WARNING_TEXT[warning]),
  ];

  const clear = () => setFilters({ ...EMPTY_FILTERS, department: filters.department, showClosed: Boolean(archive) });

  return (
    <div className="grid min-w-0 gap-3">
      <DepartmentTabs value={filters.department} counts={counts} onChange={(department) => setFilters({ ...filters, department })} />

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SearchBox
          value={filters.search}
          onChange={(search) => setFilters({ ...filters, search })}
          placeholder="دوّر بالكورس، الكود، المدرّب، الباقة، الكوردينيتور…"
        />
        {rangeControl}
        <FiltersButton count={filterCount} open={filtersOpen} onToggle={() => setFiltersOpen(!filtersOpen)} />
        {wide && <ViewModeSwitch value={view} onChange={setView} />}
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
            إعداد حقول أودو مش كامل — بعض البيانات هتظهر ناقصة
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
        <CourseListSkeleton view={view} />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Inbox size={26} />}
            title={rows.length === 0 ? (archive ? 'مفيش كورسات منتهية في الفترة دي' : 'مفيش كورسات في الفترة دي') : 'مفيش كورسات مطابقة للفلاتر'}
            body={
              rows.length === 0
                ? 'جرّب فترة أوسع أو غيّر السنة.'
                : 'غيّر القسم أو الحالة أو الفترة، أو امسح الفلاتر وابدأ من أول.'
            }
            action={
              rows.length > 0 ? (
                <button type="button" className="btn-ghost btn-sm" onClick={clear}>
                  امسح الفلاتر
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {view === 'list' && wide ? (
            <div className="overflow-hidden rounded-2xl border border-surface-line bg-white shadow-[0_1px_2px_rgba(11,37,69,0.04)]">
              {filtered.map((row) => (
                <CourseListRow key={row.id} row={row} now={now} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <div className="grid min-w-0 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {filtered.map((row) => (
                <CourseCard key={row.id} row={row} now={now} onOpen={onOpen} />
              ))}
            </div>
          )}
        </div>
      )}
      {footer}
    </div>
  );
}
