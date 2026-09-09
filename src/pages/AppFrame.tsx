import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Github,
  RotateCw,
  ShieldAlert,
} from "lucide-react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useWorkspace } from "../lib/workspace";
import { ModuleIcon } from "../components/ModuleIcon";
import { Spinner } from "../components/ui";
import { cx } from "../lib/utils";
import {
  INSIGHTS_NEXUS_ACK,
  INSIGHTS_NEXUS_READY,
  buildInsightsNexusHandoff,
  findInsightsNotification,
} from "../lib/insights-notification";

interface EmbedCheck {
  embeddable: boolean | "maybe";
  reason: string;
}

/**
 * A sibling dashboard rendered inside the workspace, under the same top bar.
 *
 * Whether that is even possible is the app's decision, not ours: any site can
 * refuse framing with X-Frame-Options or a CSP frame-ancestors directive, and a
 * refused frame paints an empty white box with nothing but a console error.
 * So the server probes the headers first and we show an honest fallback rather
 * than a blank screen.
 */
export function AppFrame() {
  const { appId } = useParams<{ appId: string }>();
  const location = useLocation();
  const { apps, loading, notifications } = useWorkspace();
  const { t, lang, dir } = useI18n();
  const app = apps.find((a) => a.id === appId);

  const [check, setCheck] = useState<EmbedCheck | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [nonce, setNonce] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const postedNoticeRef = useRef<string | null>(null);

  const noticeId = useMemo(
    () => new URLSearchParams(location.search).get("notice"),
    [location.search],
  );
  const notice = useMemo(
    () => findInsightsNotification(notifications, noticeId),
    [noticeId, notifications],
  );
  const handoff = useMemo(
    () => buildInsightsNexusHandoff(notice, lang === "en" ? "en" : "ar"),
    [notice, lang],
  );
  const frameUrl = useMemo(() => {
    if (!app) return "";
    if (app.id !== "insights" || !handoff) return app.url;

    // Nexus is the detail layer, but the iframe itself must also land on the
    // right report. If Botpress is slow or unavailable, the user still sees
    // the requested data instead of the Hub overview.
    const paths = {
      leads: "/leads",
      website: "/website",
      campaigns: "/campaigns",
      employees: "/teams",
    } as const;
    try {
      const url = new URL(app.url);
      url.pathname = paths[handoff.notification.key];
      url.searchParams.set("from", handoff.notification.from);
      url.searchParams.set("to", handoff.notification.to);
      return url.toString();
    } catch {
      return app.url;
    }
  }, [app, handoff]);

  useEffect(() => {
    if (!appId) return;
    setCheck(null);
    setFrameLoaded(false);
    setSlow(false);
    api
      .get<EmbedCheck>(`/apps/${appId}/embeddable`)
      .then(setCheck)
      // A failed probe shouldn't block the user — try the frame and let the
      // "still blank?" hint cover it.
      .catch(() => setCheck({ embeddable: "maybe", reason: "probe_failed" }));
  }, [appId]);

  // Nothing tells us cross-origin that a frame was blocked, so after a few
  // seconds without a load event we offer the way out.
  useEffect(() => {
    if (frameLoaded || check?.embeddable === false) return;
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, [frameLoaded, check, nonce]);

  // Notifications, the iframe and the Hub's React effects finish in no fixed
  // order. Deliver until the child explicitly acknowledges the same id. This
  // closes the race where the old single postMessage landed before Nexus had
  // installed its listener and the user saw only the dashboard overview.
  useEffect(() => {
    if (
      !frameLoaded ||
      !handoff ||
      !app ||
      app.id !== "insights" ||
      !iframeRef.current?.contentWindow
    ) {
      return;
    }

    let targetOrigin: string;
    try {
      targetOrigin = new URL(app.url).origin;
    } catch {
      return;
    }

    const child = iframeRef.current.contentWindow;
    let attempts = 0;
    let timer: number | null = null;
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const deliver = () => {
      if (postedNoticeRef.current === handoff.notification.id) {
        stop();
        return;
      }
      child.postMessage(handoff, targetOrigin);
      attempts += 1;
      if (attempts >= 20) stop();
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== child || event.origin !== targetOrigin) return;
      const message = event.data as {
        type?: unknown;
        notificationId?: unknown;
      } | null;
      if (message?.type === INSIGHTS_NEXUS_READY) {
        deliver();
        return;
      }
      if (
        message?.type === INSIGHTS_NEXUS_ACK &&
        message.notificationId === handoff.notification.id
      ) {
        postedNoticeRef.current = handoff.notification.id;
        stop();
      }
    };

    window.addEventListener("message", receive);
    deliver();
    timer = window.setInterval(deliver, 500);
    return () => {
      stop();
      window.removeEventListener("message", receive);
    };
  }, [app, frameLoaded, handoff]);

  useEffect(() => {
    postedNoticeRef.current = null;
  }, [noticeId, nonce]);

  if (loading) {
    return (
      <div className="grid flex-1 place-items-center p-10">
        <Spinner size={26} className="text-brand-500" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="text-lg font-bold text-ink">{t("frame.notFound")}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t("frame.notFoundBody")}</p>
        <Link to="/" className="btn-primary mt-5 inline-flex">
          {t("common.home")}
        </Link>
      </div>
    );
  }

  const blocked = check?.embeddable === false;
  const appName = lang === "en" && app.nameEn ? app.nameEn : app.nameAr;
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-surface-line bg-white/85 px-3 py-2 backdrop-blur sm:px-5">
        <Link
          to="/"
          className="btn-quiet !min-h-9 rounded-lg px-2"
          aria-label={t("common.back")}
        >
          <BackIcon size={18} />
        </Link>

        <ModuleIcon name={app.icon} color={app.color} size={30} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold leading-tight text-ink">
            {appName}
          </p>
          <p className="ltr truncate text-[11px] leading-tight text-ink-faint">
            {new URL(app.url).host}
          </p>
        </div>

        {app.repo && (
          <a
            href={app.repo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-quiet !min-h-9 hidden rounded-lg px-2 sm:inline-flex"
            aria-label={t("frame.repo")}
            title={t("frame.repo")}
          >
            <Github size={16} />
          </a>
        )}
        {!blocked && (
          <button
            type="button"
            onClick={() => {
              setFrameLoaded(false);
              setSlow(false);
              setNonce((n) => n + 1);
            }}
            className="btn-quiet !min-h-9 rounded-lg px-2"
            aria-label={t("common.refresh")}
            title={t("common.refresh")}
          >
            <RotateCw size={16} />
          </button>
        )}
        <a
          href={frameUrl || app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost btn-sm !min-h-9 gap-1.5"
        >
          <ExternalLink size={15} />
          <span className="hidden sm:inline">{t("common.openNewTab")}</span>
        </a>
      </div>

      {blocked ? (
        <div className="grid flex-1 place-items-center px-5 py-14">
          <div className="card max-w-lg px-6 py-8 text-center">
            <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-status-warnBg text-accent-600">
              <ShieldAlert size={24} />
            </span>
            <h2 className="text-base font-bold text-ink">
              {t("frame.blockedTitle", { app: appName })}
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
              {t("frame.blockedBody")}
            </p>
            <a
              href={frameUrl || app.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary mt-5 inline-flex"
            >
              <ExternalLink size={16} />
              {appName}
            </a>
            {check?.reason && (
              <p className="ltr mt-4 text-[11px] text-ink-faint">
                <code>{check.reason}</code>
              </p>
            )}
            <p className="mt-4 border-t border-surface-line pt-4 text-[12px] leading-relaxed text-ink-muted">
              {t("frame.blockedFix")}
            </p>
          </div>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-surface-sunken">
          {!frameLoaded && (
            <div className="absolute inset-0 grid place-items-center gap-3">
              <div className="flex flex-col items-center gap-3">
                <Spinner size={26} className="text-brand-500" />
                <p className="text-[13px] text-ink-muted">
                  {t("frame.opening", { app: appName })}
                </p>
                {slow && (
                  <a
                    href={frameUrl || app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost btn-sm mt-1"
                  >
                    <ExternalLink size={15} />
                    {t("frame.slow")}
                  </a>
                )}
              </div>
            </div>
          )}
          <iframe
            key={nonce}
            ref={iframeRef}
            src={frameUrl || app.url}
            title={appName}
            onLoad={() => {
              setFrameLoaded(true);
              postedNoticeRef.current = null;
            }}
            // Positioned, not `h-full`. The wrapper is a flex item, so its
            // height comes from the flex algorithm and its *specified* height
            // stays `auto` — which means a percentage height on a child has
            // nothing to resolve against and the iframe silently collapses to
            // its 150px default. Absolute inset sizes against the padding box
            // and is unaffected.
            className={cx(
              "absolute inset-0 h-full w-full border-0 transition-opacity duration-200",
              frameLoaded ? "opacity-100" : "opacity-0",
            )}
            // The framed app is trusted (it's ours) but still gets an explicit
            // allowance list rather than free rein over the parent.
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="clipboard-write"
          />
        </div>
      )}
    </div>
  );
}
