/**
 * Everything that narrows the course list, in the order it is reached for:
 * department, then search and the three filters people actually use (status,
 * type, instructor), then the date range, then everything else folded behind
 * one "فلاتر" button that says how many of its filters are on.
 *
 * All of it filters rows already loaded; only the date range asks Odoo.
 */

import { useEffect, useRef, useState } from 'react';
import { CalendarRange, LayoutGrid, Rows3, Search, SlidersHorizontal, X } from 'lucide-react';
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

const plain = (values: string[] = []) => values.map((value) => ({ value, label: value }));
const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/* ── departments ─────────────────────────────────────────────────── */

export function DepartmentChips({
  value,
  counts,
  onChange,
}: {
  value: string;
  /** Null while loading: a 0 would claim a department is empty before we know. */
  counts: Record<string, number> | null;
  onChange: (key: string) => void;
}) {
  return (
    <div role="tablist" aria-label="القسم" className="no-scrollbar -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 py-0.5">
      {DEPARTMENT_PRESETS.map((preset) => {
        const active = preset.key === value;
        const count = counts?.[preset.key];
        return (
          <button
            key={preset.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(preset.key)}
            className={cx(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400',
              active
                ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
                : 'border-surface-line bg-white text-ink hover:border-brand-200 hover:bg-brand-50/40'
            )}
          >
            {preset.label}
            {count !== undefined && (
              <span
                className={cx(
                  'min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums',
                  active ? 'bg-white/20 text-white' : 'bg-surface-sunken text-ink-muted'
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── search + inline selects ─────────────────────────────────────── */

export function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const label = 'دوّر بالكورس، المدرّب، أو الكود…';
  return (
    <div className="relative w-full min-w-0 lg:w-auto lg:flex-1 lg:min-w-[260px]">
      <Search size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input
        type="search"
        className="h-10 w-full rounded-xl border border-surface-line bg-white pe-3 ps-10 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
      />
    </div>
  );
}

/** A select that reads as a filter pill: its name when empty, its value when set. */
function PillSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const active = value !== '';
  return (
    <label className="relative shrink-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={options.length === 0}
        className={cx(
          'h-10 max-w-[14rem] cursor-pointer appearance-none truncate rounded-xl border bg-white pe-8 ps-3.5 text-[13px] font-semibold transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50',
          active ? 'border-brand-300 bg-brand-50/60 text-brand-700' : 'border-surface-line text-ink hover:border-brand-200'
        )}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none absolute end-3 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint">
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

export function StatusSelect({ filters, onChange }: { filters: ScheduleFilters; onChange: (next: ScheduleFilters) => void }) {
  return (
    <PillSelect
      label="الحالة"
      value={filters.status.length === 1 ? filters.status[0] : ''}
      options={STATUS_ORDER.map((status) => ({ value: status, label: STATUS_LABELS[status as keyof typeof STATUS_LABELS] }))}
      onChange={(status) => onChange({ ...filters, status: status ? [status] : [] })}
    />
  );
}

export function TypeSelect({ filters, onChange, meta }: { filters: ScheduleFilters; onChange: (next: ScheduleFilters) => void; meta: ScheduleMeta | null }) {
  return <PillSelect label="النوع" value={filters.type} options={plain(meta?.availableTypes)} onChange={(type) => onChange({ ...filters, type })} />;
}

export function InstructorSelect({ filters, onChange, meta }: { filters: ScheduleFilters; onChange: (next: ScheduleFilters) => void; meta: ScheduleMeta | null }) {
  return (
    <PillSelect
      label="المدرّب"
      value={filters.instructor}
      options={plain(meta?.availableInstructors)}
      onChange={(instructor) => onChange({ ...filters, instructor })}
    />
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
  useEffect(() => {
    setDraft(range);
  }, [range]);
  const invalid = !draft.from || !draft.to || draft.from > draft.to;
  const tooLong = !invalid && rangeDays(draft) > SCHEDULE_MAX_DAYS;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative shrink-0">
        <span className="sr-only">الفترة</span>
        <CalendarRange size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <select
          className="h-10 cursor-pointer appearance-none rounded-xl border border-surface-line bg-white pe-3.5 ps-9 text-[13px] font-semibold text-ink hover:border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-100"
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
          <input type="date" aria-label="من" className="field !h-10 !w-auto !py-1.5 text-[12.5px]" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="text-ink-faint">←</span>
          <input type="date" aria-label="إلى" className="field !h-10 !w-auto !py-1.5 text-[12.5px]" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <button type="submit" className="btn-navy btn-sm" disabled={invalid || tooLong || loading}>
            عرض
          </button>
          {tooLong && <span className="text-[11.5px] font-semibold text-status-bad">أقصى مدة {SCHEDULE_MAX_DAYS} يوم</span>}
        </form>
      )}
    </div>
  );
}

/* ── the "فلاتر" popover ─────────────────────────────────────────── */

/** How many of the popover's own filters are on — the badge on its button. */
export function popoverFilterCount(filters: ScheduleFilters, primaryQuick: Set<string>) {
  let count = 0;
  for (const key of ['delivery', 'group', 'coordinator'] as const) if (filters[key]) count += 1;
  if (filters.workDays.length) count += 1;
  if (filters.status.length > 1) count += 1;
  if (filters.quick && !primaryQuick.has(filters.quick)) count += 1;
  return count;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11.5px] font-bold text-ink-muted">{label}</span>
      {children}
    </div>
  );
}

function PlainSelect({
  value,
  options,
  onChange,
  emptyLabel = 'الكل',
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  emptyLabel?: string;
}) {
  return (
    <select className="field !py-2 text-[13px]" value={value} disabled={options.length === 0} onChange={(event) => onChange(event.target.value)}>
      <option value="">{options.length === 0 ? 'مش موجود في أودو' : emptyLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function FiltersPopover({
  filters,
  onChange,
  meta,
  archive,
}: {
  filters: ScheduleFilters;
  onChange: (next: ScheduleFilters) => void;
  meta: ScheduleMeta | null;
  archive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const set = <K extends keyof ScheduleFilters>(key: K, value: ScheduleFilters[K]) => onChange({ ...filters, [key]: value });

  const quick = availableQuickFilters(meta?.discoveredFields ?? {});
  const primary = new Set(quick.filter((f) => f.primary).map((f) => f.key));
  const alerts = quick.filter((f) => !f.primary);
  const count = popoverFilterCount(filters, primary) + (!archive && filters.showClosed ? 1 : 0);
  const groups = [...new Set([...(meta?.availablePackages ?? []), ...(meta?.availableSections ?? [])])].sort();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cx(
          'inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-semibold transition-colors',
          open || count > 0 ? 'border-brand-300 bg-brand-50/60 text-brand-700' : 'border-surface-line bg-white text-ink hover:border-brand-200'
        )}
      >
        <SlidersHorizontal size={15} />
        فلاتر
        {count > 0 && <span className="rounded-full bg-brand-500 px-1.5 text-[11px] font-bold tabular-nums text-white">{count}</span>}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="فلاتر إضافية"
          className="absolute end-0 top-full z-40 mt-2 w-[min(92vw,26rem)] rounded-2xl border border-surface-line bg-white p-4 shadow-lift animate-pop-in"
        >
          <div className="grid gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="طريقة الحضور">
                <PlainSelect
                  value={filters.delivery}
                  options={[
                    { value: 'online', label: 'أونلاين' },
                    { value: 'offline', label: 'حضوري' },
                  ]}
                  onChange={(v) => set('delivery', v)}
                />
              </Field>
              <Field label="الكوردينيتور">
                <PlainSelect value={filters.coordinator} options={plain(meta?.availableCoordinators)} onChange={(v) => set('coordinator', v)} />
              </Field>
            </div>
            <Field label="الباقة / السكشن">
              <PlainSelect value={filters.group} options={plain(groups)} onChange={(v) => set('group', v)} />
            </Field>

            <Field label="أيام الدراسة">
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(WEEKDAY_AR).map((day) => {
                  const on = filters.workDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set('workDays', toggle(filters.workDays, day))}
                      className={cx(
                        'rounded-lg border px-2.5 py-1 text-[12px] font-semibold',
                        on ? 'border-brand-500 bg-brand-500 text-white' : 'border-surface-line bg-white text-ink-muted hover:text-ink'
                      )}
                    >
                      {WEEKDAY_AR[day]}
                    </button>
                  );
                })}
              </div>
            </Field>

            {alerts.length > 0 && (
              <Field label="تنبيهات تانية">
                <div className="flex flex-wrap gap-1.5">
                  {alerts.map((alert) => {
                    const on = filters.quick === alert.key;
                    return (
                      <button
                        key={alert.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set('quick', on ? '' : alert.key)}
                        className={cx(
                          'rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                          on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-surface-line bg-white text-ink-muted hover:text-ink'
                        )}
                      >
                        {alert.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}

            {!archive && (
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-ink-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#1D6FB8]"
                  checked={filters.showClosed}
                  onChange={(event) => set('showClosed', event.target.checked)}
                />
                اعرض الكورسات المنتهية والملغية
              </label>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-surface-line pt-3">
            <button
              type="button"
              className="text-[12.5px] font-semibold text-ink-muted hover:text-ink"
              onClick={() =>
                onChange({ ...filters, delivery: '', coordinator: '', group: '', workDays: [], showClosed: Boolean(archive), quick: primary.has(filters.quick) ? filters.quick : '' })
              }
            >
              امسح دول
            </button>
            <button type="button" className="btn-navy btn-sm" onClick={() => setOpen(false)}>
              تمام
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── smart filters + view ────────────────────────────────────────── */

export function SmartFilters({
  value,
  onChange,
  discoveredFields,
}: {
  value: string;
  onChange: (key: string) => void;
  discoveredFields: Record<string, string | null> | undefined;
}) {
  return (
    <div role="group" aria-label="فلاتر سريعة" className="no-scrollbar flex min-w-0 gap-2 overflow-x-auto py-0.5">
      {availableQuickFilters(discoveredFields ?? {})
        .filter((filter) => filter.primary)
        .map((filter) => {
          const on = value === filter.key;
          return (
            <button
              key={filter.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? '' : filter.key)}
              className={cx(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
                on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-surface-line bg-white/70 text-ink-muted hover:border-brand-200 hover:text-ink'
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

type ViewMode = keyof typeof VIEW_LABELS;

export function ViewSwitch({ value, onChange }: { value: string; onChange: (view: string) => void }) {
  return (
    <div role="radiogroup" aria-label="طريقة العرض" className="flex h-10 shrink-0 rounded-xl border border-surface-line bg-white p-1">
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
              'inline-flex items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors',
              on ? 'bg-brand-500 text-white shadow-sm' : 'text-ink-muted hover:text-ink'
            )}
          >
            <Icon size={14} />
            {VIEW_LABELS[mode]}
          </button>
        );
      })}
    </div>
  );
}
