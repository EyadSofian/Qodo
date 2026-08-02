import { BellRing, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import type { LocalisedText } from '../lib/types';
import { Avatar } from './ui';

/**
 * A live, actionable alert. The bell remains the durable inbox; this popup is
 * the attention layer for something that arrived while the workspace is open.
 */
export function IncomingNotificationPopup() {
  const {
    incomingNotification,
    dismissIncomingNotification,
    actors,
    markRead,
  } = useWorkspace();
  const { t, lang } = useI18n();
  const navigate = useNavigate();

  if (!incomingNotification) return null;

  const localise = (value: LocalisedText | string) =>
    typeof value === 'string' ? value : (value[lang] ?? value.ar);
  const actor = incomingNotification.actorId
    ? actors[incomingNotification.actorId]
    : undefined;

  const open = () => {
    markRead(incomingNotification.id).catch(() => {});
    dismissIncomingNotification();
    navigate(incomingNotification.link);
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-x-3 top-[calc(var(--sat)+var(--topbar-h)+0.75rem)] z-[70] flex justify-center sm:justify-end sm:px-2">
      <div
        role="alert"
        aria-live="assertive"
        className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-lift animate-pop-in"
      >
        <div className="flex items-start gap-3 p-4">
          {actor ? (
            <Avatar name={actor.name} color={actor.avatarColor} size={38} />
          ) : (
            <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
              <BellRing size={19} />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-extrabold text-ink">
              {localise(incomingNotification.title)}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              {localise(incomingNotification.body)}
            </p>
            <button
              type="button"
              onClick={open}
              className="mt-3 rounded-lg bg-navy px-3 py-2 text-[12px] font-bold text-white transition-colors hover:bg-brand-800"
            >
              {t('shell.openNotification')}
            </button>
          </div>

          <button
            type="button"
            onClick={dismissIncomingNotification}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>
        <div className="h-1 bg-gradient-to-r from-brand-500 to-accent-500" />
      </div>
    </div>,
    document.body
  );
}
