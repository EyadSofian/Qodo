import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRAFT_TTL_MS,
  dirtyFields,
  draftKey,
  formDraftPayload,
  formFromTask,
  initialDraftText,
  mergePolledTasks,
  mergeServerIntoForm,
  newTaskDraftId,
  persistDraftText,
  pruneDrafts,
  readDraft,
  removeDraft,
  restoreFormDraft,
  restoreNewTaskDraft,
  writeDraft,
} from '../shared/taskDrafts.js';

/** The slice of `localStorage` the draft rules use. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    map,
  };
}

const task = (fields = {}) => ({
  id: 'task-1',
  title: 'Launch brief',
  description: 'Write the launch brief',
  objective: '',
  definitionOfDone: '',
  notes: '',
  department: 'marketing',
  subteam: 'creative',
  stage: 'working',
  priority: 'normal',
  assigneeIds: ['u-employee'],
  taskDate: '2026-09-01',
  dueDate: null,
  effortPoints: 3,
  progress: 40,
  submissionNote: '',
  updatedAt: '2026-09-20T10:00:00.000Z',
  ...fields,
});

const key = (userId, taskId, purpose) =>
  draftKey({ organizationId: 'org-1', userId, taskId, purpose });

/* ── keys ─────────────────────────────────────────────────────────── */

test('a draft key is private to one person, one task and one purpose', () => {
  const mine = key('u-employee', 'task-1', 'submission');
  assert.notEqual(mine, key('u-manager', 'task-1', 'submission'), 'another user');
  assert.notEqual(mine, key('u-employee', 'task-2', 'submission'), 'another task');
  assert.notEqual(mine, key('u-employee', 'task-1', 'comment'), 'another field');
  assert.notEqual(
    mine,
    draftKey({ organizationId: 'org-2', userId: 'u-employee', taskId: 'task-1', purpose: 'submission' }),
    'another organisation'
  );
  // No identity, no key — never a shared fallback.
  assert.equal(draftKey({ organizationId: 'org-1', userId: null, taskId: 'task-1', purpose: 'comment' }), null);
});

test("one employee's unsent draft never opens for another", () => {
  const storage = memoryStorage();
  persistDraftText(storage, key('u-employee', 'task-1', 'submission'), 'my private notes');
  assert.deepEqual(initialDraftText(storage, key('u-manager', 'task-1', 'submission')), {
    text: '',
    restored: false,
  });
  assert.deepEqual(initialDraftText(storage, key('u-employee', 'task-2', 'submission')), {
    text: '',
    restored: false,
  });
});

/* ── submit draft ─────────────────────────────────────────────────── */

test('an unsent submit note survives the panel closing and reopening', () => {
  const storage = memoryStorage();
  const submission = key('u-employee', 'task-1', 'submission');
  const basis = '0:';
  // Typing, then Cancel: the component is gone but the text was persisted.
  persistDraftText(storage, submission, 'Called the client and agreed the date', { basis });
  // Reopening the panel starts from the draft, not from the empty server note.
  assert.deepEqual(initialDraftText(storage, submission, { serverValue: '', basis }), {
    text: 'Called the client and agreed the date',
    restored: true,
  });
});

test('a successful submit clears the draft', () => {
  const storage = memoryStorage();
  const submission = key('u-employee', 'task-1', 'submission');
  persistDraftText(storage, submission, 'Done and attached', { basis: '0:' });
  removeDraft(storage, submission); // what `clear()` does once the POST succeeds
  assert.equal(storage.map.size, 0);
  assert.deepEqual(initialDraftText(storage, submission, { serverValue: 'Done and attached', basis: '0:2026' }), {
    text: 'Done and attached',
    restored: false,
  });
});

test('a newer hand-in on the server beats an older unsent draft', () => {
  const storage = memoryStorage();
  const submission = key('u-employee', 'task-1', 'submission');
  persistDraftText(storage, submission, 'old unsent text', { basis: '0:' });
  // Submitted from another tab since: the basis moved, so the server's note wins.
  const opened = initialDraftText(storage, submission, {
    serverValue: 'what was actually submitted',
    basis: '0:2026-09-21T09:00:00.000Z',
  });
  assert.deepEqual(opened, { text: 'what was actually submitted', restored: false });
  assert.equal(storage.map.size, 0, 'the stale draft is dropped');
});

test('text equal to the saved value, or blank, is not kept as a draft', () => {
  const storage = memoryStorage();
  const submission = key('u-employee', 'task-1', 'submission');
  persistDraftText(storage, submission, 'previous note', { serverValue: 'previous note' });
  assert.equal(storage.map.size, 0);
  persistDraftText(storage, submission, '   ');
  assert.equal(storage.map.size, 0);
});

