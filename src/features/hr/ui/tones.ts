/**
 * Colour carries meaning in HR V2 and nothing else.
 *
 *   critical / overdue       red
 *   required / warning       amber
 *   planned / informational  blue (the brand)
 *   success / completed      green
 *
 * Everything that is not one of those is neutral. Text tones are the -700
 * shades so a label on its tinted background still passes AA.
 */

import type { Priority, RequestStatus, Severity, SlaState } from '../types';

export type Tone = 'critical' | 'warning' | 'info' | 'success' | 'neutral';

export const TONE = {
  critical: { text: 'text-red-700', bg: 'bg-red-50/90', border: 'border-red-200', dot: 'bg-red-500', bar: 'bg-gradient-to-r from-rose-500 to-red-500', ring: 'ring-red-200' },
  warning: { text: 'text-amber-700', bg: 'bg-amber-50/90', border: 'border-amber-200', dot: 'bg-amber-500', bar: 'bg-gradient-to-r from-amber-400 to-orange-500', ring: 'ring-amber-200' },
  info: { text: 'text-blue-700', bg: 'bg-blue-50/90', border: 'border-blue-200', dot: 'bg-blue-500', bar: 'bg-gradient-to-r from-sky-500 to-blue-600', ring: 'ring-blue-200' },
  success: { text: 'text-emerald-700', bg: 'bg-emerald-50/90', border: 'border-emerald-200', dot: 'bg-emerald-500', bar: 'bg-gradient-to-r from-emerald-400 to-green-600', ring: 'ring-emerald-200' },
  neutral: { text: 'text-slate-600', bg: 'bg-white/80', border: 'border-slate-200', dot: 'bg-slate-400', bar: 'bg-slate-400', ring: 'ring-slate-200' },
} as const;

export const PRIORITY_TONE: Record<Priority, Tone> = { critical: 'critical', required: 'warning', planned: 'info' };

export const SEVERITY_TONE: Record<Severity, Tone> = { critical: 'critical', warning: 'warning', info: 'info', success: 'success' };

export const SLA_TONE: Record<SlaState, Tone> = {
  on_track: 'info',
  due_soon: 'warning',
  due_today: 'warning',
  overdue: 'critical',
  paused: 'neutral',
  met: 'success',
  missed: 'critical',
  not_started: 'neutral',
};

export const STATUS_TONE: Record<RequestStatus, Tone> = {
  draft: 'neutral',
  pending_review: 'warning',
  pending_approval: 'warning',
  hiring: 'info',
  on_hold: 'neutral',
  completed: 'success',
  cancelled: 'neutral',
  rejected: 'critical',
};
