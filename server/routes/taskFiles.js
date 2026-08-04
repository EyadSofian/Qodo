/**
 * Task deliverables.
 *
 * The evidence half of the lifecycle: an employee finishing a task attaches
 * what they produced, and the manager reviews *that* rather than taking "done"
 * on trust. Mounted under /api/tasks/:id/attachments.
 *
 * Bytes go to the store's blob half; the row describing them is an ordinary
 * document, so listing a task's files never touches the file contents.
 *
 * Uploads arrive as a raw body — one file per request, no multipart parser to
 * depend on. The name and the real media type travel in headers instead of the
 * body, which also keeps a genuine .json deliverable away from the global JSON
 * body parser: every upload declares `application/octet-stream` on the wire.
 */

import express, { Router } from 'express';
import { create, find, findOne, getBlob, getStore, putBlob, removeBlob } from '../store.js';
import { logActivity } from '../auth.js';
import { isArchived, taskPredicate } from '../taskAccess.js';
import {
  MAX_ATTACHMENTS_PER_TASK,
  MAX_ATTACHMENT_BYTES,
  isDoer,
  isReviewer,
  taskState,
} from '../../shared/workflow.js';
import { organizationOf } from '../../shared/organization.js';

const router = Router({ mergeParams: true });

/**
 * Types the browser may render in place. Everything else is forced to download
 * as an opaque octet-stream: an uploaded .html or .svg served inline would run
 * its own script on this origin, which is the classic stored-XSS-by-upload.
 */
const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

/* ── helpers ─────────────────────────────────────────────────────── */

async function loadTask(req, res) {
  const task = await findOne('tasks', (t) => t.id === req.params.id);
  if (!task || !taskPredicate(req.user)(task)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return task;
}

/** Who may add evidence: the person doing the work, whoever filed it, or a manager. */
function canAttach(user, task) {
  if (isArchived(task)) return false;
  if (taskState(task) === 'approved' && !isReviewer(user)) return false;
  return isDoer(user, task) || isReviewer(user) || task.createdBy === user.id;
}

/**
 * Uploaders can take back their own file until the task is closed; managers
 * always can. Nobody edits the contents of an archive — the deliverables are
 * the record of what was handed in.
 */
function canRemove(user, task, attachment) {
  if (isArchived(task)) return false;
  if (isReviewer(user)) return true;
  if (taskState(task) === 'approved') return false;
  return attachment.userId === user.id;
}

/**
 * A filename arrives from someone else's computer, so it is treated as text,
 * never as a path: separators, quotes and control characters are flattened to
 * spaces. The bytes are stored under the id we generated, so this only affects
 * what the name looks like coming back out.
 */
function safeName(raw) {
  let name = String(raw || '');
  try {
    name = decodeURIComponent(name);
  } catch {
    /* not percent-encoded — take it literally */
  }
  const flattened = [...name]
    .map((character) => {
      const code = character.codePointAt(0);
      const unsafe = character === '"' || character === '/' || character === '\\';
      return unsafe || code < 0x20 || code === 0x7f ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return (flattened || 'file').slice(0, 180);
}

function cleanType(raw) {
  const type = String(raw || '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type : 'application/octet-stream';
}

export function publicAttachment(row) {
  return {
    id: row.id,
    taskId: row.taskId,
    userId: row.userId,
    name: row.name,
    size: row.size,
    type: row.type,
    createdAt: row.createdAt,
  };
}

/**
 * Keeps the count the board and table read in step with reality, so a card can
 * show "3 deliverables" without a request per card.
 */
export async function syncAttachmentCount(taskId) {
  const store = await getStore();
  const rows = await find('attachments', (a) => a.taskId === taskId);
  await store.update('tasks', taskId, { attachmentCount: rows.length });
  return rows.length;
}

/* ── routes ──────────────────────────────────────────────────────── */

router.get('/', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;
  const rows = (await find('attachments', (a) => a.taskId === task.id)).sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : 1
  );
  res.json({ attachments: rows.map(publicAttachment), canAttach: canAttach(req.user, task) });
});

router.post('/', express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }), async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;
  if (!canAttach(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (bytes.length === 0) return res.status(400).json({ error: 'empty_file' });
  if (bytes.length > MAX_ATTACHMENT_BYTES) return res.status(413).json({ error: 'file_too_large' });

  const existing = await find('attachments', (a) => a.taskId === task.id);
  if (existing.length >= MAX_ATTACHMENTS_PER_TASK) {
    return res.status(400).json({ error: 'too_many_files' });
  }

  const row = await create('attachments', {
    organizationId: organizationOf(task),
    taskId: task.id,
    userId: req.user.id,
    name: safeName(req.get('x-file-name')),
    size: bytes.length,
    type: cleanType(req.get('x-file-type')),
  });
  await putBlob(row.id, bytes);
  const count = await syncAttachmentCount(task.id);

  await logActivity({
    actorId: req.user.id,
    action: 'task.attach',
    subject: 'task',
    subjectId: task.id,
    meta: { name: row.name, size: row.size },
  });

  res.status(201).json({ attachment: publicAttachment(row), attachmentCount: count });
});

router.get('/:fileId', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;

  const row = await findOne('attachments', (a) => a.id === req.params.fileId && a.taskId === task.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const bytes = await getBlob(row.id);
  if (!bytes) return res.status(404).json({ error: 'not_found' });

  const inline = INLINE_TYPES.has(row.type);
  res
    .set({
      'Content-Type': inline ? row.type : 'application/octet-stream',
      'Content-Length': String(bytes.length),
      // RFC 5987 encoding — an Arabic filename is not header-safe otherwise.
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      // Belt and braces around anything that slipped past the type allowlist.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=300',
    })
    .send(bytes);
});

router.delete('/:fileId', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;

  const row = await findOne('attachments', (a) => a.id === req.params.fileId && a.taskId === task.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (!canRemove(req.user, task, row)) return res.status(403).json({ error: 'forbidden' });

  const store = await getStore();
  await store.remove('attachments', row.id);
  await removeBlob(row.id);
  const count = await syncAttachmentCount(task.id);

  res.json({ ok: true, attachmentCount: count });
});

/**
 * Body-parser rejections surface here as thrown errors carrying a `type`.
 * Without this they would reach the global handler and be reported as a server
 * fault, when in fact the user simply picked a file that is too big.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
router.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'file_too_large' });
  console.error('[attachments]', err);
  res.status(500).json({ error: 'server_error' });
});

export default router;
