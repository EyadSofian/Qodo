import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BellOff,
  BellRing,
  CheckCheck,
} from "lucide-react";
import { useI18n } from "../lib/i18n";
import { useWorkspace } from "../lib/workspace";
import { cx, timeAgo } from "../lib/utils";
import { Avatar } from "./ui";
import type { LocalisedText } from "../lib/types";
import {
  arabicNotificationTime,
  notificationPresentation,
} from "./notification-presentation";
import { isInsightsBriefType } from "../lib/insights-notification";

export function NotificationsMenu({
  open,
  onClose,
  showPushSetup = false,
  onEnablePush,
}: {
  open: boolean;
  onClose: () => void;
  showPushSetup?: boolean;
  onEnablePush?: () => void;
}) {
  const {
    notifications,
    actors,
    unread,
    reloadNotifications,
    markRead,
    markAllRead,
  } = useWorkspace();
  const { t, lang, dir } = useI18n();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    reloadNotifications().catch(() => {});
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        if (!(
          target instanceof Element &&
          target.closest("[data-notifications-trigger]")
        ))
          onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, onClose, reloadNotifications]);

  if (!open) return null;

  // Titles written before this release are plain strings; newer ones are
  // {ar, en} because the reader's language isn't known at write time.
  const textOf = (value: LocalisedText | string, forceArabic: boolean) =>
    typeof value === "string"
      ? value
      : forceArabic
        ? value.ar
        : (value[lang] ?? value.ar);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-navy/30 sm:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        dir={dir}
        className={cx(
          "fixed inset-x-0 bottom-0 z-50 max-h-[78dvh] overflow-hidden rounded-t-3xl bg-white pb-safe shadow-panel animate-fade-up",
          "sm:absolute sm:inset-x-auto sm:bottom-auto sm:end-0 sm:top-[calc(100%+10px)] sm:w-[23rem] sm:rounded-2xl sm:border sm:border-surface-line",
        )}
      >
        <header className="flex items-center justify-between border-b border-surface-line px-4 py-3.5">
          <div>
            <h3 className="text-[15px] font-extrabold text-ink">
              {t("shell.notifications")}
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {unread > 0
                ? lang === "ar"
                  ? `${unread} غير مقروء`
                  : `${unread} unread`
                : lang === "ar"
                  ? "كل الإشعارات مقروءة"
                  : "You are all caught up"}
            </p>
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-brand-500 hover:underline"
            >
              <CheckCheck size={14} />
              {t("shell.markAllRead")}
            </button>
          )}
        </header>

        {showPushSetup && onEnablePush && (
          <button
            type="button"
            onClick={onEnablePush}
            className="m-3 flex w-[calc(100%_-_1.5rem)] items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-3 text-start transition-colors hover:bg-brand-100"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-brand-600 shadow-sm">
              <BellRing size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-extrabold text-ink">
                {t("shell.enableNotifications")}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
                {t("shell.enableNotificationsHint")}
              </span>
            </span>
          </button>
        )}

        <div className="max-h-[60dvh] space-y-2 overflow-y-auto overscroll-contain bg-surface-bg p-2.5">
          {notifications.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <BellOff size={22} className="text-ink-faint" />
              <p className="text-sm text-ink-muted">
                {t("shell.noNotifications")}
              </p>
            </div>
          )}

          {notifications.map((item) => {
            const actor = item.actorId ? actors[item.actorId] : undefined;
            const presentation = notificationPresentation(item.type);
            const Icon = presentation.icon;
            const forceArabic = isInsightsBriefType(item.type);
            const typeLabel = forceArabic
              ? presentation.label.ar
              : (presentation.label[lang] ?? presentation.label.ar);
            const ItemOpenIcon =
              forceArabic || dir === "rtl" ? ArrowLeft : ArrowRight;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (!item.read) markRead(item.id);
                  onClose();
                  navigate(item.link);
                }}
                className={cx(
                  "group relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border border-surface-line bg-white p-3 text-start shadow-[0_1px_2px_rgba(11,37,69,0.04)] transition hover:-translate-y-px hover:border-brand-200 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500",
                  !item.read && presentation.unread,
                )}
                dir={forceArabic ? "rtl" : dir}
              >
                <span
                  className={cx(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                    presentation.iconBox,
                  )}
                >
                  <Icon size={19} strokeWidth={2.25} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[10.5px] font-bold text-ink-muted">
                    <span>{typeLabel}</span>
                    <span
                      aria-hidden
                      className="h-1 w-1 rounded-full bg-ink-faint/70"
                    />
                    <time>
                      {forceArabic
                        ? arabicNotificationTime(item.createdAt)
                        : timeAgo(item.createdAt, t)}
                    </time>
                  </span>
                  <span className="mt-0.5 block text-[13px] font-extrabold leading-5 text-ink">
                    {textOf(item.title, forceArabic)}
                  </span>
                  <span
                    className={cx(
                      "mt-1 block text-[12px] text-ink-muted",
                      item.type.startsWith("insights.")
                        ? "line-clamp-2 whitespace-pre-line leading-5"
                        : "line-clamp-2 leading-5",
                    )}
                    dir={forceArabic ? "rtl" : "auto"}
                  >
                    {textOf(item.body, forceArabic)}
                  </span>
                  {actor && (
                    <span className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-ink-faint">
                      <Avatar
                        name={actor.name}
                        color={actor.avatarColor}
                        size={18}
                      />
                      <span>{actor.name}</span>
                    </span>
                  )}
                </span>
                <span className="flex h-10 w-5 shrink-0 items-center justify-center text-ink-faint transition group-hover:text-brand-600">
                  <ItemOpenIcon size={15} aria-hidden />
                </span>
                {!item.read && (
                  <span
                    className={cx(
                      "absolute inset-y-3 start-0 w-0.5 rounded-full",
                      presentation.accent,
                    )}
                    aria-label={lang === "ar" ? "غير مقروء" : "Unread"}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
