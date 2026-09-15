/**
 * E-Learning Production — how states look.
 *
 * One table of tone and icon per status, so a status looks the same on the
 * matrix, the lesson header, My Work and the review queue. Colour never
 * carries a meaning alone: every badge has its icon and its words.
 */

import {
  Ban,
  CheckCircle2,
  Circle,
  Clapperboard,
  Eye,
  FileText,
  ListTree,
  Lock,
  Mic,
  PenLine,
  Presentation,
  RotateCcw,
  Send,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { ApiError } from '../api';
import type { StringKey } from '../i18n';
import type { AssetStatus, AssetType, CourseHealth, DueState, Priority } from './types';
import { ASSET_SLUGS, ASSET_TYPES } from '@shared/learningProduction/constants';

export type Tone = 'neutral' | 'info' | 'review' | 'warn' | 'ok' | 'bad';

export const TONE_CHIP: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted',
  info: 'bg-status-infoBg text-brand-600',
  review: 'bg-indigo-50 text-indigo-700',
  warn: 'bg-status-warnBg text-accent-700',
  ok: 'bg-status-okBg text-status-ok',
  bad: 'bg-status-badBg text-status-bad',
};

export const TONE_CELL: Record<Tone, string> = {
  neutral: 'bg-white text-ink-muted border-surface-line',
  info: 'bg-status-infoBg text-brand-700 border-brand-100',
  review: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  warn: 'bg-status-warnBg text-accent-700 border-amber-200',
  ok: 'bg-status-okBg text-green-700 border-green-200',
  bad: 'bg-status-badBg text-status-bad border-red-200',
};

export const STATUS_META: Record<AssetStatus, { tone: Tone; icon: LucideIcon }> = {
  NOT_STARTED: { tone: 'neutral', icon: Circle },
  ASSIGNED: { tone: 'neutral', icon: UserCheck },
  IN_PROGRESS: { tone: 'info', icon: PenLine },
  SUBMITTED: { tone: 'review', icon: Send },
  UNDER_REVIEW: { tone: 'review', icon: Eye },
  CHANGES_REQUESTED: { tone: 'warn', icon: RotateCcw },
  RESUBMITTED: { tone: 'review', icon: Send },
  APPROVED: { tone: 'ok', icon: CheckCircle2 },
  LOCKED: { tone: 'ok', icon: Lock },
};

export const BLOCKED_META = { tone: 'neutral' as Tone, icon: Ban };

export const STAGE_ICON: Record<AssetType, LucideIcon> = {
  OUTLINE: ListTree,
  PPT: Presentation,
  SCRIPT: FileText,
  VOICE_OVER: Mic,
  VIDEO: Clapperboard,
};

/**
 * Each stage's identity color — an accent only (icon tint, thin border,
 * underline). Never a fill: status tone owns fills, so a "PPT under review"
 * cell can show both facts without the two hues fighting for the same pixel.
 */
export const STAGE_COLOR: Record<AssetType, string> = {
  OUTLINE: 'text-stage-outline',
  PPT: 'text-stage-ppt',
  SCRIPT: 'text-stage-script',
  VOICE_OVER: 'text-stage-voice',
  VIDEO: 'text-stage-video',
};

/**
 * Raw hex twins of `tailwind.config.js`'s `colors.stage.*`, for the couple of
 * spots (a single border edge, a canvas fill) where a Tailwind border-color
 * utility would set every side at once and fight whatever tone/status color
 * already owns the other sides — an inline style only touches the one CSS
 * property it's given.
 */
export const STAGE_HEX: Record<AssetType, string> = {
  OUTLINE: '#7C3AED',
  PPT: '#B45309',
  SCRIPT: '#2563EB',
  VOICE_OVER: '#0284C7',
  VIDEO: '#F43F5E',
};

export const STAGES = ASSET_TYPES as readonly AssetType[];

export const statusKey = (status: AssetStatus) => `lp.status.${status}` as StringKey;
export const stageKey = (type: AssetType) => `lp.stage.${type}` as StringKey;
export const healthKey = (health: CourseHealth) => `lp.health.${health}` as StringKey;
export const priorityKey = (priority: Priority) => `lp.priority.${priority}` as StringKey;
export const roleKey = (role: string) => `lp.role.${role}` as StringKey;

export const HEALTH_TONE: Record<CourseHealth, Tone> = {
  ON_TRACK: 'info',
  AT_RISK: 'warn',
  DELAYED: 'bad',
  COMPLETED: 'ok',
};

export const DUE_TONE: Record<Exclude<DueState, null>, Tone> = {
  OVERDUE: 'bad',
  DUE_TODAY: 'warn',
  DUE_SOON: 'info',
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'warn',
  URGENT: 'bad',
};

export function stageSlug(type: AssetType) {
  return ASSET_SLUGS[type];
}

export function assetRoute(courseId: string, lessonId: string, type: AssetType) {
  return `/learning-production/courses/${courseId}/lessons/${lessonId}/${ASSET_SLUGS[type]}`;
}

const KNOWN_ERRORS = new Set([
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'FORBIDDEN',
  'INVALID_TRANSITION',
  'ASSET_LOCKED',
  'ASSET_BLOCKED',
  'NOT_BLOCKED',
  'NOT_SUPPORTED',
  'CONTENT_REQUIRED',
  'NEW_VERSION_REQUIRED',
  'OWN_WORK',
  'FEEDBACK_REQUIRED',
  'CHECKLIST_INCOMPLETE',
  'DRAFT_CONFLICT',
  'REASON_REQUIRED',
  'ASSIGNEE_INVALID',
  'REVIEWER_IS_ASSIGNEE',
  'COURSE_CODE_TAKEN',
  'MODULE_NOT_EMPTY',
  'FILE_REQUIRED',
  'FILE_TOO_LARGE',
  'FILE_TYPE_NOT_ALLOWED',
  'LINK_INVALID',
  'PREVIEW_EXISTS',
  'COMMENT_NOT_EDITABLE',
  'SUGGESTION_OUTDATED',
  'LAST_MANAGER',
  'STORAGE_UNAVAILABLE',
]);

/** A sentence for a refusal. Unknown failures get the reassuring generic one — never a status code. */
export function lpErrorKey(error: unknown): StringKey {
  if (error instanceof TypeError) return 'lp.error.NETWORK';
  if (error instanceof ApiError && KNOWN_ERRORS.has(error.code)) return `lp.error.${error.code}` as StringKey;
  if (error instanceof ApiError && error.status === 401) return 'lp.error.FORBIDDEN';
  return 'lp.error.GENERIC';
}

export function formatSize(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatDay(value: string | null | undefined, lang: 'ar' | 'en') {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-EG', { day: 'numeric', month: 'short' }).format(date);
}
