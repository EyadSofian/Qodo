import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, BellRing, CheckCheck } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { cx, timeAgo } from '../lib/utils';
import { Avatar } from './ui';
import type { LocalisedText } from '../lib/types';

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
  const { notifications, actors, unread, reloadNotifications, markRead, markAllRead } = useWorkspace();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    reloadNotifications().catch(() => {});
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        if (!(target instanceof Element && target.closest('[data-notifications-trigger]'))) onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, onClose, reloadNotifications]);

  if (!open) return null;

  // Titles written before this release are plain strings; newer ones are
  // {ar, en} because the reader's language isn't known at write time.
  const titleOf = (title: LocalisedText | string) =>
    typeof title === 'string' ? title : (title[lang] ?? title.ar);
  const bodyOf = (body: LocalisedText | string) =>
    typeof body === 'string' ? body : (body[lang] ?? body.ar);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 sm:hidden" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={cx(
          'fixed inset-x-0 bottom-0 z-50 max-h-[78dvh] overflow-hidden rounded-t-3xl bg-white pb-safe shadow-panel animate-fade-up',
          'sm:absolute sm:inset-x-auto sm:bottom-auto sm:end-0 sm:top-[calc(100%+10px)] sm:w-[23rem] sm:rounded-2xl sm:border sm:border-surface-line'
        )}
      >
        <header className="flex items-center justify-between border-b border-surface-line px-4 py-3">
          <h3 className="text-sm font-bold text-ink">{t('shell.notifications')}</h3>
          {unread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-brand-500 hover:underline"
            >
              <CheckCheck size={14} />
              {t('shell.markAllRead')}
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
                {t('shell.enableNotifications')}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
                {t('shell.enableNotificationsHint')}
              </span>
            </span>
          </button>
        )}

        <div className="max-h-[60dvh] overflow-y-auto overscroll-contain">
          {notifications.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <BellOff size={22} className="text-ink-faint" />
              <p className="text-sm text-ink-muted">{t('shell.noNotifications')}</p>
            </div>
          )}

          {notifications.map((item) => {
            const actor = item.actorId ? actors[item.actorId] : undefined;
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
                  'flex w-full items-start gap-3 border-b border-surface-line/70 px-4 py-3 text-start transition-colors last:border-0',
                  item.read ? 'hover:bg-surface-sunken' : 'bg-brand-50/60 hover:bg-brand-50'
                )}
              >
                {actor ? (
                  <Avatar name={actor.name} color={actor.avatarColor} size={30} />
                ) : (
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-ink">{titleOf(item.title)}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">
                    {bodyOf(item.body)}
                  </span>
                  <span className="mt-1 block text-[11px] text-ink-faint">
                    {actor ? `${actor.name} · ` : ''}
                    {timeAgo(item.createdAt, t)}
                  </span>
                </span>
                {!item.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent-500" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
