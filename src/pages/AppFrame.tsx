import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ExternalLink, Github, RotateCw, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { ModuleIcon } from '../components/ModuleIcon';
import { Spinner } from '../components/ui';
import { cx } from '../lib/utils';

interface EmbedCheck {
  embeddable: boolean | 'maybe';
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
  const { apps, loading } = useWorkspace();
  const { t, lang, dir } = useI18n();
  const app = apps.find((a) => a.id === appId);

  const [check, setCheck] = useState<EmbedCheck | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [nonce, setNonce] = useState(0);

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
      .catch(() => setCheck({ embeddable: 'maybe', reason: 'probe_failed' }));
  }, [appId]);

  // Nothing tells us cross-origin that a frame was blocked, so after a few
  // seconds without a load event we offer the way out.
  useEffect(() => {
    if (frameLoaded || check?.embeddable === false) return;
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, [frameLoaded, check, nonce]);

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
        <h1 className="text-lg font-bold text-ink">{t('frame.notFound')}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t('frame.notFoundBody')}</p>
        <Link to="/" className="btn-primary mt-5 inline-flex">
          {t('common.home')}
        </Link>
      </div>
    );
  }

  const blocked = check?.embeddable === false;
  const appName = lang === 'en' && app.nameEn ? app.nameEn : app.nameAr;
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-surface-line bg-white/85 px-3 py-2 backdrop-blur sm:px-5">
        <Link to="/" className="btn-quiet !min-h-9 rounded-lg px-2" aria-label={t('common.back')}>
          <BackIcon size={18} />
        </Link>

        <ModuleIcon name={app.icon} color={app.color} size={30} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold leading-tight text-ink">{appName}</p>
          <p className="ltr truncate text-[11px] leading-tight text-ink-faint">{new URL(app.url).host}</p>
        </div>

        {app.repo && (
          <a
            href={app.repo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-quiet !min-h-9 hidden rounded-lg px-2 sm:inline-flex"
            aria-label={t('frame.repo')}
            title={t('frame.repo')}
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
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
          >
            <RotateCw size={16} />
          </button>
        )}
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost btn-sm !min-h-9 gap-1.5"
        >
          <ExternalLink size={15} />
          <span className="hidden sm:inline">{t('common.openNewTab')}</span>
        </a>
      </div>

      {blocked ? (
        <div className="grid flex-1 place-items-center px-5 py-14">
          <div className="card max-w-lg px-6 py-8 text-center">
            <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-status-warnBg text-accent-600">
              <ShieldAlert size={24} />
            </span>
            <h2 className="text-base font-bold text-ink">{t('frame.blockedTitle', { app: appName })}</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{t('frame.blockedBody')}</p>
            <a href={app.url} target="_blank" rel="noopener noreferrer" className="btn-primary mt-5 inline-flex">
              <ExternalLink size={16} />
              {appName}
            </a>
            {check?.reason && (
              <p className="ltr mt-4 text-[11px] text-ink-faint">
                <code>{check.reason}</code>
              </p>
            )}
            <p className="mt-4 border-t border-surface-line pt-4 text-[12px] leading-relaxed text-ink-muted">
              {t('frame.blockedFix')}
            </p>
          </div>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-surface-sunken">
          {!frameLoaded && (
            <div className="absolute inset-0 grid place-items-center gap-3">
              <div className="flex flex-col items-center gap-3">
                <Spinner size={26} className="text-brand-500" />
                <p className="text-[13px] text-ink-muted">{t('frame.opening', { app: appName })}</p>
                {slow && (
                  <a href={app.url} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm mt-1">
                    <ExternalLink size={15} />
                    {t('frame.slow')}
                  </a>
                )}
              </div>
            </div>
          )}
          <iframe
            key={nonce}
            src={app.url}
            title={appName}
            onLoad={() => setFrameLoaded(true)}
            className={cx(
              'h-full w-full border-0 transition-opacity duration-200',
              frameLoaded ? 'opacity-100' : 'opacity-0'
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
