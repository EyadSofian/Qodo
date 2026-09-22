/**
 * One S-column cell: which lecture, when, and whether it has happened.
 *
 * ✓ done · ● today · ○ to come · — not scheduled. The glyph and a screen-reader
 * word carry the state; the tint only reinforces it, so the grid reads the same
 * in greyscale and to somebody who cannot tell blue from green.
 */

import { SESSION_GLYPHS, sessionState } from '@shared/eventsSchedule';
import { ksaFull, ksaShortDate, ksaTime, type TrainingSession } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';

const STATE_WORD = { past: 'done', today: 'today', upcoming: 'upcoming', missing: 'not scheduled' } as const;

export function SessionCell({ session, index, now }: { session: TrainingSession | undefined; index: number; now: Date }) {
  const state = sessionState(session, now) as keyof typeof STATE_WORD;
  if (!session || state === 'missing') {
    return (
      <span className="block text-center text-ink-faint" title={`S${index + 1}: not scheduled in Odoo`}>
        —<span className="sr-only"> S{index + 1} not scheduled</span>
      </span>
    );
  }
  const hours = session.durationHours ? ` · ${session.durationHours}h` : '';
  const title = `S${session.number}${session.name ? ` — ${session.name}` : ''}\n${ksaFull(session.startsAt)} KSA${hours}`;
  return (
    <span
      title={title}
      className={cx(
        'flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 leading-tight',
        state === 'today' && 'bg-brand-50 ring-1 ring-inset ring-brand-300',
        state === 'past' && 'text-ink-faint'
      )}
    >
      <span
        aria-hidden
        className={cx(
          'w-3 shrink-0 text-center text-[11px]',
          state === 'today' ? 'text-brand-600' : state === 'past' ? 'text-status-ok/80' : 'text-ink-faint'
        )}
      >
        {SESSION_GLYPHS[state]}
      </span>
      <span className="min-w-0">
        <span className={cx('block whitespace-nowrap text-[11px] font-semibold', state === 'today' ? 'text-brand-700' : state === 'upcoming' && 'text-ink')}>
          {state === 'today' ? 'Today' : ksaShortDate(session.startsAt)}
        </span>
        <span className="block whitespace-nowrap text-[10px] tabular-nums">{ksaTime(session.startsAt)}</span>
      </span>
      <span className="sr-only">{STATE_WORD[state]}</span>
    </span>
  );
}
