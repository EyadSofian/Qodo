/**
 * The few chart shapes the workspace needs, drawn as plain SVG.
 *
 * No charting library. Everything here is a horizontal bar, a column or a
 * number in a box, and a dependency that ships a whole grammar of graphics to
 * draw a bar is a dependency that also ships its own fonts, tooltips and RTL
 * bugs. These are a hundred lines and they lay out right-to-left because that
 * is the only direction this workspace is read in.
 *
 * Two rules everything here follows, because they are what makes a chart honest
 * rather than decorative:
 *
 * **Magnitude is one hue, darker for more.** These charts compare sizes — how
 * many courses per stage, which instructor carries the most — and that is a
 * sequential job. Giving each bar its own colour would say the categories are
 * different in kind rather than different in size, and buries the one bar that
 * matters under a rainbow.
 *
 * **Every bar is labelled with its own number.** An axis makes the reader
 * estimate; the number tells them. The axis line is therefore recessive and
 * there are no gridlines to count.
 */

import type { ReactNode } from 'react';
import { cx } from '../lib/utils';

/** brand-500 stepped light→dark. More is darker, which is the whole encoding. */
const RAMP = ['#B4D4EF', '#6FA9DA', '#4A8FCB', '#1D6FB8', '#12497A'];

const rampStep = (value: number, max: number) => {
  if (max <= 0) return RAMP[0];
  const index = Math.min(RAMP.length - 1, Math.floor((value / max) * RAMP.length));
  return RAMP[Math.max(0, index)];
};

const arabicNumber = (value: number) => value.toLocaleString('ar-EG');

/* ── stat tiles ──────────────────────────────────────────────────── */

/**
 * A headline number. Deliberately not a one-bar chart: a single current value
 * has no shape to compare, so the number itself is the visualisation.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'plain',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: 'plain' | 'good' | 'warn';
}) {
  return (
    <div className="card flex items-start gap-3 p-4">
      {icon && (
        <span
          className={cx(
            'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
            tone === 'good' && 'bg-status-okBg text-status-ok',
            tone === 'warn' && 'bg-status-warnBg text-accent-600',
            tone === 'plain' && 'bg-brand-50 text-brand-600'
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-ink-muted">{label}</p>
        <p className="mt-0.5 text-[24px] font-extrabold leading-none tabular-nums text-ink">
          {typeof value === 'number' ? arabicNumber(value) : value}
        </p>
        {hint && <p className="mt-1 truncate text-[11.5px] text-ink-faint">{hint}</p>}
      </div>
    </div>
  );
}

/* ── bars ────────────────────────────────────────────────────────── */

export interface BarDatum {
  label: string;
  value: number;
  /** Shown instead of the raw number when the unit matters ("٧٥٪", "٣ ساعات"). */
  display?: string;
}

/**
 * Horizontal bars, which is the right way round for named categories: an
 * instructor's name fits on a row and would be rotated 45° under a column.
 */
export function BarList({
  data,
  empty = 'مفيش بيانات',
  max: fixedMax,
}: {
  data: BarDatum[];
  empty?: string;
  /** Force the scale — used when several charts must be read against each other. */
  max?: number;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-[12.5px] text-ink-faint">{empty}</p>;
  }
  const max = fixedMax ?? Math.max(...data.map((row) => row.value), 1);

  return (
    <ul className="grid gap-2">
      {data.map((row) => (
        <li key={row.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2.5">
          <span className="truncate text-[12.5px] text-ink-muted" title={row.label}>
            {row.label}
          </span>
          {/* The track is the surface, not a second data colour. */}
          <span className="h-5 overflow-hidden rounded-md bg-surface-sunken">
            <span
              className="block h-full rounded-md transition-[width]"
              style={{
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                backgroundColor: rampStep(row.value, max),
              }}
            />
          </span>
          <span className="w-12 text-end text-[12.5px] font-bold tabular-nums text-ink">
            {row.display ?? arabicNumber(row.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Columns, for the one job bars cannot do: time reads left to right (or in RTL,
 * right to left) and a vertical bar per month is how a year is shaped.
 */
export function ColumnChart({ data, empty = 'مفيش بيانات' }: { data: BarDatum[]; empty?: string }) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-[12.5px] text-ink-faint">{empty}</p>;
  }
  const max = Math.max(...data.map((row) => row.value), 1);

  return (
    <div className="flex h-40 items-end gap-1.5" role="img">
      {data.map((row) => (
        <div key={row.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="text-[10.5px] font-bold tabular-nums text-ink-muted">
            {row.value > 0 ? arabicNumber(row.value) : ''}
          </span>
          <div
            className="w-full rounded-t-md transition-[height]"
            style={{
              height: `${Math.max(2, (row.value / max) * 100)}%`,
              backgroundColor: rampStep(row.value, max),
            }}
            title={`${row.label}: ${arabicNumber(row.value)}`}
          />
          <span className="w-full truncate text-center text-[10px] text-ink-faint">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A two-part split — online against in-person, published against draft.
 *
 * The only categorical encoding in here, and it is two slots because two is
 * where colour alone is comfortable for everybody. The pair is the validated
 * blue/orange from the reference palette (adjacent CVD ΔE 24.7), and both
 * segments are labelled anyway so the colour is never the only carrier.
 */
const SPLIT_COLORS = ['#2a78d6', '#eb6834'];

export function SplitBar({ parts }: { parts: { label: string; value: number }[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (total === 0) {
    return <p className="py-6 text-center text-[12.5px] text-ink-faint">مفيش بيانات</p>;
  }

  return (
    <div className="grid gap-2.5">
      {/* 2px surface gaps between segments, so the boundary is a gap not a hue change. */}
      <div className="flex h-6 gap-[2px] overflow-hidden rounded-lg">
        {parts.map((part, index) => (
          <span
            key={part.label}
            className="h-full first:rounded-s-lg last:rounded-e-lg"
            style={{
              width: `${(part.value / total) * 100}%`,
              backgroundColor: SPLIT_COLORS[index % SPLIT_COLORS.length],
            }}
            title={`${part.label}: ${arabicNumber(part.value)}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((part, index) => (
          <li key={part.label} className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: SPLIT_COLORS[index % SPLIT_COLORS.length] }}
            />
            {part.label}
            <b className="tabular-nums text-ink">{arabicNumber(part.value)}</b>
            <span className="text-ink-faint">({Math.round((part.value / total) * 100)}٪)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A single ratio against its limit. A meter, not a pie of two slices. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12.5px] text-ink-muted">{label}</span>
        <span className="text-[13px] font-extrabold tabular-nums text-ink">{pct}٪</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, backgroundColor: rampStep(pct, 100) }}
        />
      </div>
    </div>
  );
}

/** A titled box. Charts need a name and a sentence saying what to read from them. */
export function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="card p-4">
      <h3 className="text-[13.5px] font-bold text-ink">{title}</h3>
      {hint && <p className="mb-3 mt-0.5 text-[11.5px] text-ink-faint">{hint}</p>}
      <div className={cx(!hint && 'mt-3')}>{children}</div>
    </section>
  );
}
