import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  MessageSquare,
  RotateCcw,
  Send,
  UserPlus,
  X,
  AlarmClock,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { cx } from '../lib/utils';
import type { LocalisedText, Notification } from '../lib/types';
import { Avatar } from './ui';

/**
 * Live, actionable alerts. The bell remains the durable inbox; this is the
 * attention layer for something that arrived while the workspace is open.
 *
 * Three things make it readable where the old single white card was not. It is
 * dark, so it reads as an interruption against a light workspace instead of
 * looking like one more panel. It says what *kind* of event this is before the
 * sentence — being assigned work and having work sent back are opposite news
 * and used to look identical. And it leaves on its own: an alert that sits
 * there until dismissed stops being an alert by lunchtime.
 */

/** Long enough to read two lines of Arabic without racing it. */
const AUTO_DISMISS_MS = 9000;

/**
 * What each kind of event looks like. Colour carries the verdict — green is
 * something that went well, red is work coming back, amber is a clock running
 * — so the tone is legible before the text is read.
 */
const TONES: Record<
  string,
  { icon: typeof BellRing; ring: string; bar: string; chip: string }
> = {
  'task.assigned': { icon: ClipboardList, ring: 'bg-accent-500', bar: 'bg-accent-400', chip: 'text-accent-100' },
  'task.returned': { icon: RotateCcw, ring: 'bg-status-bad', bar: 'bg-status-bad', chip: 'text-red-100' },
  'task.reset_pending': { icon: RotateCcw, ring: 'bg-status-warn', bar: 'bg-status-warn', chip: 'text-amber-100' },
  'task.submitted': { icon: Send, ring: 'bg-brand-400', bar: 'bg-brand-300', chip: 'text-brand-100' },
  'task.approved': { icon: CheckCircle2, ring: 'bg-status-ok', bar: 'bg-status-ok', chip: 'text-green-100' },
  'task.review_passed': { icon: CheckCircle2, ring: 'bg-brand-400', bar: 'bg-brand-300', chip: 'text-brand-100' },
  'task.awaiting_final_approval': { icon: ClipboardCheck, ring: 'bg-status-warn', bar: 'bg-status-warn', chip: 'text-amber-100' },
  'task.comment': { icon: MessageSquare, ring: 'bg-brand-400', bar: 'bg-brand-300', chip: 'text-brand-100' },
  'task.archived': { icon: Archive, ring: 'bg-ink-muted', bar: 'bg-ink-faint', chip: 'text-white/70' },
  'task.unassigned': { icon: ClipboardList, ring: 'bg-ink-muted', bar: 'bg-ink-faint', chip: 'text-white/70' },
  'account.approved': { icon: CheckCircle2, ring: 'bg-status-ok', bar: 'bg-status-ok', chip: 'text-green-100' },
  'user.join_request': { icon: UserPlus, ring: 'bg-brand-400', bar: 'bg-brand-300', chip: 'text-brand-100' },
  'management.due_soon': { icon: Clock, ring: 'bg-status-warn', bar: 'bg-status-warn', chip: 'text-amber-100' },
  'task.overdue': { icon: AlarmClock, ring: 'bg-status-bad', bar: 'bg-status-bad', chip: 'text-red-100' },
};

const DEFAULT_TONE = {
  icon: BellRing,
  ring: 'bg-brand-500',
  bar: 'bg-brand-300',
  chip: 'text-brand-100',
};

/**
 * A short two-tone chime, synthesised rather than shipped as a file.
 *
 * An audio asset would be a network request that has to succeed before the
 * sound the alert is announcing itself with can play, plus a file to host and
 * cache-bust. Two oscillator notes are a few lines and always ready.
 *
 * Browsers refuse audio until the page has been interacted with, which is
 * correct behaviour and not worth fighting: the call is wrapped so a refusal is
 * silence rather than an unhandled rejection, and the alert itself never
 * depends on the sound having played.
 */
function chime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    if (context.state === 'suspended') void context.resume();

    // Rising, because this is an arrival and not an error.
    [
      { at: 0, hz: 660 },
      { at: 0.12, hz: 880 },
    ].forEach(({ at, hz }) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      // Ramped rather than switched: an abrupt start and stop is heard as a click.
      gain.gain.setValueAtTime(0.0001, context.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + at + 0.16);
      osc.connect(gain).connect(context.destination);
      osc.start(context.currentTime + at);
      osc.stop(context.currentTime + at + 0.18);
    });

    setTimeout(() => void context.close(), 600);
  } catch {
    /* Audio blocked or unavailable — the alert is still on screen. */
  }
}

