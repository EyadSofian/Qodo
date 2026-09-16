/**
 * E-Learning Production — the small pieces every screen is built from.
 *
 * Quiet by default: the commonest state on a screen should be the least
 * visible thing on it, and red is kept for work that is actually late.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, CalendarClock, MessageSquare } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { cx, timeAgo } from '../../lib/utils';
import { Avatar, Modal, Spinner } from '../ui';
import { lp, paths } from '../../lib/learningProduction/api';
import {
  DUE_TONE,
  PRIORITY_TONE,
  STAGE_COLOR,
  STAGE_HEX,
  STAGE_ICON,
  STAGE_TAG,
  STATUS_META,
  TONE_CHIP,
  assetRoute,
  formatDay,
  lpErrorKey,
  priorityKey,
  stageKey,
  statusKey,
  type Tone,
} from '../../lib/learningProduction/format';
import type { ActivityEntry, AssetStatus, AssetSummary, AssetType, DueState, People, Person, Priority } from '../../lib/learningProduction/types';

/* ── layout ──────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Array<{ label: string; to?: string }>;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-[12px] text-ink-faint">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 && <span aria-hidden="true">/</span>}
              {crumb.to ? (
                <Link to={crumb.to} className="max-w-[14rem] truncate hover:text-brand-600 hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span className="max-w-[14rem] truncate text-ink-muted">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight text-ink">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-muted">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Section({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('rounded-2xl border border-surface-line bg-white', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-line px-4 py-3">
          {title && <h2 className="text-sm font-bold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ── states ──────────────────────────────────────────────────────── */

export function Chip({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold', TONE_CHIP[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, blocked = false, size = 'md' }: { status: AssetStatus; blocked?: boolean; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  if (blocked) {
    return (
      <Chip tone="neutral" className={size === 'sm' ? '!text-[11px]' : undefined}>
        <Ban size={12} aria-hidden="true" />
        {t('lp.blocked')}
      </Chip>
    );
  }
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Chip tone={meta.tone} className={size === 'sm' ? '!text-[11px]' : undefined}>
      <Icon size={12} aria-hidden="true" />
      {t(statusKey(status))}
    </Chip>
  );
}

export function StageLabel({ type, className }: { type: AssetType; className?: string }) {
  const { t } = useI18n();
  const Icon = STAGE_ICON[type];
  return (
    <span className={cx('inline-flex items-center gap-1.5', className)}>
      <Icon size={14} className={cx('shrink-0', STAGE_COLOR[type])} aria-hidden="true" />
      {t(stageKey(type))}
    </span>
  );
}

/**
 * When something is due, and how worried to be about it.
 *
 * `compact` keeps the date and the colour but drops the state's word for
 * anything short of overdue — for a table column where the date is the point
 * and "Due soon · 18 Sept" is twice as wide as the column deserves. Overdue
 * keeps its word at every size: that one is never inferred from a colour.
 */
export function DueChip({ dueDate, dueState, compact = false }: { dueDate: string | null; dueState: DueState; compact?: boolean }) {
  const { t, lang } = useI18n();
  if (!dueDate) return <span className="text-[12px] text-ink-faint">—</span>;
  if (!dueState) return <span className="text-[12px] text-ink-muted">{formatDay(dueDate, lang)}</span>;
  const overdue = dueState === 'OVERDUE';
  return (
    <Chip tone={DUE_TONE[dueState]}>
      {overdue ? <AlertTriangle size={12} aria-hidden="true" /> : <CalendarClock size={12} aria-hidden="true" />}
      {compact && !overdue ? formatDay(dueDate, lang) : `${t(`lp.due.${dueState}` as StringKey)} · ${formatDay(dueDate, lang)}`}
    </Chip>
  );
}

export function PriorityChip({ priority, quietNormal = true }: { priority: Priority; quietNormal?: boolean }) {
  const { t } = useI18n();
  if (quietNormal && (priority === 'NORMAL' || priority === 'LOW')) return null;
  return <Chip tone={PRIORITY_TONE[priority]}>{t(priorityKey(priority))}</Chip>;
}

export function CommentCount({ count }: { count: number }) {
  const { t } = useI18n();
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-accent-700" title={t('lp.openComments', { n: count })}>
      <MessageSquare size={11} aria-hidden="true" />
      {count}
      <span className="sr-only">{t('lp.openComments', { n: count })}</span>
    </span>
  );
}

