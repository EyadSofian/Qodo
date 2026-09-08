/**
 * Qodo Projects — the pieces every screen is built from.
 *
 * Eleven screens were each inventing their own page header, their own status
 * chip and their own way of saying "3 days late". The result was not ugly so
 * much as *untrustworthy*: the same task looked urgent on one tab and ordinary
 * on the next, and a reader has no way to tell which screen is lying.
 *
 * So the vocabulary is here, the judgement behind it is in `lib/projects/health.ts`,
 * and a screen's job is to choose which of these to show — never to decide what
 * "late" means.
 *
 * Two rules run through all of it.
 *
 * **Colour never carries meaning alone.** Every tone ships with a word or an
 * icon. WCAG 1.4.1, but also just true: roughly one man in twelve cannot
 * separate the amber from the red, and "the red rows are the late ones" is not
 * an interface for them.
 *
 * **Nothing is positioned left or right.** `ms-`, `ps-`, `text-start`,
 * `inset-inline-start`. Arabic is the default language here, and a layout that
 * mirrors correctly is one code path rather than two.
 */

import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { cx } from '../../lib/utils';
import type { WorkStatus } from '../../lib/projects/types';
import {
  CATEGORY_TONE,
  PRIORITY_TONE,
  SEVERITY_TONE,
  expectedProgress,
  scheduleOf,
  scheduleTone,
  type Schedule,
  type Tone,
} from '../../lib/projects/health';

/* ------------------------------------------------------------------ */
/* Tones                                                               */
/* ------------------------------------------------------------------ */

/**
 * The five tones, as the classes that paint them.
 *
 * Held as a record rather than composed at each call site so a tone cannot be
 * spelled two ways. `neutral` is the default and it is genuinely neutral — the
 * commonest state on any screen should be the quietest thing on it.
 */
const TONE_CHIP: Record<Tone, string> = {
  ok: 'bg-status-okBg text-status-ok',
  info: 'bg-status-infoBg text-status-info',
  warn: 'bg-status-warnBg text-accent-700',
  bad: 'bg-status-badBg text-status-bad',
  neutral: 'bg-surface-sunken text-ink-muted',
};

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-status-ok',
  info: 'text-status-info',
  warn: 'text-accent-700',
  bad: 'text-status-bad',
  neutral: 'text-ink-muted',
};

const TONE_FILL: Record<Tone, string> = {
  ok: 'bg-status-ok',
  info: 'bg-brand-500',
  warn: 'bg-accent-500',
  bad: 'bg-status-bad',
  neutral: 'bg-ink-faint',
};

export { TONE_CHIP, TONE_TEXT, TONE_FILL };

/* ------------------------------------------------------------------ */
/* Page header                                                         */
/* ------------------------------------------------------------------ */

/**
 * The top of a screen: what this is, what it is for, and the one thing to do.
 *
 * The description is not decoration. Somebody opening "Phases" for the first
 * time does not know what a phase is, and a heading that says "Phases" over an
 * empty table teaches them nothing. One sentence under the title is the
 * cheapest documentation in the product.
 *
 * `actions` holds the primary call to action last, because that is where the
 * eye finishes in both directions once the row is reversed.
 */
