/** Draft and delivered files for Qodo Mail messages. */

import express, { Router } from 'express';
import { create, find, findOne, getBlob, getStore, putBlob, removeBlob } from '../store.js';
import { attachmentErrors, cleanType, safeName, sendBlob } from '../attachments.js';
import { canAccessConversation } from '../mailAccess.js';
import { organizationOf } from '../../shared/organization.js';
import { MAX_ATTACHMENT_BYTES } from '../../shared/workflow.js';

const router = Router({ mergeParams: true });
export const MAX_MAIL_FILES = 6;

async function loadConversation(req, res) {
  const conversation = await findOne(
    'mailConversations',
    (row) => row.id === req.params.conversationId
  );
  if (!conversation || !canAccessConversation(req.user, conversation)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return conversation;
}

export function publicMailAttachment(row) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId ?? null,
    userId: row.userId,
    name: row.name,
    size: row.size,
    type: row.type,
    createdAt: row.createdAt,
  };
}

router.post(
  '/',
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  async (req, res) => {
    const conversation = await loadConversation(req, res);
    if (!conversation) return;

    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) return res.status(400).json({ error: 'empty_file' });
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      return res.status(413).json({ error: 'file_too_large' });
    }

    // At most one unsent composer batch per person/conversation. Already sent
    // files do not count; they belong to their message from then on.
    const drafts = await find(
      'mailAttachments',
      (row) =>
        row.conversationId === conversation.id && row.userId === req.user.id && !row.messageId
    );
    if (drafts.length >= MAX_MAIL_FILES) {
      return res.status(400).json({ error: 'too_many_mail_files', limit: MAX_MAIL_FILES });
    }

    const row = await create('mailAttachments', {
      organizationId: organizationOf(conversation),
      conversationId: conversation.id,
      messageId: null,
      userId: req.user.id,
      name: safeName(req.get('x-file-name')),
      size: bytes.length,
      type: cleanType(req.get('x-file-type')),
    });
    await putBlob(row.id, bytes);
    res.status(201).json({ attachment: publicMailAttachment(row) });
  }
);

router.get('/:fileId', async (req, res) => {
  const conversation = await loadConversation(req, res);
  if (!conversation) return;
  const row = await findOne(
    'mailAttachments',
    (file) => file.id === req.params.fileId && file.conversationId === conversation.id
  );
  if (!row || (!row.messageId && row.userId !== req.user.id)) {
    return res.status(404).json({ error: 'not_found' });
  }
  const bytes = await getBlob(row.id);
  if (!bytes) return res.status(404).json({ error: 'not_found' });
  sendBlob(res, row, bytes);
});

router.delete('/:fileId', async (req, res) => {
  const conversation = await loadConversation(req, res);
  if (!conversation) return;
  const row = await findOne(
    'mailAttachments',
    (file) => file.id === req.params.fileId && file.conversationId === conversation.id
  );
  // Delivered files are part of the conversation record. This endpoint only
  // clears a draft the uploader changed their mind about.
  if (!row || row.userId !== req.user.id || row.messageId) {
    return res.status(404).json({ error: 'not_found' });
  }
  const store = await getStore();
  await store.remove('mailAttachments', row.id);
  await removeBlob(row.id);
  res.json({ ok: true });
});

router.use(attachmentErrors('mail-files'));

export default router;