export function ProgressBar({ value, tone = 'info', label, className, color }: { value: number; tone?: 'info' | 'ok'; label?: string; className?: string; color?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  // A stage's own bar takes the stage color; a finished bar is always green.
  const fill = clamped === 100 || tone === 'ok' ? undefined : color;
  return (
    <div
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span
        className={cx('block h-full rounded-full transition-[width] duration-500', clamped === 100 || tone === 'ok' ? 'bg-status-ok' : !fill && 'bg-brand-500')}
        style={{ width: `${clamped}%`, background: fill }}
      />
    </div>
  );
}

export function PersonChip({ userId, people, size = 22, showName = true, empty }: { userId: string | null; people: People; size?: number; showName?: boolean; empty?: string }) {
  const { t } = useI18n();
  if (!userId) return <span className="text-[12px] text-ink-faint">{empty ?? t('lp.unassigned')}</span>;
  const person = people[userId];
  const name = person?.name ?? t('common.removedUser');
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={name}>
      <Avatar name={name} color={person?.avatarColor ?? '#94A3B8'} size={size} />
      {showName && <span className="truncate text-[12.5px] text-ink">{name}</span>}
    </span>
  );
}

export function SkeletonRows({ rows = 6, height = 'h-11' }: { rows?: number; height?: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2" role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={cx('skeleton w-full', height)} />
      ))}
    </div>
  );
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="rounded-2xl border border-surface-line bg-white px-6 py-10 text-center">
      <AlertTriangle size={22} className="mx-auto mb-2 text-accent-600" aria-hidden="true" />
      <p className="mx-auto max-w-md text-sm leading-relaxed text-ink">{t(lpErrorKey(error))}</p>
      {onRetry && (
        <button type="button" className="btn-ghost btn-sm mt-4" onClick={onRetry}>
          {t('lp.retry')}
        </button>
      )}
    </div>
  );
}