test('drafts expire, and unreadable ones are swept', () => {
  const storage = memoryStorage();
  const comment = key('u-employee', 'task-1', 'comment');
  writeDraft(storage, comment, 'half a thought', { now: 0 });
  assert.equal(readDraft(storage, comment, { now: DRAFT_TTL_MS + 1 }), null);
  storage.setItem(key('u-employee', 'task-9', 'comment'), '{not json');
  writeDraft(storage, key('u-employee', 'task-3', 'comment'), 'fresh', { now: 10 });
  pruneDrafts(storage, 20);
  assert.deepEqual([...storage.map.keys()], [key('u-employee', 'task-3', 'comment')]);
});

/* ── comment draft ────────────────────────────────────────────────── */

test('an unsent comment comes back after a remount, and a failed send keeps it', () => {
  const storage = memoryStorage();
  const comment = key('u-employee', 'task-1', 'comment');
  persistDraftText(storage, comment, 'Can we move the deadline?');
  // Remount: the box opens with the text.
  assert.equal(initialDraftText(storage, comment).text, 'Can we move the deadline?');
  // A failed POST does not touch storage, so the next mount still has it.
  assert.equal(initialDraftText(storage, comment).restored, true);
  // A successful POST clears it.
  removeDraft(storage, comment);
  assert.deepEqual(initialDraftText(storage, comment), { text: '', restored: false });
});

/* ── the task form ────────────────────────────────────────────────── */

test('the same task re-polled with a new object identity keeps a dirty title', () => {
  const server = formFromTask(task());
  let editor = { form: { ...server, title: 'Launch brief — revised for Q4' }, base: server };

  // Poll: same task, new object, nothing changed on the server.
  editor = mergeServerIntoForm(editor, formFromTask(task()));
  assert.equal(editor.form.title, 'Launch brief — revised for Q4');

  // Poll: somebody else changed the description meanwhile. The untouched field
  // follows the server; the one being typed in does not move.
  editor = mergeServerIntoForm(
    editor,
    formFromTask(task({ description: 'Brief rewritten by the manager', stage: 'review' }))
  );
  assert.equal(editor.form.title, 'Launch brief — revised for Q4');
  assert.equal(editor.form.description, 'Brief rewritten by the manager');
  assert.equal(editor.form.stage, 'review');
  assert.deepEqual(dirtyFields(editor.form, editor.base), ['title']);
});

test('a saved form is clean again once the server answer arrives', () => {
  const server = formFromTask(task());
  const typed = { ...server, notes: 'Waiting on the printer' };
  // Save succeeded: base catches up with the form, then the server copy merges.
  const saved = mergeServerIntoForm(
    { form: typed, base: { ...typed } },
    formFromTask(task({ notes: 'Waiting on the printer' }))
  );
  assert.deepEqual(dirtyFields(saved.form, saved.base), []);
});

test('a closed dialog restores its unsaved fields — unless the server moved on', () => {
  const server = formFromTask(task());
  const payload = formDraftPayload({
    form: { ...server, title: 'New title', notes: 'my notes' },
    base: server,
  });
  assert.deepEqual(Object.keys(payload.values).sort(), ['notes', 'title']);

  // Nothing changed on the server: both come back.
  const same = restoreFormDraft(server, payload);
  assert.equal(same.form.title, 'New title');
  assert.equal(same.form.notes, 'my notes');

  // The manager renamed the task since: the saved title wins, the notes return.
  const renamed = restoreFormDraft(formFromTask(task({ title: 'Renamed by manager' })), payload);
  assert.equal(renamed.form.title, 'Renamed by manager');
  assert.equal(renamed.form.notes, 'my notes');
  assert.deepEqual(renamed.restored, ['notes']);

  // Lost the right to re-plan: the plan field is not restored at all.
  const assigneeOnly = restoreFormDraft(server, payload, { canEditPlan: false, canEditWork: true });
  assert.deepEqual(assigneeOnly.restored, ['notes']);
});

/* ── the board's list ─────────────────────────────────────────────── */

