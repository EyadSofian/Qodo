/**
 * The small shared pieces a course is described with — status, capacity, work
 * days, quality — used by the cards, the compact list and the drawer alike.
 *
 * Restrained on purpose: a list where every element shouts is a list nobody can
 * scan. Colour is a hint on top of words and glyphs, never the only carrier,
 * and anything Odoo did not supply is a quiet "—", never a zero.
 */

import { AlertTriangle } from 'lucide-react';
import { STATUS_LABELS } from '@shared/eventsSchedule';
import { QUALITY_LABELS, WEEKDAY_AR, type StatusCanonical, type TrainingScheduleRow } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';

export function Missing({ label = 'غير متوفر في أودو' }: { label?: string }) {
  return (
    <span className="text-ink-faint" title={label} aria-label={label}>
      —
    </span>
  );
}

const STATUS_TONE: Record<StatusCanonical, string> = {
  in_progress: 'bg-brand-50 text-brand-700 ring-brand-200',
  planned: 'bg-white text-ink-muted ring-surface-line',
  hold: 'bg-status-warnBg text-accent-700 ring-accent-100',
  finished: 'bg-status-okBg text-status-ok ring-status-ok/20',
  canceled: 'bg-status-badBg text-status-bad ring-status-bad/20',
  refused: 'bg-status-badBg text-status-bad ring-status-bad/20',
};

const STATUS_DOT: Record<StatusCanonical, string> = {
  in_progress: 'bg-brand-500',
  planned: 'bg-ink-faint',
  hold: 'bg-accent-500',
  finished: 'bg-status-ok',
  canceled: 'bg-status-bad',
  refused: 'bg-status-bad',
};

/** The normalised word, with Odoo's own stage name one hover away. */
export function StatusChip({
  status,
  stage,
  size = 'sm',
}: {
  status: StatusCanonical | null;
  stage: string | null;
  size?: 'sm' | 'md';
}) {
  if (!status && !stage) return <Missing label="مفيش مرحلة في أودو" />;
  const label = status ? STATUS_LABELS[status] : stage;
  return (
    <span
      title={stage && stage !== label ? `مرحلة أودو: ${stage}` : undefined}
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]',
        status ? STATUS_TONE[status] : 'bg-surface-sunken text-ink-muted ring-surface-line'
      )}
    >
      <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-full', status ? STATUS_DOT[status] : 'bg-ink-faint')} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * "28 / 50" with a hairline under it. Unknown capacity is "28 / —" and draws
 * no bar: a bar against an invented denominator is a lie with a shape.
 */
export function CapacityCell({ count, capacity, compact }: { count: number; capacity: number | null; compact?: boolean }) {
  const ratio = capacity ? Math.min(1, count / capacity) : null;
  return (
    <span className="inline-flex min-w-[3.5rem] flex-col gap-1" title={capacity ? `${count} حجز مؤكّد من ${capacity} مكان` : `${count} حجز مؤكّد · السعة مش متسجّلة في أودو`}>
      <span className="whitespace-nowrap font-semibold tabular-nums text-ink">
        {count.toLocaleString('en-US')}
        <span className="font-normal text-ink-faint"> / {capacity ? capacity.toLocaleString('en-US') : '—'}</span>
      </span>
      {!compact && ratio !== null && (
        <span className="h-[3px] w-full overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
          <span
            className={cx('block h-full rounded-full', ratio >= 1 ? 'bg-brand-700' : 'bg-brand-400')}
            style={{ width: `${Math.max(4, ratio * 100)}%` }}
          />
        </span>
      )}
    </span>
  );
}

export function WorkDaysChips({ days, source }: { days: string[]; source?: TrainingScheduleRow['workDaysSource'] }) {
  if (days.length === 0) return <Missing label="مفيش محاضرات نعرف منها أيام الدراسة" />;
  return (
    <span
      className="inline-flex flex-wrap gap-0.5"
      title={source === 'odoo' ? 'من حقل أيام الدراسة في أودو' : 'من تواريخ المحاضرات نفسها (بتوقيت السعودية)'}
    >
      {days.map((day) => (
        <span key={day} className="rounded-md bg-surface-sunken px-1.5 py-px text-[10.5px] font-bold text-ink-muted">
          {WEEKDAY_AR[day] ?? day}
        </span>
      ))}
    </span>
  );
}

/** A subtle marker; the drawer spells the problems out. */
export function QualityMark({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  const text = flags.map((flag) => QUALITY_LABELS[flag] ?? flag).join('\n');
  return (
    <span className="inline-flex shrink-0 text-accent-600" title={text} aria-label={`${flags.length} ملاحظة على البيانات: ${text}`}>
      <AlertTriangle size={13} strokeWidth={2.25} />
    </span>
  );
}

/** One line, the whole thing on hover; never a tall row. */
export function CommentCell({ text }: { text: string | null }) {
  if (!text) return <Missing label="مفيش تعليقات" />;
  return (
    <bdi dir="auto" className="block max-w-full truncate text-ink-muted" title={text}>
      {text}
    </bdi>
  );
}
