/**
 * The production dashboard's charts, drawn as plain SVG.
 *
 * `src/components/Charts.tsx` is the workspace's own chart kit and its rule is
 * that magnitude is one hue — right for "which instructor taught the most
 * hours", where the categories differ only in size. This module's figures do
 * not: a stage, a status and a course-health state are each a *kind*, and each
 * already owns a colour that the matrix, the badges and the stage cards have
 * been using since the module shipped. So the charts here are categorical, and
 * they reuse those exact colours rather than inventing a palette — a slice of
 * "Changes requested" is the same amber as the chip that says it.
 *
 * Every slice, column and segment still carries its own number in words
 * somewhere on the card. Colour is the index, never the message.
 */

import { useId, type ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/utils';
import type { AssetStatus, CourseHealth } from '../../lib/learningProduction/types';

/**
 * The nine statuses, as colour.
 *
 * Grey for work nobody has started, brand blue while it is being made, indigo
 * while somebody else has it, amber when it has come back, green when it is
 * done — the same five tones `STATUS_META` gives the badges, spread over nine
 * steps so neighbouring states stay apart in a stacked bar.
 */
export const STATUS_HEX: Record<AssetStatus, string> = {
  NOT_STARTED: '#CBD5E1',
  ASSIGNED: '#94A3B8',
  IN_PROGRESS: '#4A8FCB',
  SUBMITTED: '#818CF8',
  UNDER_REVIEW: '#4F46E5',
  CHANGES_REQUESTED: '#F59E0B',
  RESUBMITTED: '#A78BFA',
  APPROVED: '#16A34A',
  LOCKED: '#15803D',
};

export const HEALTH_HEX: Record<CourseHealth, string> = {
  ON_TRACK: '#1D6FB8',
  AT_RISK: '#F59E0B',
  DELAYED: '#DC2626',
  COMPLETED: '#16A34A',
};

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * A ring, with the total in the middle.
 *
 * A ring rather than a pie because the hole is where the one number everybody
 * actually wants goes, and because comparing arc lengths around a common
 * centre is the one thing a pie does better than a bar.
 */
export function Donut({
  slices,
  total,
  caption,
  size = 168,
  thickness = 20,
  layout = 'row',
  legendColumns = 2,
}: {
  slices: Slice[];
  total?: number;
  caption?: ReactNode;
  size?: number;
  thickness?: number;
  /** `stack` puts the key under the ring — for a ring with more legend rows
      than the card is wide enough to set beside it. */
  layout?: 'row' | 'stack';
  /** How many columns that stacked key runs in. Two only when the labels are
      short enough to survive it; Arabic status names mostly are not. */
  legendColumns?: 1 | 2;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const sum = slices.reduce((count, slice) => count + slice.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const shown = slices.filter((slice) => slice.value > 0);

  let offset = 0;
  return (
    <div className={cx(layout === 'stack' ? 'flex flex-col items-center gap-3' : 'flex items-center gap-4')}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby={titleId} className="shrink-0">
        <title id={titleId}>{shown.map((slice) => `${slice.label}: ${slice.value}`).join('، ')}</title>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#EEF3F9" strokeWidth={thickness} />
        {sum > 0 &&
          shown.map((slice) => {
            const length = (slice.value / sum) * circumference;
            const dash = `${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}`;
            const element = (
              <circle
                key={slice.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={thickness}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                // Twelve o'clock, clockwise, in both reading directions: a ring
                // that flipped with the page would put "done" on the other side.
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += length;
            return element;
          })}
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="fill-ink" style={{ fontSize: size / 5, fontWeight: 800 }}>
          {total ?? sum}
        </text>
        {caption && (
          <text x="50%" y="63%" textAnchor="middle" dominantBaseline="middle" className="fill-ink-faint" style={{ fontSize: size / 13, fontWeight: 600 }}>
            {caption}
          </text>
        )}
      </svg>
      <ul
        className={cx(
          'min-w-0 space-y-1.5',
          layout === 'stack' ? cx('grid w-full gap-x-4 gap-y-1 space-y-0', legendColumns === 2 ? 'grid-cols-2' : 'grid-cols-1') : 'flex-1'
        )}
      >
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2 text-[12px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: slice.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-ink-muted" title={slice.label}>
              {slice.label}
            </span>
            <span className="font-bold tabular-nums text-ink">{slice.value}</span>
            {/* The share is what the ring is already saying; in a two-column key
                it is the column that pushes the label into an ellipsis. */}
            {!(layout === 'stack' && legendColumns === 2) && (
              <span className="w-9 text-end tabular-nums text-ink-faint">{sum ? Math.round((slice.value / sum) * 100) : 0}%</span>
            )}
          </li>
        ))}
        {sum === 0 && <li className="text-[12.5px] text-ink-faint">{t('lp.charts.noData')}</li>}
      </ul>
    </div>
  );
}

/** One bar cut into its parts, for a whole that is worth seeing as a whole. */
export function StackedBar({ slices, className, height = 'h-3' }: { slices: Slice[]; className?: string; height?: string }) {
  const sum = slices.reduce((count, slice) => count + slice.value, 0);
  if (sum === 0) return <div className={cx('w-full rounded-full bg-surface-sunken', height, className)} />;
  return (
    <div className={cx('flex w-full gap-[2px] overflow-hidden rounded-full', height, className)}>
      {slices
        .filter((slice) => slice.value > 0)
        .map((slice) => (
          <span
            key={slice.key}
            className="h-full first:rounded-s-full last:rounded-e-full"
            style={{ width: `${(slice.value / sum) * 100}%`, background: slice.color }}
            title={`${slice.label}: ${slice.value}`}
          />
        ))}
    </div>
  );
}

/**
 * Time, as columns.
 *
 * The one chart here that is about magnitude rather than kind, so it keeps the
 * workspace rule: one hue, and the most recent column picked out because "is it
 * speeding up?" is a question about the right-hand end.
 */
export function ColumnTrend({ points, height = 132 }: { points: Array<{ label: string; value: number; highlight?: boolean }>; height?: number }) {
  const { t } = useI18n();
  const max = Math.max(...points.map((point) => point.value), 1);
  if (points.length === 0) return <p className="py-6 text-center text-[12.5px] text-ink-faint">{t('lp.charts.noData')}</p>;
  return (
    <div className="flex items-stretch gap-2" style={{ height }} role="img" aria-label={points.map((point) => `${point.label}: ${point.value}`).join('، ')}>
      {points.map((point, index) => (
        // `h-full` matters: the bar's height is a percentage, and a percentage
        // of a column that shrank to its own content is nothing at all.
        <div key={`${point.label}-${index}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[10.5px] font-bold tabular-nums text-ink-muted">{point.value || ''}</span>
          <div
            className="w-full rounded-t-lg transition-[height]"
            style={{
              height: `${Math.max(3, (point.value / max) * 100)}%`,
              background: point.highlight ? '#1D6FB8' : '#B4D4EF',
            }}
            title={`${point.label}: ${point.value}`}
          />
          <span className="w-full truncate text-center text-[10px] text-ink-faint">{point.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A named row with its work split three ways.
 *
 * Active, in review and overdue are different kinds of load, not more or less
 * of one, so the segments are coloured — and the overdue segment is the only
 * red on the card, which is the point of drawing it at all.
 */
export function LoadBars({
  rows,
  empty,
}: {
  rows: Array<{ key: string; label: ReactNode; active: number; reviewing: number; overdue: number }>;
  empty: string;
}) {
  const { t } = useI18n();
  const max = Math.max(...rows.map((row) => row.active + row.reviewing + row.overdue), 1);
  if (rows.length === 0) return <p className="py-6 text-center text-[13px] text-ink-faint">{empty}</p>;

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const total = row.active + row.reviewing + row.overdue;
        return (
          <li key={row.key} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-2.5">
            <span className="min-w-0 truncate text-[12.5px] text-ink">{row.label}</span>
            <span className="flex h-4 w-full gap-[2px] overflow-hidden rounded-md bg-surface-sunken" style={{ width: `${Math.max(6, (total / max) * 100)}%` }}>
              {row.active > 0 && <span className="h-full" style={{ width: `${(row.active / total) * 100}%`, background: '#4A8FCB' }} title={`${t('lp.workload.active')}: ${row.active}`} />}
              {row.reviewing > 0 && <span className="h-full" style={{ width: `${(row.reviewing / total) * 100}%`, background: '#4F46E5' }} title={`${t('lp.workload.review')}: ${row.reviewing}`} />}
              {row.overdue > 0 && <span className="h-full" style={{ width: `${(row.overdue / total) * 100}%`, background: '#DC2626' }} title={`${t('lp.workload.overdue')}: ${row.overdue}`} />}
            </span>
            <span className="w-8 text-end text-[12.5px] font-bold tabular-nums text-ink">{total}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The key a coloured chart needs when its numbers live somewhere else. */
export function Legend({ items }: { items: Array<{ key: string; label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
