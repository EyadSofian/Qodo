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
import { lp } from '../../lib/learningProduction/api';
import {
  DUE_TONE,
  PRIORITY_TONE,
  STAGE_COLOR,
  STAGE_ICON,
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
import type { ActivityEntry, AssetStatus, AssetType, DueState, People, Person, Priority } from '../../lib/learningProduction/types';

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

export function DueChip({ dueDate, dueState }: { dueDate: string | null; dueState: DueState }) {
  const { t, lang } = useI18n();
  if (!dueDate) return <span className="text-[12px] text-ink-faint">—</span>;
  if (!dueState) return <span className="text-[12px] text-ink-muted">{formatDay(dueDate, lang)}</span>;
  return (
    <Chip tone={DUE_TONE[dueState]}>
      {dueState === 'OVERDUE' ? <AlertTriangle size={12} aria-hidden="true" /> : <CalendarClock size={12} aria-hidden="true" />}
      {t(`lp.due.${dueState}` as StringKey)} · {formatDay(dueDate, lang)}
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
