/**
 * E-Learning Production — the studio kit.
 *
 * The small set of pieces every production screen is built from: status
 * pills that always say their state in words (colour is never the only
 * signal), origin badges that say where a step came from, meters, a drawer,
 * a reason prompt, and the "why is this blocked" list. Styling lives in the
 * `.lps-*` classes in index.css.
 */

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  Clock3,
  EyeOff,
  FileSpreadsheet,
  Hourglass,
  Lightbulb,
  Loader2,
  Lock,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  Sparkles,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { cx } from '../../lib/utils';
import { lpErrorKey } from '../../lib/learningProduction/format';
import type { DueState, People } from '../../lib/learningProduction/types';
import type { Blocker, Origin, Pair, Scenario, Source } from '../../lib/learningProduction/runTypes';
import { Avatar } from '../ui';

/* ------------------------------------------------------------------ */
/* Language                                                             */
/* ------------------------------------------------------------------ */

/** Template text comes in both languages; this picks the reader's. */
export function usePick() {
  const { lang } = useI18n();
  return useCallback((pair: Pair | string | null | undefined) => {
    if (!pair) return '';
    if (typeof pair === 'string') return pair;
    return lang === 'en' ? pair.en : pair.ar;
  }, [lang]);
}

/** A calendar day in the reader's language — dates are days, not instants. */
export function useDay() {
  const { lang } = useI18n();
  return useCallback(
    (value: string | null | undefined, { year = false }: { year?: boolean } = {}) => {
      if (!value) return '—';
      const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
      if (Number.isNaN(date.getTime())) return '—';
      return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-EG', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }).format(date);
    },
    [lang]
  );
}

/* ------------------------------------------------------------------ */
/* Pills                                                                */
/* ------------------------------------------------------------------ */

export type PillTone = 'neutral' | 'accent' | 'ok' | 'attention' | 'danger' | 'outline' | 'ai' | 'expert' | 'revamp';

export function Pill({ tone = 'neutral', icon: Icon, children, title, className }: { tone?: PillTone; icon?: LucideIcon; children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={cx('lps-pill', `lps-pill-${tone}`, className)} title={title}>
      {Icon && <Icon size={12} aria-hidden="true" className="shrink-0" />}
      {/* No ellipsis: Chromium adds one to shaped Arabic at sub-pixel widths
          even when the word fits. The pill clips instead, and only if it must. */}
      <span className="min-w-0 overflow-hidden">{children}</span>
    </span>
  );
}

const TASK_TONE: Record<string, { tone: PillTone; icon: LucideIcon }> = {
  BLOCKED: { tone: 'outline', icon: Clock3 },
  READY: { tone: 'neutral', icon: Circle },
  NOT_STARTED: { tone: 'neutral', icon: Circle },
  IN_PROGRESS: { tone: 'accent', icon: CircleDot },
  SUBMITTED: { tone: 'accent', icon: Hourglass },
  UNDER_REVIEW: { tone: 'accent', icon: Hourglass },
  CHANGES_REQUESTED: { tone: 'attention', icon: RotateCcw },
  APPROVED: { tone: 'ok', icon: CheckCircle2 },
  DONE: { tone: 'ok', icon: CheckCircle2 },
  WAIVED: { tone: 'outline', icon: SkipForward },
};

/** A task's state, in words: Blocked, Ready, In progress, Waiting for approval… */
export function TaskStatusPill({ display }: { display: string }) {
  const { t } = useI18n();
  const meta = TASK_TONE[display] ?? TASK_TONE.NOT_STARTED;
  return (
    <Pill tone={meta.tone} icon={meta.icon}>
      {t(`lp.taskStatus.${display}` as StringKey)}
    </Pill>
  );
}

const STAGE_TONE: Record<string, { tone: PillTone; icon: LucideIcon }> = {
  BLOCKED: { tone: 'outline', icon: Lock },
  READY: { tone: 'neutral', icon: Circle },
  IN_PROGRESS: { tone: 'accent', icon: CircleDot },
  DONE: { tone: 'ok', icon: CheckCircle2 },
  SKIPPED: { tone: 'outline', icon: SkipForward },
};

export function StageStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const meta = STAGE_TONE[status] ?? STAGE_TONE.BLOCKED;
  return (
    <Pill tone={meta.tone} icon={meta.icon}>
      {t(`lp.stageStatus.${status}` as StringKey)}
    </Pill>
  );
}

