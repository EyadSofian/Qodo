/**
 * The status chip and the data-quality mark every course carries.
 *
 * Restrained on purpose: colour is a hint on top of a word and a dot, never
 * the only carrier, and the Odoo stage name behind the chip is one hover away.
 */

import { AlertTriangle } from 'lucide-react';
import { STATUS_LABELS } from '@shared/eventsSchedule';
import { QUALITY_LABELS, type StatusCanonical } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';

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

export function StatusChip({
  status,
  stage,
  size = 'sm',
}: {
  status: StatusCanonical | null;
  stage: string | null;
  size?: 'sm' | 'md';
}) {
  if (!status && !stage) {
    return (
      <span className="text-ink-faint" title="مفيش مرحلة في أودو" aria-label="مفيش مرحلة في أودو">
        —
      </span>
    );
  }
  const label = status ? STATUS_LABELS[status] : stage;
  return (
    <span
      title={stage && stage !== label ? `مرحلة أودو: ${stage}` : undefined}
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset',
        size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1 text-[12.5px]',
        status ? STATUS_TONE[status] : 'bg-surface-sunken text-ink-muted ring-surface-line'
      )}
    >
      <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-full', status ? STATUS_DOT[status] : 'bg-ink-faint')} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** A subtle marker; the details panel spells the problems out. */
export function QualityMark({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  const text = flags.map((flag) => QUALITY_LABELS[flag] ?? flag).join('\n');
  return (
    <span className="inline-flex shrink-0 text-accent-600" title={text} aria-label={`${flags.length} ملاحظة على البيانات: ${text}`}>
      <AlertTriangle size={14} strokeWidth={2.25} />
    </span>
  );
}
