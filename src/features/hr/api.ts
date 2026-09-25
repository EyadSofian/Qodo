/**
 * HR V2 data layer — the same small cache E-Learning Production uses, scoped
 * to `/hr`. A screen shows its last answer immediately on return while a fresh
 * copy loads, and an action invalidates by prefix so every open screen that
 * shows the thing it changed refetches it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api';

const cache = new Map<string, unknown>();
const listeners = new Set<(prefix: string) => void>();

export function invalidateHR(prefix = '/hr') {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
  for (const listener of listeners) listener(prefix);
}

export function useHRQuery<T>(path: string | null, { refreshMs = 0 }: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(() => (path ? ((cache.get(path) as T | undefined) ?? null) : null));
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path) && !cache.has(path ?? ''));
  const current = useRef(path);
  current.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    if (!cache.has(path)) setLoading(true);
    try {
      const result = await api.get<T>(path);
      cache.set(path, result);
      if (current.current === path) {
        setData(result);
        setError(null);
      }
    } catch (failure) {
      if (current.current === path) setError(failure);
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setData(path ? ((cache.get(path) as T | undefined) ?? null) : null);
    setError(null);
    void load();
  }, [path, load]);

  useEffect(() => {
    const listener = (prefix: string) => {
      if (path && path.startsWith(prefix)) void load();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [path, load]);

  useEffect(() => {
    if (!refreshMs || !path) return undefined;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [path, load, refreshMs]);

  const replace = useCallback(
    (next: T) => {
      if (path) cache.set(path, next);
      setData(next);
    },
    [path]
  );

  return { data, error, loading, reload: load, setData: replace };
}

export const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;
export const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

/** An ApiError's payload — the capacity picture, the missing fields, the band. */
export function errorPayload<T = Record<string, unknown>>(error: unknown): T | null {
  return error instanceof ApiError ? (error.payload as T) : null;
}

export const hrApi = {
  access: '/hr/access',
  home: '/hr/overview',
  people: '/hr/people',
  employee: (code: string) => `/hr/employees/${encodeURIComponent(code)}`,
  employeeOdoo: (code: string) => `/hr/employees/${encodeURIComponent(code)}/odoo`,
  payroll: '/hr/payroll',
  organization: '/hr/organization',
  performance: (period?: string, quarter?: string) => `/hr/performance${query({ period, quarter })}`,
  review: (code: string, quarter: string) => `/hr/performance/reviews/${encodeURIComponent(code)}/${encodeURIComponent(quarter)}`,
  reports: '/hr/reports',
  report: (id: string, filters: Record<string, string>) => `/hr/reports/${id}${query(filters)}`,
  settings: '/hr/settings',
  reconciliation: '/hr/settings/reconciliation',
  audit: '/hr/settings/audit',
  personnel: (type?: string) => `/hr/personnel${query({ type })}`,
  personnelCase: (id: string) => `/hr/personnel/${encodeURIComponent(id)}`,
  leave: '/hr/personnel/leave',
  dashboard: '/hr/dashboard',
  imports: '/hr/imports',
  recruitment: {
    overview: '/hr/recruitment/overview',
    alerts: '/hr/recruitment/alerts',
    capacity: '/hr/recruitment/capacity',
    capacityCheck: (recruiterCode: string, priority: string, requestId?: string) => `/hr/recruitment/capacity/check${query({ recruiterCode, priority, requestId })}`,
    requests: (status?: string, scope?: string) => `/hr/recruitment/requests${query({ status, scope })}`,
    request: (id: string) => `/hr/recruitment/requests/${encodeURIComponent(id)}`,
    pipeline: (id: string) => `/hr/recruitment/requests/${encodeURIComponent(id)}/odoo`,
    odoo: '/hr/recruitment/odoo',
    pipelines: '/hr/recruitment/odoo/pipelines',
    kpi: (period?: string) => `/hr/recruitment/kpi${query({ period })}`,
    kpiDetail: (code: string, period?: string) => `/hr/recruitment/kpi/${encodeURIComponent(code)}${query({ period })}`,
    rewards: '/hr/recruitment/rewards',
  },
};

function query(values: Record<string, string | undefined | null>) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return entries.length ? `?${new URLSearchParams(entries as Array<[string, string]>).toString()}` : '';
}

/** A POST/PATCH/PUT that invalidates the HR cache on success. */
export async function hrMutate<T>(method: 'post' | 'patch' | 'put', path: string, body?: unknown, invalidate = '/hr') {
  const result = method === 'post' ? await api.post<T>(path, body) : method === 'patch' ? await api.patch<T>(path, body ?? {}) : await api.put<T>(path, body ?? {});
  invalidateHR(invalidate);
  return result;
}

/** A stable, random key for one submission of a dialog — a double click is one write. */
export function idempotencyKey() {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `k-${random}`;
}
