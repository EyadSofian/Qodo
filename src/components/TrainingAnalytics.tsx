import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Check, ExternalLink, SlidersHorizontal } from 'lucide-react';
import type { AnalyticsRange } from '../lib/events';
import { cx } from '../lib/utils';

const DAY_MS = 86_400_000;

const inputDay = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function rangeForDays(days: number): AnalyticsRange {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  return { from: inputDay(from), to: inputDay(to) };
}

export function rangeForCurrentMonth(now = new Date()): AnalyticsRange {
  return {
    from: inputDay(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: inputDay(now),
  };
}

export const DEFAULT_ANALYTICS_RANGE = rangeForCurrentMonth();

const PRESETS = [
  { days: 30, label: '٣٠ يوم' },
  { days: 90, label: '٣ شهور' },
  { days: 180, label: '٦ شهور' },
  { days: 365, label: 'سنة' },
];

export function AnalyticsPeriodPicker({
  value,
  onApply,
  loading,
  basis,
}: {
  value: AnalyticsRange;
  onApply: (range: AnalyticsRange) => void;
  loading?: boolean;
  basis: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const invalid = !draft.from || !draft.to || draft.from > draft.to;
  const dirty = draft.from !== value.from || draft.to !== value.to;

  const activePreset = useMemo(() => {
    const currentMonth = rangeForCurrentMonth();
    if (value.from === currentMonth.from && value.to === currentMonth.to) return 'current-month';
    const from = new Date(`${value.from}T00:00:00`);
    const to = new Date(`${value.to}T00:00:00`);
    const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
    const preset = PRESETS.find((item) => item.days === days);
    return preset ? String(preset.days) : null;
  }, [value]);

  const pickPreset = (days: number) => {
    const range = rangeForDays(days);
    setDraft(range);
    onApply(range);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-line bg-brand-50/55 px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-white text-brand-600 shadow-sm">
          <SlidersHorizontal size={16} />
        </span>
        <div className="me-auto">
          <h2 className="text-[13px] font-extrabold text-ink">فترة التحليل</h2>
          <p className="text-[11px] text-ink-faint">{basis}</p>
        </div>
        <div className="no-scrollbar flex max-w-full gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => {
              const next = rangeForCurrentMonth();
              setDraft(next);
              onApply(next);
            }}
            className={cx(
              'shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold transition-colors',
              activePreset === 'current-month'
                ? 'bg-navy text-white'
                : 'bg-white text-ink-muted hover:bg-surface-sunken'
            )}
          >
            الشهر الحالي
          </button>
          {PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              onClick={() => pickPreset(preset.days)}
              className={cx(
                'shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold transition-colors',
                activePreset === String(preset.days)
                  ? 'bg-navy text-white'
                  : 'bg-white text-ink-muted hover:bg-surface-sunken'
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2.5 px-4 py-3">
        <label className="min-w-[9.5rem] flex-1 sm:max-w-[13rem]">
          <span className="mb-1 block text-[11.5px] font-semibold text-ink-muted">من</span>
          <span className="relative block">
            <CalendarRange
              size={14}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              type="date"
              value={draft.from}
              onChange={(event) => setDraft((range) => ({ ...range, from: event.target.value }))}
              className="field ltr ps-9 text-start"
            />
          </span>
        </label>
        <label className="min-w-[9.5rem] flex-1 sm:max-w-[13rem]">
          <span className="mb-1 block text-[11.5px] font-semibold text-ink-muted">إلى</span>
          <span className="relative block">
            <CalendarRange
              size={14}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              type="date"
              value={draft.to}
              onChange={(event) => setDraft((range) => ({ ...range, to: event.target.value }))}
              className="field ltr ps-9 text-start"
            />
          </span>
        </label>
        <button
          type="button"
          onClick={() => onApply(draft)}
          disabled={invalid || loading || !dirty}
          className="btn-primary btn-sm min-w-[7rem] gap-1.5"
        >
          <Check size={15} />
          تطبيق
        </button>
        {invalid && <p className="w-full text-[11.5px] font-semibold text-status-bad">تاريخ البداية لازم يكون قبل النهاية.</p>}
      </div>
    </section>
  );
}

const arabicNumber = (value: number) => value.toLocaleString('ar-EG');

export function comparisonHint(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return 'المقارنة غير متاحة';
  if (current === previous) return 'نفس الفترة السابقة';
  if (previous === 0) return current > 0 ? 'جديد مقارنةً بالفترة السابقة' : 'لا تغيير';
  const delta = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return `${delta > 0 ? '↑' : '↓'} ${arabicNumber(Math.abs(delta))}٪ عن الفترة السابقة`;
}

export function dateRangeLabel(from: string, to: string): string {
  const format = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${format.format(new Date(`${from}T12:00:00`))} — ${format.format(new Date(`${to}T12:00:00`))}`;
}

export function DemandRanking({
  rows,
  empty,
  primaryLabel,
  secondaryLabel,
}: {
  rows: Array<{ id: number; name: string; primary: number; secondary: number; note?: string; href?: string }>;
  empty: string;
  primaryLabel: string;
  secondaryLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[12.5px] text-ink-faint">{empty}</p>;
  }
  const max = Math.max(...rows.map((row) => row.primary + row.secondary), 1);

  return (
    <ol className="grid gap-2.5">
      {rows.map((row, index) => {
        const total = row.primary + row.secondary;
        return (
          <li key={row.id} className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-lg bg-surface-sunken text-[11px] font-black tabular-nums text-ink-muted">
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {row.href ? (
                    <a
                      href={row.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-1 text-[12.5px] font-bold text-brand-700 hover:underline"
                      title={`${row.name} — افتح في أودو`}
                    >
                      <span className="truncate">{row.name}</span>
                      <ExternalLink size={12} className="shrink-0" />
                    </a>
                  ) : (
                    <p className="truncate text-[12.5px] font-bold text-ink" title={row.name}>{row.name}</p>
                  )}
                  {row.note && <p className="truncate text-[10.5px] text-ink-faint">{row.note}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-[10.5px] font-bold">
                  <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-brand-700">
                    {arabicNumber(row.primary)} {primaryLabel}
                  </span>
                  <span className="rounded-md bg-status-warnBg px-1.5 py-0.5 text-accent-600">
                    {arabicNumber(row.secondary)} {secondaryLabel}
                  </span>
                </div>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <span
                  className="block h-full rounded-full bg-brand-500 transition-[width]"
                  style={{ width: `${total === 0 ? 0 : Math.max(3, (total / max) * 100)}%` }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
