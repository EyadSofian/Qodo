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
import { attachmentErrors, cleanType, safeName, sendBlob } from '../attachments.js';

const router = Router({ mergeParams: true });

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
 * A great deal of this company's work *is* a link — the campaign sheet, the
 * Drive folder, the Figma file, the post that went live. Demanding an upload
 * for those got people screenshotting a spreadsheet, or exporting a copy that
 * was stale by the next morning, which is worse evidence than the address of
 * the living thing.
 *
 * Only `http:` and `https:` are accepted. The URL comes back out as an `href`,
 * so `javascript:` and `data:` here would be stored XSS with extra steps.
 */
const MAX_LINK_LENGTH = 2000;

function parseDeliverableUrl(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length > MAX_LINK_LENGTH) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.href;
}

/** What a link is called when nobody named it: its host, which is the useful part. */
function linkLabel(raw, url) {
  const given = safeName(raw);
  if (given && given !== 'file') return given;
  try {
    return new URL(url).hostname.replace(/^www\./, '').slice(0, 180) || 'link';
  } catch {
    return 'link';
  }
}

export const isLink = (row) => row?.kind === 'link';

export function publicAttachment(row) {
  return {
    id: row.id,
    taskId: row.taskId,
    userId: row.userId,
    name: row.name,
    size: row.size,
    type: row.type,
    kind: row.kind ?? 'file',
    url: row.url ?? null,
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

/**
 * The same deliverable gate, satisfied by an address instead of bytes. It is a
 * separate route rather than a flag on the upload because the upload route owns
 * the raw body parser, and a JSON body would never survive the trip.
 */
router.post('/link', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;
  if (!canAttach(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  const url = parseDeliverableUrl(req.body?.url);
  if (!url) return res.status(400).json({ error: 'invalid_link' });

  const existing = await find('attachments', (a) => a.taskId === task.id);
  if (existing.length >= MAX_ATTACHMENTS_PER_TASK) {
    return res.status(400).json({ error: 'too_many_files' });
  }

  const row = await create('attachments', {
    organizationId: organizationOf(task),
    taskId: task.id,
    userId: req.user.id,
    kind: 'link',
    url,
    name: linkLabel(req.body?.name, url),
    size: 0,
    type: 'text/uri-list',
  });
  const count = await syncAttachmentCount(task.id);

  await logActivity({
    actorId: req.user.id,
    action: 'task.attach',
    subject: 'task',
    subjectId: task.id,
    meta: { name: row.name, url },
  });

  res.status(201).json({ attachment: publicAttachment(row), attachmentCount: count });
});

router.get('/:fileId', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;

  const row = await findOne('attachments', (a) => a.id === req.params.fileId && a.taskId === task.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  // A link has no bytes to serve, and bouncing the browser to an address a user
  // supplied would make this endpoint an open redirect. The client already has
  // the URL from the listing and opens it directly.
  if (isLink(row)) return res.status(400).json({ error: 'link_deliverable' });

  const bytes = await getBlob(row.id);
  if (!bytes) return res.status(404).json({ error: 'not_found' });

  sendBlob(res, row, bytes);
});

router.delete('/:fileId', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;

  const row = await findOne('attachments', (a) => a.id === req.params.fileId && a.taskId === task.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (!canRemove(req.user, task, row)) return res.status(403).json({ error: 'forbidden' });

  const store = await getStore();
  await store.remove('attachments', row.id);
  if (!isLink(row)) await removeBlob(row.id);
  const count = await syncAttachmentCount(task.id);

  res.json({ ok: true, attachmentCount: count });
});

router.use(attachmentErrors('attachments'));

export default router;
