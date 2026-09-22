/**
 * The Events colour system: a small set of semantic tones, each a complete
 * bundle of classes, so every component asks for "green" and gets the same
 * green. Tailwind's own palettes, not bespoke hexes.
 *
 * What each colour means is fixed across the module:
 *   blue    primary action, planned, neutral information
 *   green   running and healthy
 *   amber   attention, on hold, starting soon
 *   violet  secondary highlight, upcoming, analytics
 *   coral   alert, cancelled, full
 *   slate   finished and neutral
 * Departments get their own identity tints, used only on the department chip,
 * so they never compete with a status.
 */

import type { StatusCanonical } from '../../lib/eventsSchedule';

export type Tone = 'blue' | 'green' | 'amber' | 'violet' | 'coral' | 'slate' | 'sky' | 'indigo' | 'pink' | 'orange';

type Bundle = {
  /** Soft chip / block background. */
  soft: string;
  /** Border that goes with `soft`. */
  border: string;
  /** Text on `soft`. */
  text: string;
  /** A status dot or a bar fill. */
  dot: string;
  /** Solid icon square with its own glow. */
  icon: string;
  /** A barely-there wash for a large surface (used with bg-gradient-to-*). */
  wash: string;
  /** Top stripe on a card. */
  stripe: string;
};

export const TONE: Record<Tone, Bundle> = {
  blue: {
    soft: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
    icon: 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30',
    wash: 'from-blue-50 via-white to-white',
    stripe: 'from-blue-500 to-blue-400',
  },
  green: {
    soft: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    icon: 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/30',
    wash: 'from-emerald-50 via-white to-white',
    stripe: 'from-emerald-500 to-emerald-400',
  },
  amber: {
    soft: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    dot: 'bg-amber-500',
    icon: 'bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-lg shadow-amber-500/30',
    wash: 'from-amber-50 via-white to-white',
    stripe: 'from-amber-500 to-amber-400',
  },
  violet: {
    soft: 'bg-violet-50',
    border: 'border-violet-200',
    text: 'text-violet-700',
    dot: 'bg-violet-500',
    icon: 'bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-lg shadow-violet-500/30',
    wash: 'from-violet-50 via-white to-white',
    stripe: 'from-violet-500 to-violet-400',
  },
  coral: {
    soft: 'bg-rose-50',
    border: 'border-rose-200',
    text: 'text-rose-700',
    dot: 'bg-rose-500',
    icon: 'bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-lg shadow-rose-500/30',
    wash: 'from-rose-50 via-white to-white',
    stripe: 'from-rose-500 to-rose-400',
  },
  slate: {
    soft: 'bg-slate-100',
    border: 'border-slate-200',
    text: 'text-slate-700',
    dot: 'bg-slate-400',
    icon: 'bg-gradient-to-br from-slate-600 to-slate-700 text-white shadow-lg shadow-slate-500/30',
    wash: 'from-slate-50 via-white to-white',
    stripe: 'from-slate-400 to-slate-300',
  },
  sky: {
    soft: 'bg-sky-50',
    border: 'border-sky-200',
    text: 'text-sky-700',
    dot: 'bg-sky-500',
    icon: 'bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-lg shadow-sky-500/30',
    wash: 'from-sky-50 via-white to-white',
    stripe: 'from-sky-500 to-sky-400',
  },
  indigo: {
    soft: 'bg-indigo-50',
    border: 'border-indigo-200',
    text: 'text-indigo-700',
    dot: 'bg-indigo-500',
    icon: 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30',
    wash: 'from-indigo-50 via-white to-white',
    stripe: 'from-indigo-500 to-indigo-400',
  },
  pink: {
    soft: 'bg-pink-50',
    border: 'border-pink-200',
    text: 'text-pink-700',
    dot: 'bg-pink-500',
    icon: 'bg-gradient-to-br from-pink-500 to-pink-600 text-white shadow-lg shadow-pink-500/30',
    wash: 'from-pink-50 via-white to-white',
    stripe: 'from-pink-500 to-pink-400',
  },
  orange: {
    soft: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-700',
    dot: 'bg-orange-500',
    icon: 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30',
    wash: 'from-orange-50 via-white to-white',
    stripe: 'from-orange-500 to-orange-400',
  },
};

export const STATUS_TONE: Record<StatusCanonical, Tone> = {
  in_progress: 'green',
  planned: 'blue',
  hold: 'amber',
  finished: 'slate',
  canceled: 'coral',
  refused: 'coral',
};

/** Keyed by the canonical department value the backend returns. */
const DEPARTMENT_TONE: Record<string, Tone> = {
  'Arch & Decor': 'violet',
  Mechanical: 'blue',
  Electrical: 'amber',
  Civil: 'sky',
  Development: 'indigo',
  English: 'pink',
  Webinar: 'orange',
};

export const departmentTone = (department: string | null): Tone => (department && DEPARTMENT_TONE[department]) || 'slate';

/**
 * How full a course is, as a colour: blue while there is plenty of room, green
 * once it is healthily booked, amber near the top, coral when full.
 */
export function capacityTone(count: number, capacity: number | null): Tone {
  if (!capacity) return 'slate';
  const ratio = count / capacity;
  if (ratio >= 1) return 'coral';
  if (ratio >= 0.8) return 'amber';
  if (ratio >= 0.5) return 'green';
  return 'blue';
}

/** The one frosted surface every glass panel in the module uses. */
export const GLASS =
  'border border-white/80 bg-gradient-to-l from-white/70 via-white/55 to-white/45 shadow-[0_10px_40px_-10px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.95)] ring-1 ring-slate-900/5 backdrop-blur-2xl backdrop-saturate-150';