const RUN_TONE: Record<string, PillTone> = { ACTIVE: 'accent', ON_HOLD: 'attention', RELEASED: 'ok', CLOSED: 'outline', CANCELLED: 'outline' };

export function RunStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <Pill tone={RUN_TONE[status] ?? 'neutral'}>{t(`lp.runStatus.${status}` as StringKey)}</Pill>;
}

const HEALTH_TONE: Record<string, { tone: PillTone; icon: LucideIcon }> = {
  ON_TRACK: { tone: 'ok', icon: CheckCircle2 },
  AT_RISK: { tone: 'attention', icon: AlertTriangle },
  DELAYED: { tone: 'danger', icon: XCircle },
  COMPLETED: { tone: 'ok', icon: ShieldCheck },
};

export function HealthPill({ health, title }: { health: string; title?: string }) {
  const { t } = useI18n();
  const meta = HEALTH_TONE[health] ?? HEALTH_TONE.ON_TRACK;
  return (
    <Pill tone={meta.tone} icon={meta.icon} title={title}>
      {t(`lp.health.${health}` as StringKey)}
    </Pill>
  );
}

const ISSUE_TONE: Record<string, PillTone> = { OPEN: 'attention', IN_PROGRESS: 'accent', FIXED: 'accent', VERIFIED: 'ok', WONT_FIX: 'outline' };
const SEVERITY_TONE: Record<string, PillTone> = { LOW: 'outline', MEDIUM: 'neutral', HIGH: 'attention', CRITICAL: 'danger' };

export function IssueStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <Pill tone={ISSUE_TONE[status] ?? 'neutral'}>{t(`lp.issueStatus.${status}` as StringKey)}</Pill>;
}

export function SeverityPill({ severity }: { severity: string }) {
  const { t } = useI18n();
  return (
    <Pill tone={SEVERITY_TONE[severity] ?? 'neutral'} icon={severity === 'CRITICAL' || severity === 'HIGH' ? AlertTriangle : undefined}>
      {t(`lp.issueSeverity.${severity}` as StringKey)}
    </Pill>
  );
}

const RELEASE_TONE: Record<string, PillTone> = {
  CANDIDATE: 'neutral',
  SIGNED_OFF: 'accent',
  PUBLISHED: 'ok',
  SUPERSEDED: 'outline',
  ROLLED_BACK: 'danger',
  WITHDRAWN: 'outline',
};

export function ReleaseStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <Pill tone={RELEASE_TONE[status] ?? 'neutral'}>{t(`lp.releaseStatus.${status}` as StringKey)}</Pill>;
}

const SCENARIO_TONE: Record<Scenario, PillTone> = { AI_NEW: 'ai', EXPERT_NEW: 'expert', REVAMP: 'revamp', LEGACY: 'outline' };

export function ScenarioBadge({ scenario, short = false }: { scenario: Scenario; short?: boolean }) {
  const { t } = useI18n();
  const icon = scenario === 'AI_NEW' ? Sparkles : scenario === 'REVAMP' ? RotateCcw : scenario === 'LEGACY' ? Clock3 : BookOpenCheck;
  return (
    <Pill tone={SCENARIO_TONE[scenario]} icon={icon}>
      {t(`lp.scenario${short ? 'Short' : ''}.${scenario}` as StringKey)}
    </Pill>
  );
}

const DUE_TONE: Record<string, PillTone> = { OVERDUE: 'danger', DUE_TODAY: 'attention', DUE_SOON: 'attention' };

export function DueTag({ dueDate, dueState }: { dueDate: string | null; dueState: DueState }) {
  const { t } = useI18n();
  const day = useDay();
  if (!dueDate) return <span className="lps-faint text-[12px]">—</span>;
  if (!dueState) return <span className="lps-muted whitespace-nowrap text-[12.5px]">{day(dueDate)}</span>;
  return (
    <Pill tone={DUE_TONE[dueState] ?? 'neutral'} icon={Clock3} title={t(`lp.due.${dueState}` as StringKey)}>
      {day(dueDate)} · {t(`lp.due.${dueState}` as StringKey)}
    </Pill>
  );
}

/* ------------------------------------------------------------------ */
/* Where a step came from                                               */
/* ------------------------------------------------------------------ */

const ORIGIN_META: Record<Origin, { icon: LucideIcon; tone: PillTone }> = {
  WORKBOOK: { icon: FileSpreadsheet, tone: 'outline' },
  WORKBOOK_HIDDEN: { icon: EyeOff, tone: 'outline' },
  OLD_PROMPT: { icon: BookOpenCheck, tone: 'outline' },
  PROPOSED: { icon: Lightbulb, tone: 'attention' },
};