test('a poll sent before a submit cannot roll the submitted task back', () => {
  const before = task({ stage: 'working', submissionNote: '' });
  const submitted = task({
    stage: 'review',
    submissionNote: 'All three banners delivered',
    updatedAt: '2026-09-20T10:05:00.000Z',
  });
  // The poll left before the submit, and came back after it.
  const merged = mergePolledTasks([submitted], [before], new Map([[submitted.id, submitted]]));
  assert.equal(merged[0].submissionNote, 'All three banners delivered');
  assert.equal(merged[0].stage, 'review');

  // A later poll that already carries the submission is simply taken.
  const later = { ...submitted, updatedAt: '2026-09-20T10:06:00.000Z' };
  assert.equal(mergePolledTasks(merged, [later], new Map([[submitted.id, submitted]]))[0], later);
});

test('an unchanged task keeps its identity across polls', () => {
  const current = [task()];
  const merged = mergePolledTasks(current, [task()]);
  assert.equal(merged[0], current[0]);
});

test('a task created or archived after the poll was sent is not undone by it', () => {
  const created = task({ id: 'task-new' });
  const merged = mergePolledTasks([], [task()], new Map([[created.id, created]]));
  assert.deepEqual(merged.map((item) => item.id).sort(), ['task-1', 'task-new']);
  const archived = mergePolledTasks([task()], [task()], new Map(), new Set(['task-1']));
  assert.deepEqual(archived, []);
});

/* ── new tasks ────────────────────────────────────────────────────── */

const blankNew = () => ({
  ...formFromTask(task({ title: '', description: '', assigneeIds: [], effortPoints: null, progress: 0 })),
  stage: 'pending',
});

test('a new-task draft comes back whole after the dialog is closed by accident', () => {
  const storage = memoryStorage();
  const slot = key('u-manager', newTaskDraftId(null), 'form');
  const initial = blankNew();
  const typed = {
    ...initial,
    title: 'Autumn campaign',
    description: 'Three posters',
    objective: 'More sign-ups',
    definitionOfDone: 'Three approved files',
    notes: 'Sizes from sales',
    subteam: 'performance',
    priority: 'high',
    assigneeIds: ['u-employee'],
    taskDate: '2026-09-24',
    dueDate: '2026-09-30',
    effortPoints: '5',
  };
  writeDraft(storage, slot, formDraftPayload({ form: typed, base: initial }));

  const { form, restored } = restoreNewTaskDraft(initial, readDraft(storage, slot).value, {
    allowedDepartments: ['marketing'],
  });
  for (const field of ['title', 'description', 'objective', 'definitionOfDone', 'notes', 'subteam',
    'priority', 'assigneeIds', 'taskDate', 'dueDate', 'effortPoints']) {
    assert.deepEqual(form[field], typed[field], field);
  }
  assert.equal(form.stage, 'pending', 'the column the + was pressed in still decides the stage');
  assert.equal(restored.length, 11);
});

test('a blank new task and each template keep separate draft slots', () => {
  assert.equal(newTaskDraftId(null), 'new');
  assert.equal(newTaskDraftId({ sourceTemplateId: 'hr-payroll' }), 'new-template-hr-payroll');
  assert.notEqual(newTaskDraftId({ sourceTemplateId: 'hr-payroll' }), newTaskDraftId({ sourceTemplateId: 'hr-leave' }));
  assert.equal(newTaskDraftId({ title: 'Same' }), newTaskDraftId({ title: 'Same' }));
  assert.notEqual(newTaskDraftId({ title: 'Same' }), newTaskDraftId({ title: 'Other' }));
  // Keys are per person too, so a new-task draft never reaches a colleague.
  assert.notEqual(key('u-a', 'new', 'form'), key('u-b', 'new', 'form'));
});

test('a restored new-task draft cannot file into a department the viewer lost', () => {
  const initial = blankNew();
  const payload = formDraftPayload({
    form: { ...initial, title: 'Quote', department: 'sales', subteam: '', assigneeIds: ['u-sales'] },
    base: initial,
  });
  const { form } = restoreNewTaskDraft(initial, payload, { allowedDepartments: ['marketing'] });
  assert.equal(form.title, 'Quote');
  assert.equal(form.department, 'marketing');
  assert.deepEqual(form.assigneeIds, []);

  const allowed = restoreNewTaskDraft(initial, payload, { allowedDepartments: ['marketing', 'sales'] });
  assert.equal(allowed.form.department, 'sales');
  assert.notEqual(allowed.form.stage, 'pending', 'the stage follows the restored department');
});

test('an archived task opened from a link never joins the board list', () => {
  const archived = task({ id: 'task-old', archivedAt: '2026-09-01T00:00:00.000Z' });
  const merged = mergePolledTasks([], [task()], new Map([[archived.id, archived]]));
  assert.deepEqual(merged.map((item) => item.id), ['task-1']);
});
