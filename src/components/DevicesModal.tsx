import { useCallback, useEffect, useState } from 'react';
import { Laptop, LogOut, Monitor, Smartphone } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { timeAgo } from '../lib/utils';
import { Modal, Spinner, useToast } from './ui';

interface DeviceSession {
  id: string;
  os: string;
  browser: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

const OS_LABEL: Record<string, string> = {
  Windows: 'Windows',
  macOS: 'Mac',
  iOS: 'iPhone / iPad',
  Android: 'Android',
  Linux: 'Linux',
  ChromeOS: 'ChromeOS',
};

function DeviceIcon({ os }: { os: string }) {
  if (os === 'iOS' || os === 'Android') return <Smartphone size={18} />;
  if (os === 'macOS') return <Laptop size={18} />;
  return <Monitor size={18} />;
}

/** Where this account is signed in, with a sign-out per device. */
export function DevicesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { push } = useToast();
  const { signOut } = useAuth();
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.get<{ sessions: DeviceSession[] }>('/auth/sessions');
      setSessions(data.sessions);
    } catch (err) {
      setError(errorMessage(err, lang));
    }
  }, [lang]);

  useEffect(() => {
    if (open) {
      setSessions(null);
      void load();
    }
  }, [open, load]);

  const revoke = async (session: DeviceSession) => {
    setBusy(session.id);
    try {
      const result = await api.post<{ signedOut: boolean }>(`/auth/sessions/${session.id}/revoke`);
      if (result.signedOut) {
        await signOut();
        return;
      }
      push(t('devices.signedOut'));
      await load();
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(null);
    }
  };

  const revokeOthers = async () => {
    setBusy('others');
    try {
      const result = await api.post<{ revoked: number }>('/auth/sessions/revoke-others');
      push(t('devices.othersSignedOut', { n: result.revoked }));
      await load();
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(null);
    }
  };

  const others = sessions?.filter((session) => !session.current).length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('devices.title')}
      width="md"
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.close')}
          </button>
          {others > 0 && (
            <button type="button" className="btn-danger btn-sm" onClick={revokeOthers} disabled={busy !== null}>
              {busy === 'others' && <Spinner size={15} />}
              {t('devices.signOutOthers')}
            </button>
          )}
        </>
      }
    >
      <p className="mb-3 text-[13px] text-ink-muted">{t('devices.hint')}</p>
      {error && <p className="mb-3 text-[13px] font-semibold text-status-bad">{error}</p>}
      {!sessions ? (
        <div className="grid place-items-center py-8">
          <Spinner />
        </div>
      ) : (
        <ul className="grid gap-2">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-surface-line bg-white px-3 py-2.5"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-sunken text-ink-muted">
                <DeviceIcon os={session.os} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-[13.5px] font-bold text-ink">
                  <span dir="ltr">
                    {OS_LABEL[session.os] ?? t('devices.unknown')}
                    {session.browser !== 'other' ? ` · ${session.browser}` : ''}
                  </span>
                  {session.current && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                      {t('devices.thisDevice')}
                    </span>
                  )}
                </p>
                <p className="truncate text-[12px] text-ink-muted">
                  {t('devices.lastActive', { when: timeAgo(session.lastSeenAt, t) })}
                  {session.ip ? (
                    <>
                      {' · '}
                      <span dir="ltr">{session.ip}</span>
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm shrink-0"
                onClick={() => revoke(session)}
                disabled={busy !== null}
              >
                {busy === session.id ? <Spinner size={15} /> : <LogOut size={15} />}
                {t('devices.signOut')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
