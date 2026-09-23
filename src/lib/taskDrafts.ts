/**
 * The browser side of `shared/taskDrafts.js`: where drafts are stored, and a
 * hook that gives a textarea a draft of its own.
 *
 * The rules — who a draft belongs to, when it is stale, when it is forgotten —
 * live in the shared file where they are tested. This one only wires them to
 * `localStorage` and to React's lifecycle: writes are debounced so typing never
 * waits on storage, and whatever is still pending is written the moment the
 * field unmounts or the page is hidden, which is exactly when it would
 * otherwise be lost.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  draftKey,
  initialDraftText,
  persistDraftText,
  pruneDrafts,
  readDraft,
  removeDraft,
  writeDraft,
} from '@shared/taskDrafts';
import { useAuth } from './auth';

export type DraftPurpose = 'submission' | 'comment' | 'review' | 'return' | 'assignment' | 'form';

const WRITE_DELAY_MS = 400;

let pruned = false;

/** `localStorage`, or null where the browser refuses it (private mode, policy). */
export function draftStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    if (!pruned) {
      pruned = true;
      pruneDrafts(storage);
    }
    return storage;
  } catch {
    return null;
  }
}

/** The caller's key for one task and purpose — null while signed out. */
export function useDraftKey(taskId: string | null | undefined, purpose: DraftPurpose) {
  const { user } = useAuth();
  return draftKey({
    organizationId: user?.organizationId,
    userId: user?.id,
    taskId,
    purpose,
  }) as string | null;
}

export { readDraft, removeDraft, writeDraft };

interface Pending {
  key: string;
  text: string;
  serverValue: string;
  basis: string | null;
}

/**
 * State for one free-text field that must survive being unmounted.
 *
 * `serverValue` is what the field shows when there is no draft (a previous
 * submission note, or nothing). `basis` identifies the server state a draft is
 * written against; when it changes — the work was handed in elsewhere, say —
 * an older draft no longer applies and is dropped rather than shown.
 */
export function useDraftText({
  taskId,
  purpose,
  serverValue = '',
  basis = null,
}: {
  taskId: string;
  purpose: DraftPurpose;
  serverValue?: string;
  basis?: string | null;
}) {
  const key = useDraftKey(taskId, purpose);
  const [state, setState] = useState(() => ({
    key,
    ...initialDraftText(draftStorage(), key, { serverValue, basis }),
  }));
  const pending = useRef<Pending | null>(null);
  const timer = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    pending.current = null;
    if (next) {
      persistDraftText(draftStorage(), next.key, next.text, {
        serverValue: next.serverValue,
        basis: next.basis,
      });
    }
  }, []);

  // Another task, or another person, in the same component: start from that
  // key's own draft. Adjusting during render keeps the wrong text from ever
  // being painted.
  if (state.key !== key) {
    flush();
    setState({ key, ...initialDraftText(draftStorage(), key, { serverValue, basis }) });
  }

  const setText = useCallback(
    (text: string) => {
      setState((current) => ({ ...current, text, restored: current.restored && text !== '' }));
      if (!key) return;
      pending.current = { key, text, serverValue, basis };
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, WRITE_DELAY_MS);
    },
    [key, serverValue, basis, flush]
  );

  /** The text reached the server: forget the draft and show `next`. */
  const clear = useCallback(
    (next = '') => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      removeDraft(draftStorage(), key);
      setState((current) => ({ ...current, text: next, restored: false }));
    },
    [key]
  );

  // Unmounting (a closed dialog, a cancelled panel) and a hidden page are the two
  // moments a debounced write would otherwise never happen.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  return { text: state.text, setText, clear, restored: state.restored };
}
