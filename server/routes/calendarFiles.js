/**
 * Files hanging off a calendar entry — the agenda, the deck, the signed page.
 *
 * Same shape as the mail and management attachment routes on purpose: bytes in
 * the blob half, metadata as an ordinary document, the id we generated as the
 * filename so nothing an uploader typed can escape the directory. Who may read
 * the file is exactly who may open the entry, so there is no second answer to
 * keep in sync.
 */

import express, { Router } from 'express';
import { create, find, findOne, getBlob, getStore, putBlob, removeBlob } from '../store.js';
import { attachmentErrors, cleanType, safeName, sendBlob } from '../attachments.js';
import { canAccessEvent, canManageEvent } from '../calendarAccess.js';
import { organizationOf } from '../../shared/organization.js';
import { MAX_ATTACHMENT_BYTES } from '../../shared/workflow.js';

const router = Router({ mergeParams: true });
export const MAX_EVENT_FILES = 8;

async function loadEvent(req, res) {
  const event = await findOne('calendarEvents', (row) => row.id === req.params.eventId);
  if (!event || !canAccessEvent(req.user, event)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return event;
}

export function publicEventAttachment(row) {
  return {
    id: row.id,
    eventId: row.eventId,
    userId: row.userId,
    name: row.name,
    size: row.size,
    type: row.type,
    createdAt: row.createdAt,
  };
}

router.get('/', async (req, res) => {
  const event = await loadEvent(req, res);
  if (!event) return;
  const rows = await find('calendarAttachments', (row) => row.eventId === event.id);
  res.json({
    attachments: rows
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(publicEventAttachment),
  });
});

router.post(
  '/',
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  async (req, res) => {
    const event = await loadEvent(req, res);
    if (!event) return;

    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) return res.status(400).json({ error: 'empty_file' });
    if (bytes.length > MAX_ATTACHMENT_BYTES) return res.status(413).json({ error: 'file_too_large' });

    const existing = await find('calendarAttachments', (row) => row.eventId === event.id);
    if (existing.length >= MAX_EVENT_FILES) {
      return res.status(400).json({ error: 'too_many_event_files', limit: MAX_EVENT_FILES });
    }

    const row = await create('calendarAttachments', {
      organizationId: organizationOf(event),
      eventId: event.id,
      userId: req.user.id,
      name: safeName(req.get('x-file-name')),
      size: bytes.length,
      type: cleanType(req.get('x-file-type')),
    });
    await putBlob(row.id, bytes);
    res.status(201).json({
      attachment: publicEventAttachment(row),
      attachmentCount: existing.length + 1,
    });
  }
);

router.get('/:fileId', async (req, res) => {
  const event = await loadEvent(req, res);
  if (!event) return;
  const row = await findOne(
    'calendarAttachments',
    (file) => file.id === req.params.fileId && file.eventId === event.id
  );
  if (!row) return res.status(404).json({ error: 'not_found' });
  const bytes = await getBlob(row.id);
  if (!bytes) return res.status(404).json({ error: 'not_found' });
  sendBlob(res, row, bytes);
});

/** The uploader takes their own file back; the organizer keeps the agenda tidy. */
router.delete('/:fileId', async (req, res) => {
  const event = await loadEvent(req, res);
  if (!event) return;
  const row = await findOne(
    'calendarAttachments',
    (file) => file.id === req.params.fileId && file.eventId === event.id
  );
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.userId !== req.user.id && !canManageEvent(req.user, event)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const store = await getStore();
  await store.remove('calendarAttachments', row.id);
  await removeBlob(row.id);
  const remaining = await find('calendarAttachments', (file) => file.eventId === event.id);
  res.json({ ok: true, attachmentCount: remaining.length });
});

router.use(attachmentErrors('calendar-files'));

export default router;
