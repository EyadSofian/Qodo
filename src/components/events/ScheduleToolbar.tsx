/**
 * Everything above the course list: departments, search, range, filters, view.
 *
 * Laid out as one primary line (search, range, filters, view) with the filter
 * menus folded away until asked for — a dozen dropdowns open at once is how an
 * operations screen starts to look like a tax form. The badge on "Filters"
 * says how many are narrowing the list, and one button clears them.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { CalendarRange, Filter, LayoutGrid, RotateCcw, Rows3, Search, X } from 'lucide-react';
import {
  DEPARTMENT_PRESETS,
  EMPTY_FILTERS,
  STATUS_LABELS,
  STATUS_ORDER,
  VIEW_LABELS,
  VIEW_MODES,
  availableQuickFilters,
} from '@shared/eventsSchedule';
import {
  SCHEDULE_MAX_DAYS,
  WEEKDAY_AR,
  rangeDays,
  rangeFor,
  type DateRange,
  type RangePreset,
  type ScheduleMeta,
} from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';

export type ScheduleFilters = typeof EMPTY_FILTERS;

const WEEKDAY_CHIPS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];

/* ── department tabs ─────────────────────────────────────────────── */

export function DepartmentTabs({
  value,
  counts,
  onChange,
}: {
  value: string;
  /** Null while loading: a count of 0 would claim a tab is empty before we know. */
  counts: Record<string, number> | null;
  onChange: (key: string) => void;
}) {
  return (
    <div role="tablist" aria-label="القسم" dir="ltr" className="no-scrollbar -mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 pb-0.5">
      {DEPARTMENT_PRESETS.map((preset) => {
        const active = preset.key === value;
        return (
          <button
            key={preset.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(preset.key)}
            className={cx(
              'flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-400',
              active ? 'border-navy bg-navy text-white' : 'border-surface-line bg-white text-ink-muted hover:border-brand-200 hover:text-ink'
            )}
          >
            {preset.label}
            {counts && (
              <span className={cx('rounded-full px-1.5 text-[10.5px] tabular-nums', active ? 'bg-white/20' : 'bg-surface-sunken text-ink-faint')}>
                {counts[preset.key] ?? 0}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── search ──────────────────────────────────────────────────────── */

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:min-w-[220px]">
      <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input
        type="search"
        className="field !py-2 ps-9 text-[13px]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

/* ── date range ──────────────────────────────────────────────────── */

const RANGE_OPTIONS: Array<{ value: RangePreset; label: string }> = [
  { value: 'month', label: 'الشهر ده' },
  { value: 'next30', label: 'الـ30 يوم الجايين' },
  { value: 'next90', label: 'الـ90 يوم الجايين' },
  { value: 'quarter', label: 'الربع الحالي' },
  { value: 'custom', label: 'فترة مخصّصة…' },
];

export function RangePicker({
  preset,
  range,
  onChange,
  loading,
}: {
  preset: RangePreset;
  range: DateRange;
  onChange: (preset: RangePreset, range: DateRange) => void;
  loading?: boolean;
}) {
  const [draft, setDraft] = useState(range);
  useEffect(() => setDraft(range), [range]);
  const days = draft.from && draft.to ? rangeDays(draft) : 0;
  const invalid = !draft.from || !draft.to || draft.from > draft.to;
  const tooLong = !invalid && days > SCHEDULE_MAX_DAYS;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative">
        <span className="sr-only">الفترة</span>
        <CalendarRange size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <select
          className="field !w-auto !py-2 pe-8 ps-9 text-[13px]"
          value={preset}
          onChange={(event) => {
            const next = event.target.value as RangePreset;
            onChange(next, next === 'custom' ? range : rangeFor(next));
          }}
        >
          {RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {preset === 'custom' && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!invalid && !tooLong) onChange('custom', draft);
          }}
        >
          <input type="date" aria-label="من" className="field !w-auto !py-1.5 text-[12.5px]" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="text-ink-faint">←</span>
          <input type="date" aria-label="إلى" className="field !w-auto !py-1.5 text-[12.5px]" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <button type="submit" className="btn-navy btn-sm" disabled={invalid || tooLong || loading}>
            عرض
          </button>
          {tooLong && <span className="text-[11.5px] font-semibold text-status-bad">أقصى مدة {SCHEDULE_MAX_DAYS} يوم</span>}
        </form>
      )}
    </div>
  );
}

/* ── filters ─────────────────────────────────────────────────────── */

function Select({
  label,
  value,
  options,
  onChange,
  disabledHint,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabledHint?: string;
}) {
  const disabled = options.length === 0;
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-[11px] font-bold text-ink-faint">{label}</span>
      <select
        className="field !py-1.5 text-[12.5px]"
        value={value}
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{disabled ? disabledHint ?? '—' : 'الكل'}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const plain = (values: string[] = []) => values.map((value) => ({ value, label: value }));

export function FiltersButton({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="schedule-filters"
      className={cx('btn-ghost btn-sm gap-1.5', open && 'border-brand-300 bg-brand-50')}
    >
      <Filter size={14} />
      فلاتر
      {count > 0 && <span className="rounded-full bg-navy px-1.5 text-[10.5px] font-bold tabular-nums text-white">{count}</span>}
    </button>
  );
}

export function FilterPanel({
  filters,
  onChange,
  meta,
  showStatus = true,
  extra,
}: {
  filters: ScheduleFilters;
  onChange: (next: ScheduleFilters) => void;
  meta: ScheduleMeta | null;
  showStatus?: boolean;
  extra?: ReactNode;
}) {
  const set = <K extends keyof ScheduleFilters>(key: K, value: ScheduleFilters[K]) => onChange({ ...filters, [key]: value });
  const coordinatorKnown = Boolean(meta?.discoveredFields?.coordinator);
  const groups = [...new Set([...(meta?.availablePackages ?? []), ...(meta?.availableSections ?? [])])].sort();
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div id="schedule-filters" className="grid gap-3 rounded-2xl border border-surface-line bg-white/80 p-3.5 shadow-sm backdrop-blur">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <Select label="النوع" value={filters.type} options={plain(meta?.availableTypes)} onChange={(v) => set('type', v)} />
        <Select
          label="طريقة الحضور"
          value={filters.delivery}
          options={[
            { value: 'online', label: 'أونلاين' },
            { value: 'offline', label: 'حضوري' },
          ]}
          onChange={(v) => set('delivery', v)}
        />
        <Select
          label="الباقة / السكشن"
          value={filters.group}
          options={plain(groups)}
          onChange={(v) => set('group', v)}
          disabledHint="مش موجود في أودو"
        />
        <Select label="المدرّب" value={filters.instructor} options={plain(meta?.availableInstructors)} onChange={(v) => set('instructor', v)} />
        <Select
          label="الكوردينيتور"
          value={filters.coordinator}
          options={plain(meta?.availableCoordinators)}
          onChange={(v) => set('coordinator', v)}
          disabledHint={coordinatorKnown ? 'مفيش' : 'مش موجود في أودو'}
        />
        {extra}
      </div>

      {showStatus && (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="mb-1 text-[11px] font-bold text-ink-faint">الحالة</legend>
          {STATUS_ORDER.map((status) => {
            const on = filters.status.includes(status);
            return (
              <button
                key={status}
                type="button"
                aria-pressed={on}
                onClick={() => set('status', toggle(filters.status, status))}
                className={cx(
                  'rounded-lg border px-2.5 py-1 text-[12px] font-semibold',
                  on ? 'border-navy bg-navy text-white' : 'border-surface-line bg-white text-ink-muted hover:text-ink'
                )}
              >
                {STATUS_LABELS[status as keyof typeof STATUS_LABELS]}
              </button>
            );
          })}
          <label className="ms-auto flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-ink-muted">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#0B2545]"
              checked={filters.showClosed}
              onChange={(event) => set('showClosed', event.target.checked)}
            />
            اعرض الكورسات المنتهية والملغية
          </label>
        </fieldset>
      )}

      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="mb-1 text-[11px] font-bold text-ink-faint">أيام الدراسة</legend>
        {WEEKDAY_CHIPS.map((day) => {
          const on = filters.workDays.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              onClick={() => set('workDays', toggle(filters.workDays, day))}
              className={cx(
                'rounded-md border px-2 py-0.5 text-[11.5px] font-bold',
                on ? 'border-navy bg-navy text-white' : 'border-surface-line bg-white text-ink-muted hover:text-ink'
              )}
            >
              {WEEKDAY_AR[day] ?? day}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

export function ClearFilters({ count, onClear }: { count: number; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <button type="button" onClick={onClear} className="btn-quiet btn-sm gap-1 !px-2 text-[12px]">
      <RotateCcw size={13} />
      امسح الفلاتر ({count})
    </button>
  );
}

/* ── quick filters ───────────────────────────────────────────────── */

export function QuickFilters({
  value,
  onChange,
  discoveredFields,
}: {
  value: string;
  onChange: (key: string) => void;
  discoveredFields: Record<string, string | null> | undefined;
}) {
  return (
    <div dir="ltr" className="no-scrollbar flex min-w-0 gap-1.5 overflow-x-auto" role="group" aria-label="فلاتر سريعة">
      {availableQuickFilters(discoveredFields ?? {}).map((filter) => {
        const on = value === filter.key;
        return (
          <button
            key={filter.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? '' : filter.key)}
            className={cx(
              'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
              on ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-transparent bg-surface-sunken text-ink-muted hover:text-ink'
            )}
          >
            {filter.label}
            {on && <X size={12} aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

/* ── view mode ───────────────────────────────────────────────────── */

/**
 * Cards or a compact list — the only two shapes the course list takes.
 * There is no "Excel Full", and no per-column visibility: a screen whose first
 * decision is which of forty columns to hide is a spreadsheet.
 */
type ViewMode = keyof typeof VIEW_LABELS;

export function ViewModeSwitch({ value, onChange }: { value: string; onChange: (view: string) => void }) {
  return (
    <div role="radiogroup" aria-label="طريقة العرض" dir="ltr" className="flex rounded-xl border border-surface-line bg-white p-0.5">
      {(VIEW_MODES as readonly ViewMode[]).map((mode) => {
        const on = mode === value;
        const Icon = mode === 'cards' ? LayoutGrid : Rows3;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={on}
            title={VIEW_LABELS[mode]}
            onClick={() => onChange(mode)}
            className={cx(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
              on ? 'bg-navy text-white shadow-sm' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
            )}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{VIEW_LABELS[mode]}</span>
          </button>
        );
      })}
    </div>
  );
}
