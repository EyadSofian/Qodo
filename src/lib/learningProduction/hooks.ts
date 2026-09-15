/**
 * E-Learning Production — data hooks.
 *
 * A deliberately small cache rather than a new dependency: responses are kept
 * by path, shown immediately on the next visit while a fresh copy loads, and
 * dropped by prefix when an action changes them — approving a PPT invalidates
 * `/learning-production/`, and every open screen refetches what it shows.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const cache = new Map<string, unknown>();
const listeners = new Set<(path: string) => void>();

/** Forget every cached response whose path starts with `prefix`, and refetch the ones on screen. */
export function invalidate(prefix = '/learning-production') {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
  for (const listener of listeners) listener(prefix);
}

export function useLpQuery<T>(path: string | null) {
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

  const replace = useCallback(
    (next: T) => {
      if (path) cache.set(path, next);
      setData(next);
    },
    [path]
  );

  return { data, error, loading, reload: load, setData: replace };
}

/**
 * State kept for the browser session — the filters on the matrix, the tab on
 * My Work — so an action does not reset the view somebody set up.
 */
export function useSessionState<T>(key: string, initial: T) {
  const storageKey = `lp.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* private mode — the filter just won't persist */
    }
  }, [storageKey, value]);
  return [value, setValue] as const;
}

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict';

/**
 * Autosave for the written stages.
 *
 * Saves a second after typing stops, on Ctrl/Cmd+S, and when the editor
 * unmounts. The browser warns before closing the tab only while something is
 * genuinely unsaved — never after a save has completed.
 */
export function useAutosave<T>({
  value,
  enabled,
  save,
  delay = 1000,
}: {
  value: T;
  enabled: boolean;
  save: (value: T) => Promise<void>;
  delay?: number;
}) {
  const [state, setState] = useState<SaveState>('idle');
  const lastSaved = useRef(JSON.stringify(value));
  const pending = useRef<T | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    const next = pending.current;
    if (next === null) return;
    if (inFlight.current) await inFlight.current;
    const serialized = JSON.stringify(next);
    if (serialized === lastSaved.current) {
      pending.current = null;
      return;
    }
    pending.current = null;
    setState('saving');
    const run = saveRef
      .current(next)
      .then(() => {
        lastSaved.current = serialized;
        setState(pending.current ? 'saving' : 'saved');
      })
      .catch((error: unknown) => {
        pending.current = pending.current ?? next;
        const code = (error as { code?: string })?.code;
        setState(code === 'DRAFT_CONFLICT' ? 'conflict' : 'failed');
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = run;
    await run;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (JSON.stringify(value) === lastSaved.current) return;
    pending.current = value;
    const timer = window.setTimeout(() => void flush(), delay);
    return () => window.clearTimeout(timer);
  }, [value, enabled, delay, flush]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (enabled) void flush();
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current !== null || inFlight.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', beforeUnload);
      // Leaving the editor inside the app: save what is left rather than warn.
      if (pending.current !== null) void flush();
    };
  }, [enabled, flush]);

  /** Mark a value as already saved — after loading, or after the server changed it. */
  const reset = useCallback((saved: T) => {
    lastSaved.current = JSON.stringify(saved);
    pending.current = null;
    setState('idle');
  }, []);

  return { state, flush, reset };
}
