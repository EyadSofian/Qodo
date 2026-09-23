/**
 * Unsent words, kept safe until they are sent.
 *
 * A task carries two very different kinds of text. What has been *saved* — the
 * brief, the notes, a submission note, a comment — lives on the server and is
 * the only version anybody else ever sees. What is still being *typed* belongs
 * to the person typing it, and until they press Save, Submit or Send it exists
 * nowhere but in a component's state — which a closed dialog, a cancelled panel
 * or a remount throws away without asking.
 *
 * This file is the second kind's safety net. It never talks to the server and
 * never decides what the task says; it only remembers what one person had
 * typed so that reopening the task gives it back.
 *
 * Three rules hold everything here together:
 *
 *   Private.  A key names the organisation, the user, the task and what the
 *             text is for. Nobody's draft can surface for anybody else, and one
 *             task's draft never appears on another.
 *
 *   Honest.   Every draft records the server value it was written against — its
 *             `basis`. If the server has moved on since (the work was handed in
 *             from another tab, a manager rewrote the brief), the draft is stale
 *             and the server wins. A draft may fill a gap; it may not overwrite
 *             something newer.
 *
 *   Temporary. A successful write deletes the draft, and anything left behind
 *             expires after `DRAFT_TTL_MS`.
 *
 * Pure and storage-agnostic (anything with getItem/setItem/removeItem/key), so
 * the rules can be tested without a browser.
 */

import { DEFAULT_DEPARTMENT, firstStage } from './departments.js';

export const DRAFT_PREFIX = 'qodo.taskDraft:v1';
export const DRAFT_TTL_MS = 30 * 86_400_000;

/**
 * `null` when the caller cannot be identified — no key is safer than a key a
 * second person could land on.
 * @param {{ organizationId?: string | null, userId?: string | null, taskId?: string | null, purpose: string }} parts
 * @returns {string | null}
 */
export function draftKey({ organizationId, userId, taskId, purpose }) {
  if (!userId || !taskId || !purpose) return null;
  return [DRAFT_PREFIX, organizationId || '-', userId, taskId, purpose].join(':');
}

/**
 * Missing, malformed, expired or written against another basis: all `null`.
 * @param {Storage | null} storage
 * @param {string | null} key
 * @param {{ basis?: string | null, now?: number }} [options]
 * @returns {{ value: any, basis: string | null, savedAt: number } | null}
 */
export function readDraft(storage, key, { basis = null, now = Date.now() } = {}) {
  if (!storage || !key) return null;
  let parsed;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    removeDraft(storage, key);
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) {
    removeDraft(storage, key);
    return null;
  }
  if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > DRAFT_TTL_MS) {
    removeDraft(storage, key);
    return null;
  }
  if ((parsed.basis ?? null) !== (basis ?? null)) {
    removeDraft(storage, key);
    return null;
  }
  return parsed;
}

/**
 * @param {Storage | null} storage
 * @param {string | null} key
 * @param {unknown} value
 * @param {{ basis?: string | null, now?: number }} [options]
 */
export function writeDraft(storage, key, value, { basis = null, now = Date.now() } = {}) {
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify({ value, basis: basis ?? null, savedAt: now }));
    return true;
  } catch {
    // Quota or a locked-down browser. Losing the safety net is not worth an error.
    return false;
  }
}

/**
 * @param {Storage | null} storage
 * @param {string | null} key
 */
export function removeDraft(storage, key) {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do — the draft simply stays until it expires.
  }
}

/**
 * The text a field should open with: the unsent draft when there is a live one
 * that says something the server does not, otherwise what the server has.
 * @param {Storage | null} storage
 * @param {string | null} key
 * @param {{ serverValue?: string, basis?: string | null, now?: number }} [options]
 * @returns {{ text: string, restored: boolean }}
 */
export function initialDraftText(storage, key, { serverValue = '', basis = null, now } = {}) {
  const draft = readDraft(storage, key, { basis, now });
  if (draft && typeof draft.value === 'string' && draft.value !== serverValue && draft.value.trim()) {
    return { text: draft.value, restored: true };
  }
  return { text: serverValue ?? '', restored: false };
}

