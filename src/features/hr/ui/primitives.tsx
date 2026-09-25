/**
 * HR V2's primitives: frosted glass on colour. Sheets are translucent white
 * over the aurora, every figure carries a colour, and each page opens on a
 * hero in its area's gradient — with real faces where Odoo has them.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { initialsOf, num, useHRText, workingDays } from '../format';
import { PRIORITY_LABEL, SLA_LABEL, STATUS_LABEL } from '../labels';
import type { Priority, RequestStatus, SlaSnapshot } from '../types';
import { AREA_THEME, areaOf, gradient, initialsGradient } from './theme';
import { PRIORITY_TONE, SLA_TONE, STATUS_TONE, TONE, type Tone } from './tones';

export function Card({ children, className, as: Tag = 'section', padded = true }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article'; padded?: boolean }) {
  return <Tag className={cx('hr-glass rounded-3xl', padded && 'p-5 sm:p-6', className)}>{children}</Tag>;
}

export interface Face {
  name: string;
  photoUrl?: string | null;
}

/** Overlapping faces — real photos first, colourful initials after. */
export function FaceStack({ faces, size = 34, max = 6, className }: { faces: Face[]; size?: number; max?: number; className?: string }) {
  if (!faces.length) return null;
  const shown = faces.slice(0, max);
  const extra = faces.length - shown.length;
  return (
    <span className={cx('flex items-center', className)} aria-hidden="true">
      {shown.map((face, index) => (
        <PersonAvatar key={`${face.name}-${index}`} name={face.name} photoUrl={face.photoUrl} size={size} className={cx('ring-2 ring-white/90 shadow-md', index > 0 && '-ms-2.5')} />
      ))}
      {extra > 0 && <span className="-ms-2.5 grid place-items-center rounded-full bg-white/25 text-[11px] font-bold text-white ring-2 ring-white/90 backdrop-blur" style={{ width: size, height: size }}>+{extra}</span>}
    </span>
  );
}

/** Soft shapes behind a hero: rings, a glow, a dot field and the area's own icon, oversized and faint. */
function HeroArt({ icon: Icon, floating }: { icon: LucideIcon; floating: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -end-20 -top-24 h-72 w-72 rounded-full bg-white/10" />
      <div className="absolute -bottom-40 end-16 h-80 w-80 rounded-full border-[30px] border-white/[0.07]" />
      <div className="absolute end-1/3 top-0 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(rgb(255_255_255/0.35)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_left,black,transparent_65%)] rtl:[mask-image:linear-gradient(to_right,black,transparent_65%)]" />
      <Icon size={210} strokeWidth={1.2} className="absolute -bottom-12 -end-8 rotate-[-10deg] text-white/[0.09]" />
      {floating && (
        <>
          <div className="hr-float absolute end-10 top-1/2 -mt-12 hidden sm:block">
            <div className="grid h-24 w-24 place-items-center rounded-[28px] border border-white/35 bg-white/15 shadow-[0_20px_40px_-18px_rgb(15_23_42/0.5),inset_0_1px_0_rgb(255_255_255/0.4)] backdrop-blur-md">
              <Icon size={42} strokeWidth={1.8} className="text-white drop-shadow" />
            </div>
          </div>
          <div className="hr-float-slow absolute end-40 top-6 hidden h-10 w-10 rounded-2xl border border-white/30 bg-white/15 backdrop-blur-md lg:block" />
          <div className="hr-float absolute bottom-7 end-36 hidden h-6 w-16 rounded-full border border-white/30 bg-white/20 backdrop-blur-md lg:block" style={{ animationDelay: '-3s' }} />
        </>
      )}
    </div>
  );
}

/**
 * The page hero, in the current area's gradient. `faces` shows the people the
 * page is about; `stats` sits along the bottom as frosted chips.
 */
