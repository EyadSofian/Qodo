/**
 * What every HR screen shares: the caller's access, and the recruitment alert
 * centre (polled, popped as a toast once, then kept in the drawer).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hrApi, useHRQuery } from '../api';
import type { Alert, HRAccess } from '../types';

interface AlertCenter {
  alerts: Alert[];
  unseen: Set<string>;
  toasts: Alert[];
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  dismissToast: (id: string) => void;
  markAllSeen: () => void;
  reload: () => void;
}

interface HRShared {
  access: HRAccess | null;
  accessError: unknown;
  alertCenter: AlertCenter;
}

const HRContext = createContext<HRShared | null>(null);

const SEEN_KEY = 'hr.alerts.seen.v1';
const MAX_TOASTS_PER_LOAD = 2;

function readSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSeen(value: Record<string, string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(value));
  } catch {
    // Private windows refuse storage; the popups simply repeat next visit.
  }
}

export function HRProvider({ children }: { children: ReactNode }) {
  const { data: accessData, error: accessError } = useHRQuery<{ access: HRAccess }>(hrApi.access);
  const access = accessData?.access ?? null;
  const wantsAlerts = Boolean(access && (access.recruitment || access.kpiReview || access.rewards));
  const { data: alertData, reload } = useHRQuery<{ alerts: Alert[] }>(wantsAlerts ? hrApi.recruitment.alerts : null, { refreshMs: 90_000 });
  const alerts = alertData?.alerts ?? [];

  const [seen, setSeen] = useState<Record<string, string>>(() => readSeen());
  const [toasts, setToasts] = useState<Alert[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const popped = useRef(new Set<string>());
  const poppedThisLoad = useRef(0);

  const unseen = useMemo(() => new Set(alerts.filter((alert) => seen[alert.id] !== alert.fingerprint).map((alert) => alert.id)), [alerts, seen]);

  // New important alerts pop as a toast — at most two per page load, critical
  // first — and everything else waits quietly in the drawer.
  useEffect(() => {
    const candidates = alerts
      .filter((alert) => (alert.severity === 'critical' || alert.severity === 'warning') && unseen.has(alert.id) && !popped.current.has(`${alert.id}:${alert.fingerprint}`))
      .slice(0, Math.max(0, MAX_TOASTS_PER_LOAD - poppedThisLoad.current));
    if (!candidates.length) return;
    for (const alert of candidates) popped.current.add(`${alert.id}:${alert.fingerprint}`);
    poppedThisLoad.current += candidates.length;
    setToasts((current) => [...current, ...candidates].slice(-MAX_TOASTS_PER_LOAD));
  }, [alerts, unseen]);

  const markSeen = useCallback((ids: string[]) => {
    setSeen((current) => {
      const next = { ...current };
      for (const id of ids) {
        const alert = alerts.find((item) => item.id === id);
        if (alert) next[id] = alert.fingerprint;
      }
      // Forget alerts that no longer exist, so the ledger cannot grow forever.
      for (const key of Object.keys(next)) if (!alerts.some((item) => item.id === key)) delete next[key];
      writeSeen(next);
      return next;
    });
  }, [alerts]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((alert) => alert.id !== id));
    markSeen([id]);
  }, [markSeen]);

  const alertCenter: AlertCenter = {
    alerts,
    unseen,
    toasts,
    drawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
    dismissToast,
    markAllSeen: () => markSeen(alerts.map((alert) => alert.id)),
    reload: () => void reload(),
  };

  return <HRContext.Provider value={{ access, accessError, alertCenter }}>{children}</HRContext.Provider>;
}

export function useHR() {
  const context = useContext(HRContext);
  if (!context) throw new Error('useHR must be used inside <HRProvider>');
  return context;
}