/** "Row 12", "Hidden row 26", "Brief", "Proposal" — with the source in the tooltip. */
export function OriginBadge({ origin, source, compact = false }: { origin: Origin; source?: Source | null; compact?: boolean }) {
  const { t } = useI18n();
  const meta = ORIGIN_META[origin] ?? ORIGIN_META.WORKBOOK;
  const rows = source?.rows?.length ? source.rows.join(', ') : source?.row ? String(source.row) : '';
  const where = source?.sheet ? `${source.sheet}${rows ? ` · ${t('lp.origin.row')} ${rows}` : ''}` : source?.cells ? `${t('lp.origin.master')} ${source.cells}` : '';
  const label =
    origin === 'WORKBOOK' && rows && !compact
      ? `${t('lp.origin.row')} ${rows}`
      : origin === 'WORKBOOK_HIDDEN' && rows && !compact
        ? `${t('lp.origin.hiddenRow')} ${rows}`
        : t(`lp.origin.${origin}` as StringKey);
  return (
    <Pill tone={meta.tone} icon={meta.icon} title={[t(`lp.origin.${origin}.hint` as StringKey), where, source?.text ? `“${source.text}”` : ''].filter(Boolean).join('\n')}>
      {label}
    </Pill>
  );
}

/* ------------------------------------------------------------------ */
/* Figures and meters                                                   */
/* ------------------------------------------------------------------ */

const METER_FILL = {
  accent: 'linear-gradient(90deg, rgb(var(--lp-a1, 79 70 229)), rgb(var(--lp-a2, 147 51 234)))',
  ok: 'linear-gradient(90deg, #34d399, #059669)',
  attention: 'linear-gradient(90deg, #fbbf24, #f97316)',
} as const;

export function Meter({ value, label, tone = 'accent' }: { value: number; label?: string; tone?: 'accent' | 'ok' | 'attention' }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="lps-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped} aria-label={label}>
      <span style={{ width: `${clamped}%`, background: METER_FILL[tone] }} />
    </div>
  );
}

/** One compact figure: the number, what it counts, and optionally where it opens. */
/** [chip background, chip icon, number] — colour only where it means something. */
const FIGURE_TONE = {
  neutral: ['#eef1f6', '#475569', 'var(--lps-ink)'],
  accent: ['#eef2ff', '#4f46e5', 'var(--lps-ink)'],
  ok: ['#e7f8ef', '#047857', '#047857'],
  attention: ['#fff4e0', '#b45309', '#b45309'],
  danger: ['#ffe8ee', '#e11d48', '#e11d48'],
  sky: ['#eef1f6', '#475569', 'var(--lps-ink)'],
} as const;

export type FigureTone = keyof typeof FIGURE_TONE;