export function PageHeader({ eyebrow, title, description, actions, faces, stats }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; faces?: Face[]; stats?: ReactNode }) {
  const { pathname } = useLocation();
  const theme = AREA_THEME[areaOf(pathname)];
  return (
    <header
      className="relative isolate overflow-hidden rounded-[28px] px-5 py-6 text-white shadow-[0_26px_60px_-32px_rgb(var(--hr-a1)/0.95),inset_0_1px_0_rgb(255_255_255/0.25)] sm:px-8 sm:py-8"
      style={{ backgroundImage: gradient(theme) }}
    >
      <HeroArt icon={theme.icon} floating={!actions} />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-2xl">
          {eyebrow && <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[12px] font-semibold text-white/95 ring-1 ring-white/25 backdrop-blur">{eyebrow}</p>}
          <h1 className="mt-3 text-[26px] font-extrabold leading-tight tracking-tight drop-shadow-sm sm:text-[32px]">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-[13.5px] leading-7 text-white/85">{description}</p>}
          {faces && faces.length > 0 && <FaceStack faces={faces} className="mt-4" />}
        </div>
        {actions && <div className="hr-on-color relative flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {stats && <div className="relative mt-5 flex flex-wrap gap-2">{stats}</div>}
    </header>
  );
}

/** A frosted chip for a hero's bottom row. */
export function HeroStat({ label, value, to }: { label: ReactNode; value: ReactNode; to?: string }) {
  const body = (
    <>
      <span className="text-[18px] font-extrabold tabular-nums">{value}</span>
      <span className="text-[12px] font-semibold text-white/85">{label}</span>
    </>
  );
  const className = 'inline-flex items-baseline gap-2 rounded-2xl border border-white/25 bg-white/15 px-3.5 py-2 backdrop-blur transition-colors';
  return to ? <Link to={to} className={cx(className, 'hover:bg-white/25')}>{body}</Link> : <span className={className}>{body}</span>;
}

export function SectionTitle({ title, hint, action, id }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
      {/* The title keeps 15rem before a wide action drops to its own line. */}
      <div className="flex min-w-0 flex-1 basis-60 items-start gap-2.5">
        <span className="mt-1 h-5 w-1.5 shrink-0 rounded-full bg-[linear-gradient(180deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))]" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id={id} className="text-[15.5px] font-bold text-navy">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{hint}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 text-[12.5px] font-semibold">{action}</div>}
    </div>
  );
}

/** Colour pairs a metric's icon chip and glow take by tone; neutral takes the area's own. */
const TONE_COLORS: Record<Tone, [string, string]> = {
  critical: ['225 29 72', '239 68 68'],
  warning: ['245 158 11', '234 88 12'],
  info: ['14 165 233', '37 99 235'],
  success: ['16 185 129', '22 163 74'],
  neutral: ['var(--hr-a1)', 'var(--hr-a2)'],
};
const rgb = (value: string) => `rgb(${value})`;

/** A figure that drills into its rows. A metric that cannot be clicked has nowhere to go and says so by not being a link. */
export function Metric({ label, value, hint, to, tone = 'neutral', emphasis = false, onClick, icon: Icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; to?: string; tone?: Tone; emphasis?: boolean; onClick?: () => void; icon?: LucideIcon }) {
  const [from, to2] = TONE_COLORS[tone];
  const body = (
    <>
      <span className="pointer-events-none absolute -end-10 -top-12 h-32 w-32 rounded-full opacity-30 blur-2xl transition-opacity duration-300 group-hover:opacity-50" style={{ background: `radial-gradient(circle, ${rgb(from)}, transparent 70%)` }} aria-hidden="true" />
      <span className="relative flex items-center gap-2 text-[12px] font-semibold text-slate-600">
        {Icon ? (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white shadow-[0_8px_16px_-8px_rgb(15_23_42/0.45)]" style={{ backgroundImage: `linear-gradient(135deg, ${rgb(from)}, ${rgb(to2)})` }}>
            <Icon size={15} aria-hidden="true" />
          </span>
        ) : (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_4px_rgb(255_255_255/0.7)]" style={{ backgroundImage: `linear-gradient(135deg, ${rgb(from)}, ${rgb(to2)})` }} aria-hidden="true" />
        )}
        <span className="line-clamp-2 leading-4">{label}</span>
      </span>
      <span className={cx('relative mt-2 block font-extrabold tabular-nums tracking-tight text-navy', emphasis ? 'text-[30px] leading-9' : 'text-[24px] leading-8')}>{value}</span>
      {hint && <span className="relative mt-0.5 block truncate text-[11.5px] text-slate-500">{hint}</span>}
    </>
  );
  const className = 'hr-glass group relative block min-w-0 overflow-hidden rounded-3xl px-4 py-4 text-start';
  if (to) return <Link to={to} className={cx(className, 'hr-lift')}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cx(className, 'hr-lift w-full')}>{body}</button>;
  return <div className={className}>{body}</div>;
}