export function PageHeader({
  icon,
  title,
  description,
  actions,
  meta,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx('mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
          {icon && (
            <span className="text-brand-500" aria-hidden="true">
              {icon}
            </span>
          )}
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>
        )}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * A section inside a screen, with the same treatment one step down.
 *
 * `hint` exists for the same reason `description` does on the page header, and
 * is used far more: most of the confusing words in this product are section
 * names, not page names.
 */
export function SectionCard({
  title,
  hint,
  help,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  hint?: string;
  /** A glossary key. Renders the small "?" beside the title. */
  help?: StringKey;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('card', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-surface-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
            {title}
            {help && <HelpTip body={help} />}
          </h2>
          {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{hint}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Help                                                               */
/* ------------------------------------------------------------------ */

/**
 * An inline explanation of a term the reader may not know.
 *
 * The brief this was built to is "somebody opening the system for the first
 * time understands what they are looking at", and the honest obstacle to that
 * is vocabulary: critical path, earned value, baseline, billable. Every one of
 * those is a word this product uses as though everybody knows it.
 *
 * Built as a `<button>` rather than a `title` attribute for three reasons: a
 * native tooltip never appears on a touch screen, it cannot be reached from the
 * keyboard, and it is not announced by every screen reader. This is focusable,
 * opens on hover *or* focus, and is wired to its panel with `aria-describedby`
 * so the text is read out as part of the control rather than lost.
 */
export function HelpTip({ body, label }: { body: StringKey; label?: string }) {
  const { t } = useI18n();
  // Stable enough for a describedby link and cheap — the key is unique per
  // term and there is never more than one of the same tip in a heading.
  const id = `tip-${String(body).replace(/[^a-zA-Z0-9]/g, '-')}`;

  return (
    <span className="pj-tip relative inline-flex">
      <button
        type="button"
        aria-label={label ?? t('ui.help')}
        aria-describedby={id}
        // A hint is not an action. Making it a real button keeps it keyboard
        // reachable, but the click must not submit a form it happens to sit in.
        className="grid h-5 w-5 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink-muted"
      >
        <HelpCircle size={13} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip" className="pj-tip-panel">
        {t(body)}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Pills                                                              */
/* ------------------------------------------------------------------ */

export function TonePill({
  tone = 'neutral',
  icon,
  children,
  title,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span className={cx('chip', TONE_CHIP[tone], className)} title={title}>
      {icon}
      {children}
    </span>
  );
}

/**
 * A status, in the organization's own words and its own colour.
 *
 * The dot is the status's configured colour; the chip behind it is the
 * *category's* tone. That split is deliberate — an administrator may paint
 * "Blocked" pink, and the screen still needs to read as "not done" at a glance.
 */
export function StatusPill({ status, className }: { status: WorkStatus | null; className?: string }) {
  const { pick, t } = useI18n();
  if (!status) {
    return (
      <span className={cx('chip bg-surface-sunken text-ink-faint', className)}>{t('common.none')}</span>
    );
  }

  return (
    <span className={cx('chip', TONE_CHIP[CATEGORY_TONE[status.category]], className)}>
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: status.color }}
      />
      {pick(status.label)}
    </span>
  );
}

export function PriorityPill({
  priority,
  className,
}: {
  priority: 'low' | 'normal' | 'high' | 'urgent';
  className?: string;
}) {
  const { t } = useI18n();
  const tone = PRIORITY_TONE[priority];

  // The two quiet priorities render as plain text. A chip around "normal" on
  // every row of a two-hundred-row table is two hundred pieces of furniture
  // carrying no information.
  if (tone === 'neutral') {
    return (
      <span className={cx('text-[12px] text-ink-faint', className)}>
        {t(`priority.${priority}` as StringKey)}
      </span>
    );
  }

  return (
    <TonePill tone={tone} className={className}>
      {t(`priority.${priority}` as StringKey)}
    </TonePill>
  );
}

export function SeverityPill({ severity, className }: { severity: string; className?: string }) {
  const { t } = useI18n();
  return (
    <TonePill tone={SEVERITY_TONE[severity] ?? 'neutral'} className={className}>
      {t(`issues.severity.${severity}` as StringKey)}
    </TonePill>
  );
}

/* ------------------------------------------------------------------ */
/* Dates                                                              */
/* ------------------------------------------------------------------ */

/**
 * A due date that says what it means.
 *
 * "2026-11-14" requires the reader to work out what day it is and subtract.
 * "3 days late" does not. Both are shown — the relative phrase for scanning,
 * the date itself for anybody who needs the actual day — with the ISO date
 * kept in `title` rather than replaced.
 */
export function DueBadge({
  date,
  status,
  className,
  showDate = true,
}: {
  date: string | null;
  status?: WorkStatus | null;
  className?: string;
  showDate?: boolean;
}) {
  const { t } = useI18n();
  const schedule = scheduleOf(date, status);
  const tone = scheduleTone(schedule);

  const phrase = phraseFor(schedule, t);
  if (!phrase) {
    return <span className={cx('text-[12px] text-ink-faint', className)}>{t('schedule.noDate')}</span>;
  }

  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12px]', className)} title={date ?? undefined}>
      <span className={cx('font-semibold', TONE_TEXT[tone])}>{phrase}</span>
      {showDate && date && <span className="ltr text-ink-faint">{date}</span>}
    </span>
  );
}

function phraseFor(schedule: Schedule, t: (key: StringKey, vars?: Record<string, string | number>) => string) {
  switch (schedule.state) {
    case 'late':
      return t('schedule.lateBy', { n: schedule.days });
    case 'due-today':
      return t('schedule.dueToday');
    case 'due-soon':
      return t('schedule.dueInDays', { n: schedule.days });
    case 'closed':
      return t('schedule.finished');
    case 'scheduled':
      return t('schedule.dueInDays', { n: schedule.days });
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Progress                                                           */
/* ------------------------------------------------------------------ */

/**
 * A progress bar that also says where the work *should* be.
 *
 * A bare "62%" answers a question nobody asked. 62% is excellent in week two
 * and a crisis in week nine, and the only way a reader can tell the difference
 * is to know what today's target was — so the target is drawn on the bar as a
 * hairline, and the two are compared for them.
 *
 * When there are no dates there is no expectation, the mark is omitted, and the
 * bar goes back to being a bare percentage. That is honest rather than
 * unhelpful: an invented target would be worse than none.
 */
export function ProgressMeter({
  value,
  startDate,
  endDate,
  tone = 'info',
  showLabel = true,
  className,
}: {
  value: number | null;
  startDate?: string | null;
  endDate?: string | null;
  tone?: Tone;
  showLabel?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const percent = value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  const expected = expectedProgress(startDate, endDate);

  return (
    <div className={className}>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between gap-2 text-[12px]">
          <span className="font-semibold text-ink-muted">{t('progress.label')}</span>
          <span className={cx('font-bold tabular-nums', TONE_TEXT[tone])}>
            {percent === null ? '—' : `${Math.round(percent)}%`}
          </span>
        </div>
      )}
      <div
        className="pj-meter"
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('progress.label')}
      >
        <span className={cx('pj-meter-fill', TONE_FILL[tone])} style={{ width: `${percent ?? 0}%` }} />
        {expected !== null && percent !== null && (
          <span
            className="pj-meter-expected"
            aria-hidden="true"
            style={{ insetInlineStart: `${expected}%` }}
            title={t('progress.expected', { n: Math.round(expected) })}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Numbers                                                            */
/* ------------------------------------------------------------------ */

/**
 * One figure and what it means.
 *
 * `hint` and `help` are both here because they answer different questions:
 * `hint` is the supporting number ("of 940 planned"), `help` is what the word
 * itself means. A tile showing "1.04" labelled "CPI" needs the second one.
 *
 * The tile is only tinted when its tone is not neutral, and callers are
 * expected to pass a tone only when it is *earned*. A dashboard where every
 * tile is coloured is a dashboard where none of them is a signal.
 */
export function StatTile({
  label,
  value,
  hint,
  help,
  icon,
  tone = 'neutral',
  footer,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  help?: StringKey;
  icon?: ReactNode;
  tone?: Tone;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cx(
        'card p-3.5',
        tone === 'bad' && 'border-status-bad/30 bg-status-badBg/40',
        tone === 'warn' && 'border-accent-400/40 bg-status-warnBg/40',
        tone === 'ok' && 'border-status-ok/25 bg-status-okBg/40',
        className
      )}
    >
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-muted">
        {icon && (
          <span className={tone === 'neutral' ? 'text-ink-faint' : TONE_TEXT[tone]} aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="min-w-0 truncate">{label}</span>
        {help && <HelpTip body={help} />}
      </p>
      <p className={cx('mt-1 text-2xl font-bold tabular-nums', tone === 'neutral' ? 'text-ink' : TONE_TEXT[tone])}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[12px] text-ink-faint">{hint}</p>}
      {footer && <div className="mt-2">{footer}</div>}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Loading                                                            */
/* ------------------------------------------------------------------ */

/**
 * Placeholder rows in the shape of the content that is coming.
 *
 * A spinner in the middle of an empty card tells the reader that something is
 * happening; a skeleton tells them *what* is happening, and the page does not
 * jump when the data lands because the space was already the right size.
 */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cx('space-y-2', className)} role="status" aria-label={t('ui.loading')}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton h-11 w-full" />
      ))}
      <span className="sr-only">{t('ui.loading')}</span>
    </div>
  );
}

export function SkeletonCards({ cards = 6, className }: { cards?: number; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cx('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)} role="status" aria-label={t('ui.loading')}>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="skeleton h-36 w-full rounded-2xl" />
      ))}
      <span className="sr-only">{t('ui.loading')}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

/**
 * A failed load, with the one thing worth doing about it.
 *
 * `role="alert"` rather than a silent red box: a request that failed after the
 * page rendered is exactly the change a screen-reader user would otherwise
 * never learn about.
 */
export function ErrorState({
  title,
  body,
  onRetry,
  className,
}: {
  title?: string;
  body: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div role="alert" className={cx('card flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      <h3 className="text-base font-bold text-ink">{title ?? t('projects.error.load')}</h3>
      <p className="max-w-md text-sm leading-relaxed text-ink-muted">{body}</p>
      {onRetry && (
        <button type="button" className="btn-ghost btn-sm" onClick={onRetry}>
          {t('ui.retry')}
        </button>
      )}
    </div>
  );
}