export function EmptyPanel({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-surface-line bg-white/60 px-6 py-12 text-center">
      {icon && <div className="mb-2 flex justify-center text-ink-faint">{icon}</div>}
      <h3 className="text-[15px] font-bold text-ink">{title}</h3>
      {body && <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-ink-muted">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ── dialogs and pickers ─────────────────────────────────────────── */

/**
 * A confirmation for the actions that deserve one — approving with a lock,
 * reopening, archiving, overriding. `field` adds the reason or summary that is
 * kept in the history; `required` refuses to confirm without it.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = 'primary',
  field,
  extra,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  field?: { label: string; placeholder?: string; required?: boolean; initial?: string };
  extra?: ReactNode;
  busy?: boolean;
  onConfirm: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(field?.initial ?? '');
  useEffect(() => {
    if (open) setText(field?.initial ?? '');
  }, [open, field?.initial]);
  const blocked = Boolean(field?.required && !text.trim());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={cx(tone === 'danger' ? 'btn-danger' : 'btn-primary', 'btn-sm')}
            disabled={blocked || busy}
            onClick={() => onConfirm(text.trim())}
          >
            {busy && <Spinner size={14} />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {body && <div className="text-[13.5px] leading-relaxed text-ink-muted">{body}</div>}
      {field && (
        <label className="mt-3 block">
          <span className="label">
            {field.label}
            {field.required && <span className="text-status-bad"> *</span>}
          </span>
          <textarea
            className="field min-h-[96px]"
            value={text}
            placeholder={field.placeholder}
            onChange={(event) => setText(event.target.value)}
            autoFocus
          />
        </label>
      )}
      {extra}
    </Modal>
  );
}

let peopleCache: Promise<Person[]> | null = null;

/** Everyone who can be put on the work, loaded once per session. */
export function usePeople(enabled = true) {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    if (!enabled) return;
    if (!peopleCache) {
      peopleCache = lp
        .people()
        .then((response) => response.people)
        .catch(() => {
          peopleCache = null;
          return [];
        });
    }
    let alive = true;
    peopleCache.then((list) => alive && setPeople(list));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return people;
}

export function PersonSelect({
  value,
  onChange,
  people,
  preferred = [],
  placeholder,
  id,
  disabled,
  exclude,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  people: Person[];
  preferred?: string[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  exclude?: string | null;
}) {
  const { t } = useI18n();
  const { first, rest } = useMemo(() => {
    const wanted = new Set(preferred);
    const list = people.filter((person) => person.id !== exclude);
    return { first: list.filter((person) => wanted.has(person.id)), rest: list.filter((person) => !wanted.has(person.id)) };
  }, [people, preferred, exclude]);
  const known = people.some((person) => person.id === value);

  return (
    <select id={id} className="field" value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">{placeholder ?? t('lp.unassigned')}</option>
      {value && !known && <option value={value}>{t('lp.currentPerson')}</option>}
      {first.length > 0 && (
        <optgroup label={t('lp.team')}>
          {first.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={t('lp.everyone')}>
        {rest.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

/* ── the course workspace's own furniture ────────────────────────── */

/**
 * A course's cover: its uploaded image, or a tile built from its own name.
 *
 * Every course gets a picture either way. The fallback is deterministic — the
 * same course keeps the same tint across sessions and screens — so a list of
 * covers stays recognisable without anybody having to upload one.
 */
export function CourseCover({
  courseId,
  name,
  hasCover,
  stamp,
  size = 68,
  className,
}: {
  courseId: string;
  name: string;
  hasCover: boolean;
  stamp?: string;
  size?: number;
  className?: string;
}) {
  const radius = Math.round(size / 4.2);
  if (hasCover) {
    return (
      <img
        src={paths.cover(courseId, stamp)}
        alt=""
        loading="lazy"
        className={cx('shrink-0 border border-surface-line object-cover', className)}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  const tint = COVER_TINTS[hashOf(courseId || name) % COVER_TINTS.length];
  return (
    <span
      aria-hidden="true"
      className={cx('grid shrink-0 place-items-center border font-extrabold', className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size / 3),
        background: tint.background,
        borderColor: tint.border,
        color: tint.ink,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Two letters that survive Arabic, English and a one-word name alike. */
export function initialsOf(name: string) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 2);
  return `${words[0][0]}${words[1][0]}`;
}

/** A stable small integer for a string — the only thing the tints are chosen by. */
function hashOf(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}

const COVER_TINTS = [
  { background: 'linear-gradient(135deg,#EFF6FC,#D8E9F7)', border: '#B4D4EF', ink: '#175C99' },
  { background: 'linear-gradient(135deg,#F5F3FF,#EDE9FE)', border: '#DDD6FE', ink: '#6D28D9' },
  { background: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)', border: '#FDE68A', ink: '#B45309' },
  { background: 'linear-gradient(135deg,#F0F9FF,#E0F2FE)', border: '#BAE6FD', ink: '#0369A1' },
  { background: 'linear-gradient(135deg,#FFF1F2,#FFE4E6)', border: '#FECDD3', ink: '#BE123C' },
  { background: 'linear-gradient(135deg,#ECFDF3,#DCFCE7)', border: '#BBF7D0', ink: '#15803D' },
];

/** The lesson's picture in a content row — the same deterministic tint, smaller. */
export function LessonThumb({ seed, className }: { seed: string; className?: string }) {
  const tint = COVER_TINTS[hashOf(seed) % COVER_TINTS.length];
  return (
    <span
      aria-hidden="true"
      className={cx('relative block h-9 w-[52px] shrink-0 overflow-hidden rounded-lg border', className)}
      style={{ background: tint.background, borderColor: tint.border }}
    >
      <span className="absolute inset-x-2 bottom-2 block h-[5px] rounded" style={{ background: tint.ink, opacity: 0.35 }} />
    </span>
  );
}

/**
 * One compact figure: a number, what it counts, and — when the number is a
 * percentage — the bar that number is.
 */
export function KpiCard({
  label,
  value,
  sub,
  progress,
  bad,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  progress?: number;
  bad?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-surface-line bg-white p-4">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-muted">
        {icon}
        {label}
      </p>
      <p className={cx('mt-1.5 text-[26px] font-extrabold leading-none tabular-nums', bad ? 'text-status-bad' : 'text-ink')}>{value}</p>
      {progress !== undefined && <ProgressBar value={progress} className="!mt-2.5 !h-2" />}
      {sub && <p className="mt-1.5 text-[12px] text-ink-faint">{sub}</p>}
    </div>
  );
}

/** The stage's own name, tinted — a label for which stage, never for its state. */
export function StageTag({ type, className }: { type: AssetType; className?: string }) {
  const { t } = useI18n();
  const Icon = STAGE_ICON[type];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-extrabold', STAGE_TAG[type], className)}>
      <Icon size={12} aria-hidden="true" />
      {t(stageKey(type))}
    </span>
  );
}

/** One line of "this needs somebody": a sentence, its detail, and a way in. */
export function AttentionNote({ title, body, to, icon }: { title: ReactNode; body?: ReactNode; to?: string; icon?: ReactNode }) {
  const inner = (
    <>
      <span className="flex items-start gap-2">
        {icon && <span className="mt-0.5 shrink-0 text-ink-muted">{icon}</span>}
        <span className="min-w-0">
          <span className="block text-[13px] font-bold text-ink">{title}</span>
          {body && <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-muted">{body}</span>}
        </span>
      </span>
    </>
  );
  const className = 'block rounded-xl border border-surface-line bg-surface-bg px-3 py-2.5';
  return to ? (
    <Link to={to} className={cx(className, 'transition-colors hover:border-brand-200 hover:bg-brand-50/60')}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-faint',
  info: 'text-brand-600',
  review: 'text-indigo-700',
  warn: 'text-accent-700',
  ok: 'text-status-ok',
  bad: 'text-status-bad',
};

/**
 * One stage of one lesson, at content-row size: the stage on its coloured
 * edge, its state underneath. Five of these across a row is the whole point of
 * the content tab — a reader scans a column, not a row, to find where a course
 * is stuck.
 */
export function StageCell({ type, asset, courseId, lessonId }: { type: AssetType; asset?: AssetSummary; courseId: string; lessonId: string }) {
  const { t } = useI18n();
  const overdue = asset?.dueState === 'OVERDUE';
  const tone: Tone = !asset ? 'neutral' : asset.blocked ? 'neutral' : overdue ? 'bad' : STATUS_META[asset.status].tone;
  const state = !asset ? '—' : asset.blocked ? t('lp.blocked') : overdue ? t('lp.due.OVERDUE') : t(statusKey(asset.status));
  const body = (
    <>
      <b className="block text-[11px] font-bold text-ink">{t(stageKey(type))}</b>
      <span className={cx('block truncate text-[10.5px] font-semibold', TONE_TEXT[tone])}>{state}</span>
    </>
  );
  const className = 'block min-w-0 rounded-lg border-s-[3px] bg-surface-bg px-2 py-1.5 text-start';
  if (!asset) {
    return (
      <span className={className} style={{ borderInlineStartColor: STAGE_HEX[type] }}>
        {body}
      </span>
    );
  }
  return (
    <Link
      to={assetRoute(courseId, lessonId, type)}
      className={cx(className, 'transition-colors hover:bg-surface-sunken')}
      style={{ borderInlineStartColor: STAGE_HEX[type] }}
      title={`${t(stageKey(type))}: ${state}`}
    >
      {body}
    </Link>
  );
}

/* ── history ─────────────────────────────────────────────────────── */

/** History in sentences: "Sara requested changes on PPT v2", never an event code. */
export function ActivityFeed({ entries, people, showWhere = true, empty }: { entries: ActivityEntry[]; people: People; showWhere?: boolean; empty?: string }) {
  const { t } = useI18n();
  if (entries.length === 0) return <p className="py-6 text-center text-[13px] text-ink-faint">{empty ?? t('lp.activity.empty')}</p>;

  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const actor = entry.actorUserId ? people[entry.actorUserId]?.name ?? t('common.removedUser') : t('lp.activity.system');
        const stage = entry.asset ? t(stageKey(entry.asset.assetType)) : '';
        const version = entry.versionNumber ?? (entry.metadata.versionNumber as number | undefined) ?? '';
        const milestone = entry.metadata.courseMilestone as number | null | undefined;
        const count = (entry.metadata.count as number | undefined) ?? 0;
        const key = `lp.activity.${entry.eventType}${count > 1 ? '_many' : ''}${entry.metadata.preview ? '_preview' : ''}` as StringKey;
        const sentence = t(key, { actor, stage, version: String(version), count });
        const link =
          entry.course && entry.lesson && entry.asset
            ? assetRoute(entry.course.id, entry.lesson.id, entry.asset.assetType)
            : entry.course && entry.lesson
              ? `/learning-production/courses/${entry.course.id}/lessons/${entry.lesson.id}`
              : entry.course
                ? `/learning-production/courses/${entry.course.id}`
                : null;
        const reason = (entry.metadata.reason ?? entry.metadata.summary) as string | undefined;

        return (
          <li key={entry.id} className="flex gap-2.5">
            <Avatar name={actor} color={entry.actorUserId ? people[entry.actorUserId]?.avatarColor : '#94A3B8'} size={26} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-ink">
                {link ? (
                  <Link to={link} className="hover:text-brand-600 hover:underline">
                    {sentence}
                  </Link>
                ) : (
                  sentence
                )}
              </p>
              {reason && <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-muted">“{reason}”</p>}
              {milestone ? (
                <p className="mt-0.5 text-[12px] font-semibold text-status-ok">{t('lp.activity.milestone', { course: entry.course?.name ?? '', n: milestone })}</p>
              ) : null}
              <p className="mt-0.5 truncate text-[11.5px] text-ink-faint">
                {showWhere && entry.lesson ? `${entry.course?.name ?? ''} · ${entry.lesson.name} · ` : showWhere && entry.course ? `${entry.course.name} · ` : ''}
                {timeAgo(entry.createdAt, t)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
