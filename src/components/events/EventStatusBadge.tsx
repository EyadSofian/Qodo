/**
 * The status chip and the data-quality mark every course carries.
 *
 * Each status has its own colour, and never only a colour: a dot or an icon and
 * the word ride with it, and Odoo's own stage name is one hover away.
 */

import { AlertTriangle, Check, CircleSlash, PauseCircle, XCircle } from 'lucide-react';
import { STATUS_LABELS } from '@shared/eventsSchedule';
import { QUALITY_LABELS, type StatusCanonical } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { STATUS_TONE, TONE } from './tones';

function Glyph({ status }: { status: StatusCanonical }) {
  const size = 12;
  if (status === 'finished') return <Check size={size} strokeWidth={3} aria-hidden />;
  if (status === 'hold') return <PauseCircle size={size} strokeWidth={2.5} aria-hidden />;
  if (status === 'canceled') return <XCircle size={size} strokeWidth={2.5} aria-hidden />;
  if (status === 'refused') return <CircleSlash size={size} strokeWidth={2.5} aria-hidden />;
  return (
    <span aria-hidden className="relative grid h-2 w-2 place-items-center">
      {status === 'in_progress' && <span className="absolute h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-60" />}
      <span className={cx('relative h-2 w-2 rounded-full', TONE[STATUS_TONE[status]].dot)} />
    </span>
  );
}

export function StatusChip({
  status,
  stage,
  size = 'sm',
  onDark,
}: {
  status: StatusCanonical | null;
  stage: string | null;
  size?: 'sm' | 'md';
  /** On a dark header: a frosted chip that keeps the status colour in its dot. */
  onDark?: boolean;
}) {
  if (!status && !stage) {
    return (
      <span className={onDark ? 'text-white/60' : 'text-slate-400'} title="مفيش مرحلة في أودو" aria-label="مفيش مرحلة في أودو">
        —
      </span>
    );
  }
  const label = status ? STATUS_LABELS[status] : stage;
  const tone = status ? TONE[STATUS_TONE[status]] : TONE.slate;
  return (
    <span
      title={stage && stage !== label ? `مرحلة أودو: ${stage}` : undefined}
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border font-bold',
        size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1.5 text-[12.5px]',
        onDark ? 'border-white/20 bg-white/15 text-white backdrop-blur' : cx(tone.soft, tone.border, tone.text),
        status === 'refused' && !onDark && '!text-rose-800'
      )}
    >
      {status ? <Glyph status={status} /> : <span aria-hidden className="h-2 w-2 rounded-full bg-slate-400" />}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** A subtle marker; the details panel spells the problems out. */
export function QualityMark({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  const text = flags.map((flag) => QUALITY_LABELS[flag] ?? flag).join('\n');
  return (
    <span
      className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200"
      title={text}
      aria-label={`${flags.length} ملاحظة على البيانات: ${text}`}
    >
      <AlertTriangle size={12} strokeWidth={2.5} />
    </span>
  );
}
