/**
 * The module icon set.
 *
 * One geometric glyph per module, drawn in two tones of the module's own colour
 * — solid for the main shape, 40% for the supporting one. Because every glyph
 * sits on the same rounded tile with the same padding and stroke weight, a grid
 * of them reads as one family the way a good launcher should, without borrowing
 * anyone's artwork.
 */

import type { ReactElement } from 'react';
import { hexWithAlpha } from '../lib/utils';

export const ICON_KEYS = [
  'gauge', 'funnel', 'people', 'chat', 'headset', 'kanban',
  'shield', 'sliders', 'grid', 'chart', 'calendar', 'folder', 'bolt', 'globe',
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

interface Props {
  name: string;
  color: string;
  size?: number;
  /** `plain` drops the tile — for dense lists where the glyph alone is enough. */
  variant?: 'tile' | 'plain';
  className?: string;
}

export function ModuleIcon({ name, color, size = 56, variant = 'tile', className }: Props) {
  const glyph = GLYPHS[name as IconKey] ?? GLYPHS.grid;
  const soft = hexWithAlpha(color, 0.4);
  const inner = Math.round(size * (variant === 'tile' ? 0.58 : 1));

  if (variant === 'plain') {
    return (
      <svg
        width={inner}
        height={inner}
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        {glyph(color, soft)}
      </svg>
    );
  }

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        display: 'inline-grid',
        placeItems: 'center',
        background: `linear-gradient(150deg, ${hexWithAlpha(color, 0.16)}, ${hexWithAlpha(color, 0.08)})`,
        boxShadow: `inset 0 0 0 1px ${hexWithAlpha(color, 0.16)}`,
        flexShrink: 0,
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {glyph(color, soft)}
      </svg>
    </span>
  );
}

type Glyph = (solid: string, soft: string) => ReactElement;

