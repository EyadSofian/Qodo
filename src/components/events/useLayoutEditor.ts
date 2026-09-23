/**
 * The schedule layout, loaded, and — for a layout manager — edited as a draft.
 *
 * Nothing is persisted per drag. Entering edit mode snapshots the saved
 * layout and its revision; every change replaces the draft and pushes the
 * previous one on an undo stack; Save sends the draft with the revision it
 * started from, and the server refuses it (409) if somebody saved in between.
 * Cancel just drops the draft.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sameLayout } from '@shared/eventsLayout';
import { ApiError, errorMessage } from '../../lib/api';
import {
  fetchLayout,
  fetchStaleReferences,
  resetLayout,
  saveLayout,
  type EventLayout,
  type LayoutResponse,
  type StaleReference,
} from '../../lib/eventsLayout';

const UNDO_LIMIT = 60;

export type Conflict = { revision: number; updatedAt: string | null; updatedBy: { name: string | null } | null };

export function useLayoutEditor(ready: boolean) {
  const [saved, setSaved] = useState<LayoutResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<EventLayout | null>(null);
  const [baseRevision, setBaseRevision] = useState(0);
  const [history, setHistory] = useState<EventLayout[]>([]);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [stale, setStale] = useState<StaleReference[]>([]);
  /** Set after a save: "Updated by … · just now". */
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchLayout();
      setSaved(result);
      setLoadError('');
      return result;
    } catch (err) {
      setLoadError(errorMessage(err, 'ar'));
      return null;
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const editing = draft !== null;
  const dirty = editing && saved !== null && !sameLayout(draft, saved.layout);

  const begin = useCallback(() => {
    if (!saved) return;
    setDraft(structuredClone(saved.layout));
    setBaseRevision(saved.revision);
    setHistory([]);
    setConflict(null);
    setStale([]);
    setJustSaved(false);
    // Which references Odoo no longer has — marked "Unavailable" while editing.
    fetchStaleReferences()
      .then((result) => setStale(result.missing))
      .catch(() => setStale([]));
  }, [saved]);

  const draftRef = useRef(draft);
  draftRef.current = draft;

  /** One structural change: `change` returns the next layout (or the same one for a no-op). */
  const apply = useCallback((change: (layout: EventLayout) => EventLayout) => {
    const current = draftRef.current;
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    setHistory((stack) => [...stack.slice(-UNDO_LIMIT + 1), current]);
    setDraft(next);
  }, []);

  const undo = useCallback(() => {
    setHistory((stack) => {
      if (stack.length === 0) return stack;
      setDraft(stack[stack.length - 1]);
      return stack.slice(0, -1);
    });
  }, []);

  const cancel = useCallback(() => {
    setDraft(null);
    setHistory([]);
    setConflict(null);
  }, []);

  const save = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    if (!draftRef.current) return { ok: false };
    setSaving(true);
    try {
      const result = await saveLayout(draftRef.current, baseRevision);
      setSaved((previous) => ({ ...result, canManage: previous?.canManage }));
      setDraft(null);
      setHistory([]);
      setConflict(null);
      setJustSaved(true);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.code === 'layout_conflict') {
        setConflict((err.payload.current as Conflict) ?? { revision: -1, updatedAt: null, updatedBy: null });
      }
      return { ok: false, message: errorMessage(err, 'ar') };
    } finally {
      setSaving(false);
    }
  }, [baseRevision]);

  /** After a conflict: take the latest saved layout and start editing from it again. */
  const reloadLatest = useCallback(async () => {
    const latest = await load();
    if (!latest) return;
    setDraft(structuredClone(latest.layout));
    setBaseRevision(latest.revision);
    setHistory([]);
    setConflict(null);
  }, [load]);

  const reset = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    setSaving(true);
    try {
      const result = await resetLayout(saved?.revision ?? 0);
      setSaved((previous) => ({ ...result, canManage: previous?.canManage }));
      setDraft(null);
      setHistory([]);
      setConflict(null);
      setJustSaved(true);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.code === 'layout_conflict') setConflict(err.payload.current as Conflict);
      return { ok: false, message: errorMessage(err, 'ar') };
    } finally {
      setSaving(false);
    }
  }, [saved?.revision]);

  // Leaving the tab or closing the window with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  // Ctrl/Cmd+Z undoes the last structural change — unless somebody is typing.
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      event.preventDefault();
      undo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing, undo]);

  const layout = draft ?? saved?.layout ?? null;
  const removeStale = useCallback((ids: number[]) => setStale((list) => list.filter((entry) => !ids.includes(entry.eventId))), []);

  return useMemo(
    () => ({
      saved,
      loadError,
      layout,
      editing,
      dirty,
      canUndo: history.length > 0,
      saving,
      conflict,
      stale,
      justSaved,
      canManage: Boolean(saved?.canManage),
      begin,
      apply,
      undo,
      cancel,
      save,
      reset,
      reloadLatest,
      removeStale,
      reload: load,
    }),
    [saved, loadError, layout, editing, dirty, history.length, saving, conflict, stale, justSaved, begin, apply, undo, cancel, save, reset, reloadLatest, removeStale, load]
  );
}

export type LayoutEditor = ReturnType<typeof useLayoutEditor>;