/**
 * Store the text, or forget it once it no longer differs from what the server
 * already holds — a draft that says the same thing as the record is not a
 * draft, and keeping it would only resurrect stale text later.
 * @param {Storage | null} storage
 * @param {string | null} key
 * @param {string} text
 * @param {{ serverValue?: string, basis?: string | null, now?: number }} [options]
 */
export function persistDraftText(storage, key, text, { serverValue = '', basis = null, now } = {}) {
  if (!text || !text.trim() || text === (serverValue ?? '')) {
    removeDraft(storage, key);
    return;
  }
  writeDraft(storage, key, text, { basis, now });
}

/**
 * Sweep expired and unreadable drafts. Cheap; run once per session.
 * @param {Storage | null} storage
 * @param {number} [now]
 */
export function pruneDrafts(storage, now = Date.now()) {
  if (!storage) return;
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(`${DRAFT_PREFIX}:`)) keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? 'null');
      if (!parsed || typeof parsed.savedAt !== 'number' || now - parsed.savedAt > DRAFT_TTL_MS) {
        removeDraft(storage, key);
      }
    } catch {
      removeDraft(storage, key);
    }
  }
}

/* ── the task form ───────────────────────────────────────────────── */

/**
 * The editable surface of an open task, as the form holds it.
 *
 * The form is split from the task on purpose. Polling hands the dialog a new
 * copy of the same task every twenty seconds; resetting the form from each copy
 * is what used to eat whatever was being typed. Instead the form keeps two
 * snapshots — what the user has in front of them, and the server values that
 * text started from (`base`) — and a field is dirty exactly when the two differ.
 */
export const FORM_FIELDS = [
  'title',
  'description',
  'objective',
  'definitionOfDone',
  'notes',
  'department',
  'subteam',
  'stage',
  'priority',
  'assigneeIds',
  'taskDate',
  'dueDate',
  'effortPoints',
  'progress',
];

/** Fields only whoever holds `tasks.assign` may change; the rest are the doer's. */
export const WORK_FIELDS = ['notes', 'progress'];

export function formFromTask(task) {
  const assignees = Array.isArray(task.assigneeIds) && task.assigneeIds.length
    ? task.assigneeIds
    : task.assigneeId
      ? [task.assigneeId]
      : [];
  return {
    title: task.title ?? '',
    description: task.description ?? '',
    objective: task.objective ?? '',
    definitionOfDone: task.definitionOfDone ?? '',
    notes: task.notes ?? '',
    department: task.department ?? DEFAULT_DEPARTMENT,
    subteam: task.subteam ?? '',
    stage: task.stage ?? '',
    priority: task.priority ?? 'normal',
    assigneeIds: [...assignees],
    taskDate: task.taskDate ?? '',
    dueDate: task.dueDate ?? '',
    effortPoints: task.effortPoints ? String(task.effortPoints) : '',
    progress: task.progress ?? 0,
  };
}

export function sameFieldValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((value, index) => value === right[index]);
  }
  return a === b;
}

export function dirtyFields(form, base) {
  return FORM_FIELDS.filter((field) => !sameFieldValue(form[field], base[field]));
}

/**
 * A fresher server copy of the same task arrives. Fields the user has not
 * touched follow the server; fields they have touched are left exactly as
 * typed. The base moves to the server either way, so "dirty" keeps meaning
 * "differs from what is saved".
 */
export function mergeServerIntoForm({ form, base }, server) {
  const nextForm = { ...form };
  for (const field of FORM_FIELDS) {
    if (sameFieldValue(form[field], base[field])) nextForm[field] = server[field];
  }
  return { form: nextForm, base: { ...server } };
}

/** What a closed dialog leaves behind: the changed fields, and what each changed from. */
export function formDraftPayload({ form, base }) {
  const fields = dirtyFields(form, base);
  if (!fields.length) return null;
  const values = {};
  const basis = {};
  for (const field of fields) {
    values[field] = form[field];
    basis[field] = base[field];
  }
  return { values, basis };
}

/**
 * Reapply a stored form draft over the current server values. A field comes
 * back only when the server still holds what the draft was written against and
 * the viewer may still edit it; anything the server has since changed is
 * dropped, because the newer saved value wins over older unsent text.
 */
