/**
 * Files on a management item.
 *
 * The desk records meetings, decisions and tasks that mostly arrive as a
 * sentence — and a sentence is often not the evidence. The photo of the signed
 * page, the screenshot of the quote, the picture of the whiteboard after the
 * meeting: those are the item, and typing a description of them is how the
 * record ends up worth less than the chat it came from.
 *
 * Mounted under /api/management/items/:id/attachments, inside the desk's own
 * `management.view` wall. Reading a file is therefore exactly as private as
 * reading the item it hangs on, and writing one needs `management.manage` —
 * the same split the rest of the desk already uses.
 *
 * Bytes go to the store's blob half; the row describing them is an ordinary
 * document, so listing an item's files never touches the file contents. The
 * name handling, the media-type allowlist and the download headers are shared
 * with task deliverables in `server/attachments.js` — a security decision with
 * two copies is a security decision that will drift.
 */

import express, { Router } from 'express';
import { create, find, findOne, getBlob, getStore, putBlob, removeBlob } from '../store.js';
import { logActivity, requirePermission } from '../auth.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { MAX_ATTACHMENT_BYTES } from '../../shared/workflow.js';
import { attachmentErrors, cleanType, safeName, sendBlob } from '../attachments.js';

const router = Router({ mergeParams: true });

/**
 * Lower than a task's dozen on purpose. A deliverable is the work itself and
 * can legitimately be many files; a desk item is a note about something that
 * happened, and the handful of pictures proving it is the whole use case.
 */
const MAX_FILES_PER_ITEM = 8;

async function loadItem(req, res) {
  const item = await findOne('managementItems', (row) => row.id === req.params.id);
  // Same 404 for "no such item" and "not your organization" — which of the two
  // it is, is itself something another tenant should not learn.
  if (!item || organizationOf(item) !== organizationOf(req.user)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return item;
}

function publicFile(row) {
  return {
    id: row.id,
    itemId: row.itemId,
    userId: row.userId,
    name: row.name,
    size: row.size,
    type: row.type,
    createdAt: row.createdAt,
  };
}

/**
 * Keeps the count on the item itself, so a board of thirty cards can show which
 * ones carry a picture without thirty extra requests.
 */
async function syncCount(itemId) {
  const store = await getStore();
  const rows = await find('attachments', (row) => row.itemId === itemId);
  await store.update('managementItems', itemId, { attachmentCount: rows.length });
  return rows.length;
}

/* ── routes ──────────────────────────────────────────────────────── */

router.get('/', async (req, res) => {
  const item = await loadItem(req, res);
  if (!item) return;
  const rows = (await find('attachments', (row) => row.itemId === item.id)).sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : 1
  );
  res.json({ attachments: rows.map(publicFile) });
});

router.get('/:fileId', async (req, res) => {
  const item = await loadItem(req, res);
  if (!item) return;

  const row = await findOne(
    'attachments',
    (file) => file.id === req.params.fileId && file.itemId === item.id
  );
  if (!row) return res.status(404).json({ error: 'not_found' });

  const bytes = await getBlob(row.id);
  if (!bytes) return res.status(404).json({ error: 'not_found' });

  sendBlob(res, row, bytes);
});

router.post(
  '/',
  requirePermission(PERMISSIONS.MANAGEMENT_MANAGE),
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  async (req, res) => {
    const item = await loadItem(req, res);
    if (!item) return;

    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) return res.status(400).json({ error: 'empty_file' });
    if (bytes.length > MAX_ATTACHMENT_BYTES) return res.status(413).json({ error: 'file_too_large' });

    const existing = await find('attachments', (row) => row.itemId === item.id);
    if (existing.length >= MAX_FILES_PER_ITEM) {
      return res.status(400).json({ error: 'too_many_files', limit: MAX_FILES_PER_ITEM });
    }

    const row = await create('attachments', {
      organizationId: organizationOf(item),
      itemId: item.id,
      userId: req.user.id,
      name: safeName(req.get('x-file-name')),
      size: bytes.length,
      type: cleanType(req.get('x-file-type')),
    });
    await putBlob(row.id, bytes);
    const count = await syncCount(item.id);

    await logActivity({
      actorId: req.user.id,
      action: 'management.attach',
      subject: 'managementItem',
      subjectId: item.id,
      meta: { name: row.name, size: row.size },
    });

    res.status(201).json({ attachment: publicFile(row), attachmentCount: count });
  }
);

router.delete('/:fileId', requirePermission(PERMISSIONS.MANAGEMENT_MANAGE), async (req, res) => {
  const item = await loadItem(req, res);
  if (!item) return;

  const row = await findOne(
    'attachments',
    (file) => file.id === req.params.fileId && file.itemId === item.id
  );
  if (!row) return res.status(404).json({ error: 'not_found' });

  const store = await getStore();
  await store.remove('attachments', row.id);
  await removeBlob(row.id);
  const count = await syncCount(item.id);

  await logActivity({
    actorId: req.user.id,
    action: 'management.detach',
    subject: 'managementItem',
    subjectId: item.id,
    meta: { name: row.name },
  });

  res.json({ ok: true, attachmentCount: count });
});

router.use(attachmentErrors('management-files'));

export default router;