/** A number that counts up once when it first appears. Text is shown as is. */
export function CountUp({ value }: { value: ReactNode }) {
  const reduce = useReducedMotion();
  const target = typeof value === 'number' ? value : null;
  const [shown, setShown] = useState(reduce || target === null ? target : 0);
  useEffect(() => {
    if (target === null || reduce) {
      setShown(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 700);
      setShown(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduce]);
  return <>{target === null ? value : shown}</>;
}

export function Figure({
  value,
  label,
  hint,
  tone = 'neutral',
  to,
  icon: Icon,
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  tone?: FigureTone;
  to?: string;
  icon?: LucideIcon;
}) {
  const [soft, iconInk, ink] = FIGURE_TONE[tone];
  const style = { '--lps-tone-soft': soft, '--lps-tone-ink': iconInk } as CSSProperties;
  const body = (
    <span className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="font-display block text-[26px] font-bold leading-none" style={{ color: ink }}>
          <CountUp value={value} />
        </span>
        <span className="mt-1.5 block text-[12.5px] font-semibold lps-muted">{label}</span>
        {hint && <span className="block text-[11.5px] lps-faint">{hint}</span>}
      </span>
      {Icon && (
        <span className="lps-figure-chip">
          <Icon size={18} aria-hidden="true" />
        </span>
      )}
    </span>
  );
  return to ? (
    <Link to={to} className="lps-figure" style={style}>
      {body}
    </Link>
  ) : (
    <div className="lps-figure" style={style}>
      {body}
    </div>
  );
}

/**
 * The band at the top of a page: an icon in the area's colour, the title and
 * a line of what the page answers, with the page's main actions and, below,
 * optional figures.
 */
export function PageHero({
  icon: Icon,
  eyebrow,
  title,
  lede,
  actions,
  children,
  style,
  titleClassName,
}: {
  icon?: LucideIcon;
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
  titleClassName?: string;
}) {
  return (
    <header className="lps-hero" style={style}>
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          {Icon && (
            <span className="lps-hero-icon">
              <Icon size={20} aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && <div className="mb-1 text-[12.5px] font-semibold lps-muted">{eyebrow}</div>}
            <h1 className={cx('lps-title', titleClassName)}>{title}</h1>
            {lede && <div className="mt-1 max-w-3xl text-[13.5px] lps-muted">{lede}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* People                                                               */
/* ------------------------------------------------------------------ */

export function PersonLine({ userId, people, fallback, size = 20 }: { userId: string | null | undefined; people: People; fallback?: string; size?: number }) {
  const { t } = useI18n();
  if (!userId) return <span className="lps-faint text-[12.5px]">{fallback ?? t('lp.people.unassigned')}</span>;
  const person = people[userId];
  const name = person?.name ?? t('common.removedUser');
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar name={name} color={person?.avatarColor ?? '#94A3B8'} size={size} />
      <span className="lps-bidi truncate text-[12.5px]">{name}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Why is this blocked                                                  */
/* ------------------------------------------------------------------ */

/** Each thing a task or stage waits for, its state, and who holds it. */
export function BlockerList({ blockers, people, courseId, dense = false }: { blockers: Blocker[]; people: People; courseId: string; dense?: boolean }) {
  const { t } = useI18n();
  const pick = usePick();
  if (!blockers.length) return null;
  return (
    <ul className={cx('space-y-1', dense ? 'text-[12px]' : 'text-[12.5px]')}>
      {blockers.map((blocker) => {
        const what =
          blocker.type === 'STAGE'
            ? t('lp.blocker.stage', { stage: pick(blocker.label ?? null) || t(`lp.stageKey.${blocker.key}` as StringKey) })
            : blocker.type === 'ASSET'
              ? t('lp.blocker.asset', { asset: t(`lp.stage.${blocker.key}` as StringKey) })
              : t('lp.blocker.task', { task: pick(blocker.label ?? null) });
        const who = blocker.assigneeUserId
          ? people[blocker.assigneeUserId]?.name ?? t('common.removedUser')
          : blocker.role || blocker.ownerRole
            ? t(`lp.role.${blocker.role ?? blocker.ownerRole}` as StringKey)
            : null;
        const body = (
          <>
            <Lock size={12} aria-hidden="true" className="mt-[3px] shrink-0 lps-faint" />
            <span className="min-w-0">
              <span className="text-[color:var(--lps-ink)]">{what}</span>
              {blocker.status && <span className="lps-muted"> · {t(`lp.${blocker.type === 'STAGE' ? 'stageStatus' : 'taskStatus'}.${blocker.status}` as StringKey)}</span>}
              {who && <span className="lps-muted"> · {t('lp.blocker.with', { who })}</span>}
            </span>
          </>
        );
        return (
          <li key={`${blocker.type}:${blocker.key}`}>
            {blocker.type === 'TASK' && blocker.id ? (
              <Link to={`/learning-production/courses/${courseId}/plan?task=${blocker.id}`} className="flex gap-1.5 hover:underline">
                {body}
              </Link>
            ) : (
              <span className="flex gap-1.5">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Frames                                                               */
/* ------------------------------------------------------------------ */

export function Panel({ title, action, children, className, bodyClassName, id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section className={cx('lps-panel min-w-0', className)} aria-labelledby={title && id ? id : undefined}>
      {(title || action) && (
        <header className="lps-panel-head">
          {title && (
            <h2 id={id} className="lps-h2">
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      <div className={cx('min-w-0', bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  );
}

export function EmptyNote({ icon: Icon = CircleDashed, title, body, action }: { icon?: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl text-white" style={{ background: 'var(--lps-grad)', boxShadow: '0 12px 24px -12px rgb(var(--lp-a1, 79 70 229) / 0.9)' }}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <p className="text-[14px] font-semibold">{title}</p>
      {body && <p className="max-w-md text-[13px] lps-muted">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton h-9" />
      ))}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="lps-callout flex flex-wrap items-center justify-between gap-2" role="alert">
      <span className="flex items-center gap-2">
        <AlertTriangle size={15} aria-hidden="true" />
        {t(lpErrorKey(error))}
      </span>
      {onRetry && (
        <button type="button" className="lps-btn" onClick={onRetry}>
          {t('lp.action.retry')}
        </button>
      )}
    </div>
  );
}

export function Busy({ label }: { label?: string }) {
  return <Loader2 size={14} className="animate-spin" aria-label={label} />;
}

/** Tabs that are links — a tab is a place you can copy the URL of. */
export function RouteTabs({ items, label }: { items: Array<{ to: string; label: string; count?: number; attention?: boolean; end?: boolean }>; label: string }) {
  const group = useId();
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // On a phone the row scrolls sideways; keep the current place in view.
  useEffect(() => {
    const active = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && nav.current && nav.current.scrollWidth > nav.current.clientWidth) {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [pathname]);
  return (
    <LayoutGroup id={group}>
      <nav ref={nav} aria-label={label} className="lps-tabs">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="lps-tab isolate">
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="pill" className="lps-tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                {item.label}
                {item.count ? <span className={cx('lps-count', item.attention && 'lps-count-attention')}>{item.count}</span> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </LayoutGroup>
  );
}

/** A small set of mutually exclusive options, as a tablist. */
export function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (value: T) => void; label: string }) {
  const group = useId();
  return (
    <LayoutGroup id={group}>
      <div role="tablist" aria-label={label} className="lps-tabs">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={option.value === value}
            className="lps-tab isolate"
            onClick={() => onChange(option.value)}
          >
            {option.value === value && <motion.span layoutId="pill" className="lps-tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
            {option.label}
            {option.count !== undefined && <span className="lps-count">{option.count}</span>}
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                               */
/* ------------------------------------------------------------------ */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Open drawers, innermost last: only the top one answers Escape and keeps focus. */
const drawerStack: symbol[] = [];

/**
 * A side panel over the page, on the reader's end side (the left in Arabic).
 * Escape and the scrim close it; focus moves in, stays in, and goes back to
 * whatever opened it.
 */
export function Drawer({ open, onClose, title, subtitle, children, footer, labelledBy }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; labelledBy?: string }) {
  const { t, dir } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const fallbackId = useId();
  const headingId = labelledBy ?? fallbackId;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const self = Symbol('drawer');
    drawerStack.push(self);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (drawerStack[drawerStack.length - 1] !== self) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const index = drawerStack.indexOf(self);
      if (index >= 0) drawerStack.splice(index, 1);
      document.body.style.overflow = previous;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="lps" dir={dir}>
      <div className="lps-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} className="lps-drawer focus:outline-none">
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5" style={{ borderColor: 'var(--lps-line)' }}>
          <div className="min-w-0">
            <h2 id={headingId} className="lps-h2 text-[16px]">
              {title}
            </h2>
            {subtitle && <div className="mt-1 min-w-0">{subtitle}</div>}
          </div>
          <button type="button" className="lps-btn-quiet !min-h-9 !px-2" onClick={onClose} aria-label={t('common.close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && (
          <footer className="border-t px-4 py-3 pb-safe sm:px-5 sm:pb-3" style={{ borderColor: 'var(--lps-line)' }}>
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/* Reason prompt                                                        */
/* ------------------------------------------------------------------ */

/**
 * Ask for a reason (or a note) before an action that is kept in the history:
 * waive, skip, reopen, override, withdraw, roll back. The answer is required
 * unless `optional`.
 */
export function ReasonPrompt({
  open,
  title,
  body,
  label,
  confirm,
  optional = false,
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  body?: string;
  label: string;
  confirm: string;
  optional?: boolean;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const id = useId();
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const ready = optional || reason.trim().length > 0;
  return (
    <Drawer
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="lps-btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className={danger ? 'lps-btn-danger' : 'lps-btn-primary'} disabled={!ready || busy} onClick={() => onConfirm(reason.trim())}>
            {busy && <Busy />}
            {confirm}
          </button>
        </div>
      }
    >
      {body && <p className="mb-3 text-[13.5px] lps-muted">{body}</p>}
      {children}
      <label htmlFor={id} className="lps-label">
        {label}
        {!optional && <span aria-hidden="true"> *</span>}
      </label>
      <textarea id={id} className="lps-input min-h-[110px]" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} />
      <p className="mt-1 text-[12px] lps-faint">{t('lp.reason.kept')}</p>
    </Drawer>
  );
}