export function IncomingNotificationPopup() {
  const { incomingNotifications, dismissIncomingNotification, actors, markRead } = useWorkspace();
  const { t, lang } = useI18n();
  const navigate = useNavigate();

  // Sounded once per arrival, keyed by id, so a re-render never re-rings and a
  // second alert landing while the first is up still gets its own chime.
  const soundedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const notification of incomingNotifications) {
      if (soundedRef.current.has(notification.id)) continue;
      soundedRef.current.add(notification.id);
      chime();
    }
    // The set would otherwise grow for the life of the tab.
    if (soundedRef.current.size > 50) soundedRef.current = new Set();
  }, [incomingNotifications]);

  if (incomingNotifications.length === 0) return null;

  const localise = (value: LocalisedText | string) =>
    typeof value === 'string' ? value : (value[lang] ?? value.ar);

  const open = (notification: Notification) => {
    markRead(notification.id).catch(() => {});
    navigate(notification.link);
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-x-3 top-[calc(var(--sat)+var(--topbar-h)+0.75rem)] z-[70] flex flex-col items-center gap-2 sm:items-end sm:px-2">
      {incomingNotifications.map((notification) => (
        <LiveAlert
          key={notification.id}
          notification={notification}
          actor={notification.actorId ? actors[notification.actorId] : undefined}
          title={localise(notification.title)}
          body={localise(notification.body)}
          openLabel={t('shell.openNotification')}
          closeLabel={t('common.close')}
          onOpen={() => open(notification)}
          onDismiss={() => dismissIncomingNotification(notification.id)}
        />
      ))}
    </div>,
    document.body
  );
}

function LiveAlert({
  notification,
  actor,
  title,
  body,
  openLabel,
  closeLabel,
  onOpen,
  onDismiss,
}: {
  notification: Notification;
  actor?: { name: string; avatarColor: string };
  title: string;
  body: string;
  openLabel: string;
  closeLabel: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  // Bumped on every resume so the bar remounts and re-runs from full, keeping
  // it honest about how long is actually left rather than drifting ahead of
  // the timer that does the dismissing.
  const [cycle, setCycle] = useState(0);

  // The timer is the authority, not the animation: `prefers-reduced-motion`
  // can stop the bar from ever finishing, and an alert that then never leaves
  // is the bug this was meant to fix.
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [paused, cycle, onDismiss]);

  const tone = TONES[notification.type] ?? DEFAULT_TONE;
  const Icon = tone.icon;

  return (
    <div
      role="alert"
      aria-live="assertive"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        setPaused(false);
        setCycle((n) => n + 1);
      }}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => {
        setPaused(false);
        setCycle((n) => n + 1);
      }}
      className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl bg-navy shadow-panel ring-1 ring-white/10 animate-pop-in"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="relative shrink-0">
          {actor ? (
            <Avatar name={actor.name} color={actor.avatarColor} size={40} />
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white">
              <BellRing size={20} />
            </span>
          )}
          {/* The verdict badge — what happened, before you read what it says. */}
          <span
            className={cx(
              'absolute -bottom-1 -end-1 grid h-[19px] w-[19px] place-items-center rounded-full text-white ring-2 ring-navy',
              tone.ring
            )}
          >
            <Icon size={11} strokeWidth={2.75} />
          </span>
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-extrabold leading-snug text-white">{title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-white/65">{body}</p>
          <button
            type="button"
            onClick={onOpen}
            className="mt-3 rounded-lg bg-white px-3.5 py-2 text-[12px] font-bold text-navy transition-colors hover:bg-brand-100"
          >
            {openLabel}
          </button>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={closeLabel}
        >
          <X size={16} />
        </button>
      </div>

      {/* How long is left. Frozen while the alert is hovered or focused, so
          reading it never costs you the chance to act on it. */}
      <div className="h-1 bg-white/10">
        <div
          key={cycle}
          className={cx('h-full animate-drain', tone.bar)}
          style={{ animationPlayState: paused ? 'paused' : 'running' }}
        />
      </div>
    </div>
  );
}