export function restoreFormDraft(server, payload, { canEditPlan = true, canEditWork = true } = {}) {
  const form = { ...server };
  const restored = [];
  if (!payload || typeof payload !== 'object' || !payload.values || !payload.basis) {
    return { form, restored };
  }
  for (const field of FORM_FIELDS) {
    if (!(field in payload.values)) continue;
    const allowed = WORK_FIELDS.includes(field) ? canEditWork : canEditPlan;
    if (!allowed) continue;
    if (!sameFieldValue(payload.basis[field], server[field])) continue;
    if (sameFieldValue(payload.values[field], server[field])) continue;
    form[field] = payload.values[field];
    restored.push(field);
  }
  return { form, restored };
}

/* ── a task that does not exist yet ──────────────────────────────── */

/**
 * The draft slot for a new task. A blank "New task" and each template have
 * slots of their own, so starting from the payroll template never pours an
 * unrelated half-written task into it — and vice versa.
 * @param {{ sourceTemplateId?: string | null } | null | undefined} prefill
 * @returns {string}
 */
export function newTaskDraftId(prefill) {
  if (!prefill) return 'new';
  if (prefill.sourceTemplateId) return `new-template-${prefill.sourceTemplateId}`;
  // An anonymous prefill is identified by what it says.
  const text = JSON.stringify(prefill);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `new-prefill-${hash.toString(36)}`;
}

/**
 * Reapply a stored new-task draft over the form the dialog would otherwise open
 * with. There is no server copy to conflict with, so every stored field comes
 * back — except the stage, which is where the "+" was pressed this time, and a
 * department the viewer may no longer file into (taking its sub-team and
 * people with it, since those only mean anything inside that department).
 * @param {Record<string, any>} initial
 * @param {any} payload
 * @param {{ allowedDepartments?: string[] | null }} [options]
 * @returns {{ form: Record<string, any>, restored: string[] }}
 */
export function restoreNewTaskDraft(initial, payload, { allowedDepartments = null } = {}) {
  const form = { ...initial };
  const restored = [];
  if (!payload || typeof payload !== 'object' || !payload.values) return { form, restored };
  const values = { ...payload.values };
  if ('department' in values && allowedDepartments && !allowedDepartments.includes(values.department)) {
    delete values.department;
    delete values.subteam;
    delete values.assigneeIds;
  }
  for (const field of FORM_FIELDS) {
    if (field === 'stage' || field === 'progress' || !(field in values)) continue;
    if (sameFieldValue(values[field], initial[field])) continue;
    form[field] = values[field];
    restored.push(field);
  }
  if (form.department !== initial.department) form.stage = firstStage(form.department);
  return { form, restored };
}

/* ── the board's copy of the tasks ───────────────────────────────── */

/** Whether `a` is at least as recent as `b`, by the server's own clock. */
export function isSameOrNewer(a, b) {
  if (!b) return true;
  if (!a) return false;
  return String(a.updatedAt ?? '') >= String(b.updatedAt ?? '');
}

/**
 * Fold a polled task list into the board's current one.
 *
 * The server's list is the truth about *which* tasks exist. But a poll that was
 * already in flight when somebody pressed Submit answers with the task as it
 * was before the press — and replacing the board with it made the submission
 * note blink out until the next poll. `confirmed` holds the server's own
 * responses to mutations made since this poll was sent; a confirmed copy that
 * is newer than the polled one stays, and `removed` holds tasks archived since.
 * Tasks whose content did not change keep their identity, so a poll that
 * changed nothing re-renders nothing — and an open dialog is not handed a
 * "new" task that is the same task.
 */
export function mergePolledTasks(current, incoming, confirmed = new Map(), removed = new Set()) {
  const previous = new Map((current ?? []).map((task) => [task.id, task]));
  const merged = [];
  for (const task of incoming) {
    if (removed.has(task.id)) continue;
    const mine = confirmed.get(task.id);
    const chosen = mine && !isSameOrNewer(task, mine) ? mine : task;
    const before = previous.get(task.id);
    merged.push(before && JSON.stringify(before) === JSON.stringify(chosen) ? before : chosen);
  }
  // Created after the poll was sent, so the poll could not have known.
  const seen = new Set(incoming.map((task) => task.id));
  for (const [id, task] of confirmed) {
    // An archived task opened from a link is readable, but it is not board work.
    if (!seen.has(id) && !removed.has(id) && !task.archivedAt) merged.unshift(task);
  }
  return merged;
}
