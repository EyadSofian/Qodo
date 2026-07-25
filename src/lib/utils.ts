import type { Lang, StringKey } from './i18n';
import type { TaskPriority } from './types';

type T = (key: StringKey, vars?: Record<string, string | number>) => string;

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((w) => [...w][0] ?? '').join('') || '؟';
}

/**
 * Relative time. `Intl.RelativeTimeFormat` would do this, but its Arabic output
 * ("قبل ٣ أيام") reads more formally than the rest of the interface, so the
 * common buckets come from the string table instead.
 */
export function timeAgo(iso: string | null | undefined, t: T) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return t('time.now');
  if (minutes < 60) return t('time.minutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hours', { n: hours });
  const days = Math.round(hours / 24);
  if (days === 1) return t('time.yesterday');
  if (days < 30) return t('time.days', { n: days });
  const months = Math.round(days / 30);
  if (months < 12) return t('time.months', { n: months });
  return t('time.years', { n: Math.round(months / 12) });
}

export function formatDate(value: string | null | undefined, lang: Lang) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-EG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Days until a due date — negative once it's late. Compared date-only. */
export function daysUntil(dueDate: string | null) {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export type DueTone = 'bad' | 'warn' | 'info' | 'muted';

export function dueLabel(
  dueDate: string | null,
  t: T,
  lang: Lang
): { text: string; tone: DueTone } | null {
  const days = daysUntil(dueDate);
  if (days === null) return null;
  if (days < -1) return { text: t('tasks.overdueMany', { n: Math.abs(days) }), tone: 'bad' };
  if (days === -1) return { text: t('tasks.overdueOne'), tone: 'bad' };
  if (days === 0) return { text: t('tasks.dueToday'), tone: 'warn' };
  if (days === 1) return { text: t('tasks.dueTomorrow'), tone: 'warn' };
  if (days <= 7) return { text: t('tasks.dueInDays', { n: days }), tone: 'info' };
  return { text: formatDate(dueDate, lang), tone: 'muted' };
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  bad: 'text-status-bad',
  warn: 'text-accent-600',
  info: 'text-brand-600',
  muted: 'text-ink-faint',
};

export const DUE_CHIP_CLASS: Record<DueTone, string> = {
  bad: 'bg-status-badBg text-status-bad',
  warn: 'bg-status-warnBg text-accent-600',
  info: 'bg-status-infoBg text-brand-600',
  muted: 'bg-surface-sunken text-ink-muted',
};

export const PRIORITY_META: Record<
  TaskPriority,
  { key: StringKey; className: string; rank: number }
> = {
  urgent: { key: 'priority.urgent', className: 'bg-status-badBg text-status-bad', rank: 0 },
  high: { key: 'priority.high', className: 'bg-accent-50 text-accent-600', rank: 1 },
  normal: { key: 'priority.normal', className: 'bg-slate-100 text-slate-600', rank: 2 },
  low: { key: 'priority.low', className: 'bg-slate-50 text-slate-500', rank: 3 },
};

export const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];

/** Readable text colour for a coloured chip — WCAG-ish luminance split. */
export function readableOn(hex: string) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#FFFFFF';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.45 ? '#0B2545' : '#FFFFFF';
}

export function hexWithAlpha(hex: string, alpha: number) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const value = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${clean}${value}`;
}
