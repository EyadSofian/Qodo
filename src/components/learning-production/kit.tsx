/**
 * E-Learning Production — the small pieces every screen is built from.
 *
 * Quiet by default: the commonest state on a screen should be the least
 * visible thing on it, and red is kept for work that is actually late.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, AlertTriangle, Ban, CalendarClock, CheckCircle2, Circle, CircleDot, Clock3, Hourglass, MessageSquare, Minus, RotateCcw, Search, type LucideIcon } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { cx, timeAgo } from '../../lib/utils';
import { Avatar, Modal, Spinner } from '../ui';
import { lp, paths } from '../../lib/learningProduction/api';
import {
  DUE_TONE,
  PRIORITY_TONE,
  STAGE_COLOR,
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
  const { t } = useI18n();
  return (
    <header className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label={t('lp.breadcrumb')} className="mb-1.5 flex flex-wrap items-center gap-1 text-[12px] text-ink-faint">
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
let peopleFailed = false;

/** Everyone who can be put on the work, loaded once per session. */
export function usePeople(enabled = true) {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    if (!enabled) return;
    if (!peopleCache) {
      peopleFailed = false;
      peopleCache = lp
        .people()
        .then((response) => response.people)
        .catch((error) => {
          // Said out loud in the picker, not swallowed: an empty list with no
          // reason is how "I can't find anyone" happens.
          console.error('[learning-production] people did not load —', error);
          peopleCache = null;
          peopleFailed = true;
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

const normalize = (value: string | null | undefined) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();

/**
 * Pick a person by typing part of their name, title or department. A plain
 * <select> of a whole organization is a list nobody can find anyone in; this
 * opens with a search box, keeps the likeliest people (the course team) on
 * top, and says why when there is nobody to show.
 */
export function PersonSelect({
  value,
  onChange,
  people,
  preferred = [],
  placeholder,
  id,
  disabled,
  exclude,
  className = 'field',
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  people: Person[];
  preferred?: string[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  exclude?: string | null;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = people.find((person) => person.id === value) ?? null;
  const options = useMemo(() => {
    const wanted = new Set(preferred);
    const needle = normalize(query);
    const list = people.filter(
      (person) =>
        person.id !== exclude &&
        (!needle || [person.name, person.title, person.department].some((field) => normalize(field).includes(needle)))
    );
    return [...list.filter((person) => wanted.has(person.id)), ...list.filter((person) => !wanted.has(person.id))];
  }, [people, preferred, exclude, query]);
  const teamCount = useMemo(() => options.filter((person) => preferred.includes(person.id)).length, [options, preferred]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((current) => Math.min(options.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (options[cursor]) choose(options[cursor].id);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        className={cx(className, 'flex items-center gap-2 text-start')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setCursor(0);
        }}
      >
        {selected ? (
          <>
            <Avatar name={selected.name} color={selected.avatarColor} size={20} />
            <span className="min-w-0 flex-1 truncate">{selected.name}</span>
          </>
        ) : value ? (
          <span className="min-w-0 flex-1 truncate">{t('lp.currentPerson')}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink-faint">{placeholder ?? t('lp.unassigned')}</span>
        )}
        <Search size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
      </button>
      {open && (
        // preventDefault: the picker often sits inside a <label>, which would
        // otherwise re-click the trigger (and close the list) on any click here.
        <div
          className="absolute inset-x-0 top-full z-40 mt-1 min-w-[240px] overflow-hidden rounded-xl border border-surface-line bg-white shadow-panel"
          onKeyDown={onKey}
          onClick={(event) => event.preventDefault()}
        >
          <div className="border-b border-surface-line p-2">
            <input
              autoFocus
              className="field !min-h-9 !py-1.5"
              value={query}
              placeholder={t('lp.people.search')}
              aria-label={t('lp.people.search')}
              aria-controls={listId}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            <li>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] text-ink-muted hover:bg-surface-sunken" onClick={() => choose(null)}>
                {placeholder ?? t('lp.unassigned')}
              </button>
            </li>
            {options.map((person, index) => (
              <li key={person.id} role="option" aria-selected={person.id === value}>
                {index === 0 && teamCount > 0 && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-ink-faint">{t('lp.team')}</p>}
                {index === teamCount && teamCount > 0 && <p className="border-t border-surface-line px-3 pb-1 pt-2 text-[11px] font-semibold text-ink-faint">{t('lp.people.everyone')}</p>}
                <button
                  type="button"
                  className={cx('flex w-full items-center gap-2.5 px-3 py-2 text-start text-[13px] hover:bg-surface-sunken', index === cursor && 'bg-surface-sunken', person.id === value && 'font-semibold')}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(person.id)}
                >
                  <Avatar name={person.name} color={person.avatarColor} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{person.name}</span>
                    {(person.title || person.department) && <span className="block truncate text-[11.5px] text-ink-faint">{[person.title, person.department].filter(Boolean).join(' · ')}</span>}
                  </span>
                </button>
              </li>
            ))}
            {options.length === 0 && (
              <li className="px-3 py-3 text-[12.5px] text-ink-faint">
                {people.length === 0 ? (peopleFailed ? t('lp.people.loadFailed') : t('lp.people.none')) : t('lp.people.noMatch')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
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

/**
 * One lesson asset as a cell: its state in words, with a small icon, and who
 * holds it. Waiting cells say what they wait for ("Waits for the outline"),
 * so a lesson where nothing has started reads as a queue, not as a wall of
 * errors. Colour carries state only — never which stage it is.
 */
export function StageCell({
  type,
  asset,
  courseId,
  lessonId,
  people,
  showLabel = true,
}: {
  type: AssetType;
  asset?: AssetSummary;
  courseId: string;
  lessonId: string;
  people?: People;
  showLabel?: boolean;
}) {
  const { t } = useI18n();
  const view = stageCellView(asset, t);
  const Icon = view.icon;
  const holder = asset?.assigneeUserId && people ? people[asset.assigneeUserId] : null;
  const body = (
    <>
      {showLabel && <b className="block truncate text-[11px] font-semibold text-ink-muted">{t(stageKey(type))}</b>}
      <span className={cx('flex min-w-0 items-center gap-1.5 text-[12px] font-semibold', view.text)}>
        <Icon size={13} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{view.label}</span>
        {holder && (
          <span
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[9px] font-bold text-white"
            style={{ background: holder.avatarColor ?? '#94A3B8' }}
            title={holder.name}
            aria-hidden="true"
          >
            {holder.name.trim().slice(0, 1)}
          </span>
        )}
      </span>
    </>
  );
  const className = cx('block min-w-0 rounded-lg border px-2 py-1.5 text-start', view.box);
  const title = `${t(stageKey(type))}: ${view.label}${holder ? ` — ${holder.name}` : ''}`;
  if (!asset) {
    return (
      <span className={className} title={title}>
        {body}
      </span>
    );
  }
  return (
    <Link to={assetRoute(courseId, lessonId, type)} className={cx(className, 'transition-colors hover:border-slate-300 hover:bg-white')} title={title} aria-label={title}>
      {body}
    </Link>
  );
}

type CellView = { label: string; icon: LucideIcon; text: string; box: string };

/** What a lesson asset cell says and how it looks, in one place for every screen. */
export function stageCellView(asset: AssetSummary | undefined, t: (key: StringKey, vars?: Record<string, string | number>) => string): CellView {
  const quiet = 'border-surface-line bg-white/70';
  if (!asset) return { label: '—', icon: Minus, text: 'text-ink-faint', box: 'border-dashed border-surface-line bg-transparent' };
  if (asset.applicable === false) return { label: t('lp.asset.notApplicableShort'), icon: Minus, text: 'text-ink-faint', box: 'border-dashed border-surface-line bg-transparent' };
  if (asset.blocked) {
    const waiting = asset.waitingFor.map((entry) => t(stageKey(entry))).join(t('lp.listSeparator'));
    return {
      label: waiting ? t('lp.waitsOn', { stages: waiting }) : t('lp.blocked'),
      icon: Clock3,
      text: 'text-ink-faint',
      box: 'border-dashed border-surface-line bg-transparent',
    };
  }
  if (asset.dueState === 'OVERDUE' && !['APPROVED', 'LOCKED'].includes(asset.status)) {
    return { label: t('lp.due.OVERDUE'), icon: AlarmClock, text: 'text-rose-600', box: 'border-rose-200 bg-rose-50/70' };
  }
  switch (asset.status) {
    case 'APPROVED':
    case 'LOCKED':
      return { label: t(statusKey(asset.status)), icon: CheckCircle2, text: 'text-emerald-700', box: 'border-emerald-200 bg-emerald-50/70' };
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
    case 'RESUBMITTED':
      return { label: t('lp.cell.inReview'), icon: Hourglass, text: 'text-indigo-700', box: 'border-indigo-200 bg-indigo-50/70' };
    case 'CHANGES_REQUESTED':
      return { label: t(statusKey(asset.status)), icon: RotateCcw, text: 'text-amber-700', box: 'border-amber-200 bg-amber-50/70' };
    case 'IN_PROGRESS':
      return { label: t(statusKey(asset.status)), icon: CircleDot, text: 'text-sky-700', box: quiet };
    default:
      return { label: asset.assigneeUserId ? t('lp.cell.ready') : t('lp.cell.unassigned'), icon: Circle, text: 'text-ink-muted', box: quiet };
  }
}

/* ── history ─────────────────────────────────────────────────────── */

/** History in sentences: "Sara requested changes on PPT v2", never an event code. */
export function ActivityFeed({ entries, people, showWhere = true, empty }: { entries: ActivityEntry[]; people: People; showWhere?: boolean; empty?: string }) {
  const { t, lang } = useI18n();
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
        const pickPair = (pair: { en: string; ar: string } | null | undefined) => (pair ? (lang === 'en' ? pair.en : pair.ar) : '');
        const sentence = t(key, {
          actor,
          stage,
          version: String(version),
          count,
          task: pickPair(entry.task?.label),
          phase: pickPair(entry.stage?.label),
          issue: entry.issue ? `#${entry.issue.number}` : '',
          release: entry.release?.versionLabel ?? String(entry.metadata.versionLabel ?? ''),
          scenario: entry.metadata.scenario ? t(`lp.scenarioShort.${entry.metadata.scenario}` as StringKey) : '',
        });
        const base = entry.course ? `/learning-production/courses/${entry.course.id}` : null;
        const link =
          entry.course && entry.lesson && entry.asset
            ? assetRoute(entry.course.id, entry.lesson.id, entry.asset.assetType)
            : base && entry.task
              ? `${base}?task=${entry.task.id}`
              : base && entry.issue
                ? `${base}?panel=qa&issue=${entry.issue.id}`
                : base && entry.release
                  ? `${base}?panel=qa&release=${entry.release.id}`
                  : base && entry.stage
                    ? `${base}?stage=${entry.stage.key}`
                    : entry.course && entry.lesson
                      ? `${base}/lessons/${entry.lesson.id}`
                      : base;
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

/**
 * "Made with an AI tool" — recorded on the version it describes. The version
 * is still reviewed and approved by a person other than the one who sent it.
 */
export function ProvenanceField({ value, onChange }: { value: { aiAssisted?: boolean; aiTool?: string }; onChange: (next: { aiAssisted?: boolean; aiTool?: string }) => void }) {
  const { t } = useI18n();
  return (
    <div className="mt-3 rounded-xl border border-surface-line px-3 py-2.5">
      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <input type="checkbox" checked={Boolean(value.aiAssisted)} onChange={(event) => onChange({ ...value, aiAssisted: event.target.checked })} />
        {t('lp.ai.assisted')}
      </label>
      {value.aiAssisted && (
        <label className="mt-2 block">
          <span className="label">{t('lp.ai.tool')}</span>
          <input className="field" value={value.aiTool ?? ''} onChange={(event) => onChange({ ...value, aiTool: event.target.value })} placeholder={t('lp.ai.toolPlaceholder')} maxLength={80} />
          <span className="mt-1 block text-[12px] text-ink-faint">{t('lp.ai.reviewed')}</span>
        </label>
      )}
    </div>
  );
}
