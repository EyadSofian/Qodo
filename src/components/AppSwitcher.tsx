import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { cx } from '../lib/utils';
import { ModuleIcon } from './ModuleIcon';
import type { WorkspaceApp } from '../lib/types';

/**
 * The switcher that makes the four dashboards feel like one product: it hangs
 * off the top bar on every screen, so moving from HR to SLA is one click rather
 * than a bookmark hunt.
 *
 * Desktop gets an anchored dropdown; a phone gets a full sheet, because a
 * 6-column grid inside a 320px popover is unusable.
 */
export function AppSwitcher({
  open,
  onClose,
  onOpenApp,
}: {
  open: boolean;
  onClose: () => void;
  onOpenApp: (app: WorkspaceApp) => void;
}) {
  const { apps } = useWorkspace();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        // The trigger button toggles on its own click — ignore it here.
        if (!(target instanceof Element && target.closest('[data-app-switcher-trigger]'))) onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handle = (app: WorkspaceApp) => {
    onClose();
    if (app.kind === 'internal') navigate(app.url);
    else onOpenApp(app);
  };

  const nameOf = (app: WorkspaceApp) => (lang === 'en' && app.nameEn ? app.nameEn : app.nameAr);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px] sm:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="menu"
        aria-label={t('shell.allApps')}
        className={cx(
          'fixed inset-x-0 bottom-0 z-50 max-h-[78dvh] overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-4 pb-safe shadow-panel animate-fade-up',
          'sm:absolute sm:inset-x-auto sm:bottom-auto sm:start-0 sm:top-[calc(100%+10px)] sm:w-[26rem] sm:max-w-[calc(100vw-1.5rem)] sm:max-h-[calc(100dvh-var(--topbar-h)-var(--sat)-1rem)] sm:rounded-2xl sm:border sm:border-surface-line sm:p-3'
        )}
      >
        <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="text-sm font-bold text-ink">{t('shell.allApps')}</h3>
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/');
            }}
            className="text-[12px] font-semibold text-brand-500 hover:underline"
          >
            {t('common.home')}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              role="menuitem"
              onClick={() => handle(app)}
              className="group flex flex-col items-center gap-2 rounded-xl px-1 py-3 text-center transition-colors hover:bg-surface-sunken"
            >
              <span className="relative">
                <ModuleIcon name={app.icon} color={app.color} size={44} />
                {app.kind === 'external' && (
                  <ArrowUpRight
                    size={11}
                    className="absolute -end-0.5 -top-0.5 rounded-full bg-white p-[1px] text-ink-faint shadow-sm"
                  />
                )}
              </span>
              <span className="line-clamp-2 text-[11.5px] font-semibold leading-tight text-ink">
                {nameOf(app)}
              </span>
            </button>
          ))}
        </div>

        {apps.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-ink-faint">{t('shell.noAppsForYou')}</p>
        )}
      </div>
    </>
  );
}
