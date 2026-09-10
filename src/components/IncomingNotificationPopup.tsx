import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { useWorkspace } from "../lib/workspace";
import { cx, timeAgo } from "../lib/utils";
import type { LocalisedText, Notification } from "../lib/types";
import { Avatar } from "./ui";
import {
  arabicNotificationTime,
  notificationPresentation,
} from "./notification-presentation";
import {
  isArabicInsightsType,
  isInsightsBriefType,
} from "../lib/insights-notification";

/**
 * Live, actionable alerts. The bell remains the durable inbox; this is the
 * attention layer for something that arrived while the workspace is open.
 *
 * The card stays light and compact so Arabic remains readable on a phone. Its
 * semantic icon and top rule distinguish a report, a returned task and a due
 * item without turning the whole surface red or navy.
 */

/** Long enough to read two lines of Arabic without racing it. */
const AUTO_DISMISS_MS = 9000;

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
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    if (context.state === "suspended") void context.resume();

    // Rising, because this is an arrival and not an error.
    [
      { at: 0, hz: 660 },
      { at: 0.12, hz: 880 },
    ].forEach(({ at, hz }) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      // Ramped rather than switched: an abrupt start and stop is heard as a click.
      gain.gain.setValueAtTime(0.0001, context.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(
        0.14,
        context.currentTime + at + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + at + 0.16,
      );
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
  const {
    incomingNotifications,
    dismissIncomingNotification,
    actors,
    markRead,
  } = useWorkspace();
  const { t, lang } = useI18n();
  const navigate = useNavigate();

  // Sounded once per arrival, keyed by id, so a re-render never re-rings and a
  // second alert landing while the first is up still gets its own chime.
  const soundedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const notification = incomingNotifications[0];
    if (notification && !soundedRef.current.has(notification.id)) {
      soundedRef.current.add(notification.id);
      chime();
    }
    // The set would otherwise grow for the life of the tab.
    if (soundedRef.current.size > 50) soundedRef.current = new Set();
  }, [incomingNotifications]);

  if (incomingNotifications.length === 0) return null;

  const localise = (value: LocalisedText | string) =>
    typeof value === "string" ? value : (value[lang] ?? value.ar);

  const open = (notification: Notification) => {
    markRead(notification.id).catch(() => {});
    navigate(notification.link);
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-x-3 top-[calc(var(--sat)+var(--topbar-h)+0.75rem)] z-[70] flex flex-col items-center gap-2 sm:items-end sm:px-2">
      {incomingNotifications.slice(0, 1).map((notification) => (
        <LiveAlert
          key={notification.id}
          notification={notification}
          actor={
            notification.actorId ? actors[notification.actorId] : undefined
          }
          title={
            isArabicInsightsType(notification.type) &&
            typeof notification.title !== "string"
              ? notification.title.ar
              : localise(notification.title)
          }
          body={
            isArabicInsightsType(notification.type) &&
            typeof notification.body !== "string"
              ? notification.body.ar
              : localise(notification.body)
          }
          kindLabel={
            isArabicInsightsType(notification.type)
              ? notificationPresentation(notification.type).label.ar
              : localise(notificationPresentation(notification.type).label)
          }
          timeLabel={
            isArabicInsightsType(notification.type)
              ? arabicNotificationTime(notification.createdAt)
              : timeAgo(notification.createdAt, t)
          }
          openLabel={
            isArabicInsightsType(notification.type)
              ? "فتح التقرير وتحليله"
              : notification.type.startsWith("insights.")
                ? lang === "ar"
                  ? "فتح لوحة التحليلات"
                  : "Open Insights Hub"
                : t("shell.openNotification")
          }
          closeLabel={t("common.close")}
          lang={
            isArabicInsightsType(notification.type)
              ? "ar"
              : lang === "en"
                ? "en"
                : "ar"
          }
          onOpen={() => open(notification)}
          onDismiss={() => dismissIncomingNotification(notification.id)}
        />
      ))}
    </div>,
    document.body,
  );
}

function LiveAlert({
  notification,
  actor,
  title,
  body,
  kindLabel,
  timeLabel,
  openLabel,
  closeLabel,
  lang,
  onOpen,
  onDismiss,
}: {
  notification: Notification;
  actor?: { name: string; avatarColor: string };
  title: string;
  body: string;
  kindLabel: string;
  timeLabel: string;
  openLabel: string;
  closeLabel: string;
  lang: "ar" | "en";
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  // Bumped on every resume so the bar remounts and re-runs from full, keeping
  // it honest about how long is actually left rather than drifting ahead of
  // the timer that does the dismissing.
  const [cycle, setCycle] = useState(0);
  const autoDismissMs = isInsightsBriefType(notification.type)
    ? 12_000
    : AUTO_DISMISS_MS;

  // The timer is the authority, not the animation: `prefers-reduced-motion`
  // can stop the bar from ever finishing, and an alert that then never leaves
  // is the bug this was meant to fix.
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [paused, cycle, onDismiss, autoDismissMs]);

  const presentation = notificationPresentation(notification.type);
  const Icon = presentation.icon;
  const OpenIcon = lang === "ar" ? ArrowLeft : ArrowRight;

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
      dir={lang === "ar" ? "rtl" : "ltr"}
      className="pointer-events-auto w-full max-w-[420px] overflow-hidden rounded-[22px] border border-surface-line bg-white shadow-lift animate-pop-in"
    >
      <div className={cx("h-1 w-full", presentation.accent)} />
      <div className="flex items-start gap-3.5 p-4 pb-3.5">
        <span
          className={cx(
            "grid h-11 w-11 shrink-0 place-items-center rounded-[14px]",
            presentation.iconBox,
          )}
        >
          <Icon size={21} strokeWidth={2.25} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10.5px] font-bold text-ink-muted">
            <span>{kindLabel}</span>
            <span
              aria-hidden
              className="h-1 w-1 rounded-full bg-ink-faint/70"
            />
            <time>{timeLabel}</time>
          </div>
          <p className="mt-1 text-[14px] font-extrabold leading-6 text-ink">
            {title}
          </p>
          <p
            className="mt-1 line-clamp-3 whitespace-pre-line text-[12.5px] leading-6 text-ink-muted"
            dir="auto"
          >
            {body}
          </p>
          {actor && (
            <span className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-faint">
              <Avatar name={actor.name} color={actor.avatarColor} size={20} />
              <span>{actor.name}</span>
            </span>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-xl bg-navy px-3.5 py-2 text-[12px] font-bold text-white shadow-sm transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            {openLabel}
            <OpenIcon size={14} aria-hidden />
          </button>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
          aria-label={closeLabel}
        >
          <X size={16} />
        </button>
      </div>

      {/* How long is left. Frozen while the alert is hovered or focused, so
          reading it never costs you the chance to act on it. */}
      <div className="h-0.5 bg-surface-sunken">
        <div
          key={cycle}
          className={cx("h-full animate-drain", presentation.accent)}
          style={{
            animationPlayState: paused ? "paused" : "running",
            animationDuration: `${autoDismissMs}ms`,
          }}
        />
      </div>
    </div>
  );
}