export function Badge({ tone = 'neutral', children, dot = false, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold', TONE[tone].bg, TONE[tone].text, TONE[tone].border, className)}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', TONE[tone].dot)} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  const { pick, t } = useHRText();
  if (!priority) return <Badge tone="neutral">{t('بدون أولوية', 'No priority')}</Badge>;
  if (priority === 'critical') {
    return <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-r from-red-500 to-rose-600 px-2.5 py-0.5 text-[11.5px] font-bold text-white shadow-[0_6px_14px_-8px_rgb(225_29_72/0.9)]"><span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />{pick(PRIORITY_LABEL.critical)}</span>;
  }
  return <Badge tone={PRIORITY_TONE[priority]} dot>{pick(PRIORITY_LABEL[priority])}</Badge>;
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  const { pick } = useHRText();
  return <Badge tone={STATUS_TONE[status]}>{pick(STATUS_LABEL[status])}</Badge>;
}

/** "Day 11 / 15" and what is left, with a bar that fills as the clock runs. */
export function SlaMeter({ sla, compact = false }: { sla: SlaSnapshot; compact?: boolean }) {
  const { t, lang, pick } = useHRText();
  const reduce = useReducedMotion();
  if (!sla?.started) return <span className="text-[12px] text-slate-400">{t('يبدأ بعد الاعتماد', 'Starts at approval')}</span>;
  const tone = SLA_TONE[sla.state];
  const target = sla.targetWorkingDays ?? 0;
  const elapsed = sla.elapsedWorkingDays ?? 0;
  const width = Math.min(100, target ? (elapsed / target) * 100 : 100);
  let status: string;
  if (sla.state === 'overdue') status = t(`متأخرة ${workingDays(sla.overdueWorkingDays ?? 0, 'ar')}`, `${workingDays(sla.overdueWorkingDays ?? 0, 'en')} overdue`);
  else if (sla.state === 'met' || sla.state === 'missed') status = pick(SLA_LABEL[sla.state]);
  else if (sla.state === 'paused') status = pick(SLA_LABEL.paused);
  else if (sla.state === 'due_today') status = pick(SLA_LABEL.due_today);
  else status = t(`متبقٍ ${workingDays(sla.remainingWorkingDays ?? 0, 'ar')}`, `${workingDays(sla.remainingWorkingDays ?? 0, 'en')} left`);
  return (
    <div className={cx('min-w-0', compact ? 'w-full max-w-[11rem]' : 'w-full')}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-bold tabular-nums text-navy">{t(`يوم ${num(elapsed, lang)} / ${num(target, lang)}`, `Day ${num(elapsed, lang)} / ${num(target, lang)}`)}</span>
        <span className={cx('truncate font-semibold', TONE[tone].text)}>{status}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200/70" role="meter" aria-valuemin={0} aria-valuemax={target} aria-valuenow={elapsed} aria-label={t('تقدم الـSLA', 'SLA progress')}>
        <motion.span
          className={cx('block h-full rounded-full', TONE[tone].bar)}
          initial={false}
          animate={{ width: `${width}%` }}
          transition={reduce ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

const failedPhotos = new Set<string>();

/**
 * A real photo when Odoo has one; otherwise initials on a colour of their
 * own, never a grey disc and never a generated face. A URL that 404s is
 * remembered and not asked for again.
 */
export function PersonAvatar({ name, photoUrl, size = 40, className, ring = false }: { name: string; photoUrl?: string | null; size?: number; className?: string; ring?: boolean }) {
  const [failed, setFailed] = useState(() => Boolean(photoUrl && failedPhotos.has(photoUrl)));
  useEffect(() => {
    setFailed(Boolean(photoUrl && failedPhotos.has(photoUrl)));
  }, [photoUrl]);
  const showPhoto = Boolean(photoUrl) && !failed;
  const face = (
    <span
      className={cx('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white', !ring && className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)), backgroundImage: showPhoto ? undefined : initialsGradient(name), backgroundColor: showPhoto ? '#E9EFF6' : undefined }}
      aria-hidden="true"
    >
      {showPhoto ? (
        <img
          src={photoUrl ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => {
            if (photoUrl) failedPhotos.add(photoUrl);
            setFailed(true);
          }}
        />
      ) : (
        <span className="drop-shadow-sm">{initialsOf(name)}</span>
      )}
    </span>
  );
  if (!ring) return face;
  // A gradient ring in the area's colours around the face.
  return (
    <span className={cx('inline-grid shrink-0 place-items-center rounded-full p-[3px] shadow-[0_10px_24px_-12px_rgb(var(--hr-a1)/0.8)]', className)} style={{ backgroundImage: 'linear-gradient(135deg, rgb(var(--hr-a1)), rgb(var(--hr-a2)))' }} aria-hidden="true">
      <span className="grid place-items-center rounded-full bg-white p-[2px]">{face}</span>
    </span>
  );
}

/** ● ● ○ — reward progress as filled seats. */
export function ProgressDots({ done, of, label }: { done: number; of: number; label?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={label ?? `${done} / ${of}`}>
      {Array.from({ length: Math.max(1, of) }, (_, index) => (
        <motion.span
          key={index}
          className={cx('block h-2.5 w-2.5 rounded-full border', index < done ? 'border-transparent bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))]' : 'border-slate-300 bg-white')}
          initial={false}
          animate={{ scale: index < done ? 1 : 0.9 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 28 }}
        />
      ))}
    </span>
  );
}

/** A number that eases to its new value instead of jumping. */
export function AnimatedNumber({ value, digits = 0, suffix = '' }: { value: number | null | undefined; digits?: number; suffix?: string }) {
  const { lang } = useHRText();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    if (value === null || value === undefined || !Number.isFinite(value)) {
      element.textContent = '—';
      previous.current = null;
      return undefined;
    }
    const from = previous.current ?? value;
    previous.current = value;
    if (reduce || from === value) {
      element.textContent = `${num(value, lang, digits)}${suffix}`;
      return undefined;
    }
    const controls = animate(from, value, {
      duration: 0.32,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        element.textContent = `${num(latest, lang, digits)}${suffix}`;
      },
    });
    return () => controls.stop();
  }, [value, digits, suffix, lang, reduce]);
  return <span ref={ref} className="tabular-nums">{value === null || value === undefined ? '—' : `${num(value, lang, digits)}${suffix}`}</span>;
}

/** Segmented capacity bar: one cell per allowed job, filled as they are taken. */
export function CapacityBar({ count, limit, tone }: { count: number; limit: number | null; tone: Tone }) {
  if (limit === null) {
    return <span className="text-[12px] font-bold tabular-nums text-navy">{count}</span>;
  }
  const cells = Math.max(limit, count);
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: cells }, (_, index) => (
        <span
          key={index}
          className={cx(
            'h-2 flex-1 rounded-full transition-colors duration-300',
            index < count ? (index >= limit ? TONE.critical.bar : TONE[tone].bar) : 'bg-slate-200/80'
          )}
          style={{ minWidth: 8 }}
        />
      ))}
    </span>
  );
}

export function LinkArrow({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="group inline-flex items-center gap-1 text-[12.5px] font-semibold text-[rgb(var(--hr-a1))] hover:underline">
      {children}
      <ChevronRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

export function KeyValue({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-[13.5px] font-semibold leading-6 text-navy">{value === null || value === undefined || value === '' ? '—' : value}</dd>
    </div>
  );
}