const round = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<IconKey, Glyph> = {
  // Speedometer — service level, response times.
  gauge: (solid, soft) => (
    <g>
      <path d="M3.5 18a9 9 0 1 1 17 0" stroke={soft} strokeWidth="2.4" {...round} />
      <path d="M12 18l4.6-6" stroke={solid} strokeWidth="2.6" {...round} />
      <circle cx="12" cy="18" r="1.9" fill={solid} />
    </g>
  ),
  // Funnel — marketing spend down to revenue.
  funnel: (solid, soft) => (
    <g>
      <path d="M4 5h16l-6 7v7l-4-2.5V12L4 5Z" stroke={soft} strokeWidth="2.2" {...round} />
      <path d="M9 5h6l-3 3.4L9 5Z" fill={solid} />
    </g>
  ),
  // Three figures — people and org structure.
  people: (solid, soft) => (
    <g>
      <circle cx="9" cy="8" r="3.2" fill={solid} />
      <path d="M3.2 19c0-3.1 2.6-5.2 5.8-5.2s5.8 2.1 5.8 5.2" stroke={solid} strokeWidth="2.2" {...round} />
      <circle cx="17.2" cy="9.4" r="2.4" fill={soft} />
      <path d="M15 19c0-2.3 1.1-3.9 3.4-3.9 1.6 0 2.6.8 2.6 2.3V19" stroke={soft} strokeWidth="2" {...round} />
    </g>
  ),
  // Two bubbles — conversations.
  chat: (solid, soft) => (
    <g>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v4A2.5 2.5 0 0 1 13.5 13H9l-3.6 2.7V13H6.5A2.5 2.5 0 0 1 4 10.5v-4Z" fill={solid} />
      <path d="M18.4 9.2A2.4 2.4 0 0 1 20 11.5v4a2.4 2.4 0 0 1-2.4 2.4H17v2.3L14 17.9h-3" stroke={soft} strokeWidth="2" {...round} />
    </g>
  ),
  // Headset — the live inbox.
  headset: (solid, soft) => (
    <g>
      <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" stroke={soft} strokeWidth="2.3" {...round} />
      <rect x="2.8" y="12.6" width="4.2" height="6.2" rx="2.1" fill={solid} />
      <rect x="17" y="12.6" width="4.2" height="6.2" rx="2.1" fill={solid} />
      <path d="M19.1 18.8v.6a2.6 2.6 0 0 1-2.6 2.6H13" stroke={soft} strokeWidth="2" {...round} />
    </g>
  ),
  // Board columns — the task module.
  kanban: (solid, soft) => (
    <g>
      <rect x="3" y="4" width="5.4" height="13" rx="1.8" fill={solid} />
      <rect x="9.9" y="4" width="5.4" height="9" rx="1.8" fill={soft} />
      <rect x="16.8" y="4" width="4.2" height="16" rx="1.8" fill={soft} />
    </g>
  ),
  // Shield with a tick — users and permissions.
  shield: (solid, soft) => (
    <g>
      <path d="M12 2.8 20 6v6c0 4.4-3.3 7.9-8 9.2C7.3 19.9 4 16.4 4 12V6l8-3.2Z" fill={soft} />
      <path d="m8.4 12.2 2.6 2.6 4.8-5" stroke={solid} strokeWidth="2.5" {...round} />
    </g>
  ),
  // Sliders — settings.
  sliders: (solid, soft) => (
    <g>
      <path d="M5 4v16M12 4v16M19 4v16" stroke={soft} strokeWidth="2.2" {...round} />
      <circle cx="5" cy="9" r="2.6" fill={solid} />
      <circle cx="12" cy="15" r="2.6" fill={solid} />
      <circle cx="19" cy="7.5" r="2.6" fill={solid} />
    </g>
  ),
  // Generic app.
  grid: (solid, soft) => (
    <g>
      <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="2.2" fill={solid} />
      <rect x="13.1" y="3.5" width="7.4" height="7.4" rx="2.2" fill={soft} />
      <rect x="3.5" y="13.1" width="7.4" height="7.4" rx="2.2" fill={soft} />
      <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="2.2" fill={solid} />
    </g>
  ),
  chart: (solid, soft) => (
    <g>
      <path d="M4 19h16" stroke={soft} strokeWidth="2.2" {...round} />
      <rect x="5" y="11" width="3.6" height="6" rx="1.4" fill={soft} />
      <rect x="10.2" y="7" width="3.6" height="10" rx="1.4" fill={solid} />
      <rect x="15.4" y="3.6" width="3.6" height="13.4" rx="1.4" fill={solid} />
    </g>
  ),
  calendar: (solid, soft) => (
    <g>
      <rect x="3.4" y="5" width="17.2" height="15.4" rx="3" fill={soft} />
      <path d="M3.4 9.6h17.2" stroke="#fff" strokeWidth="1.8" />
      <path d="M8 3v4M16 3v4" stroke={solid} strokeWidth="2.4" {...round} />
      <rect x="6.8" y="12.2" width="4" height="3.6" rx="1.2" fill={solid} />
    </g>
  ),
  folder: (solid, soft) => (
    <g>
      <path d="M3 7a2.4 2.4 0 0 1 2.4-2.4h3.4l2.2 2.6h7.6A2.4 2.4 0 0 1 21 9.6V17a2.4 2.4 0 0 1-2.4 2.4H5.4A2.4 2.4 0 0 1 3 17V7Z" fill={soft} />
      <path d="M3 11h18v6a2.4 2.4 0 0 1-2.4 2.4H5.4A2.4 2.4 0 0 1 3 17v-6Z" fill={solid} />
    </g>
  ),
  bolt: (solid, soft) => (
    <g>
      <path d="M13.6 2 5 13.4h5.4L9.8 22 19 10.2h-5.6L13.6 2Z" fill={solid} />
      <path d="M13.6 2 5 13.4h5.4L13.6 2Z" fill={soft} />
    </g>
  ),
  globe: (solid, soft) => (
    <g>
      <circle cx="12" cy="12" r="8.6" stroke={soft} strokeWidth="2.2" />
      <path d="M3.4 12h17.2" stroke={soft} strokeWidth="2.2" {...round} />
      <path d="M12 3.4c2.4 2.4 3.6 5.3 3.6 8.6S14.4 18.2 12 20.6c-2.4-2.4-3.6-5.3-3.6-8.6S9.6 5.8 12 3.4Z" stroke={solid} strokeWidth="2.2" {...round} />
    </g>
  ),
};
