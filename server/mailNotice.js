/**
 * Posting into a conversation from outside Qodo Mail, and the one place that
 * decides what a new message tells people.
 *
 * Qodo Calendar needs to drop a card into the thread a meeting was arranged
 * from — that is the whole point of arranging it there rather than on a
 * separate screen. Rewriting the send path inside the calendar would give the
 * workspace two implementations of "a message arrived", which is how the bell,
 * the push notification and the unread badge start disagreeing. So the notify
 * half is lifted out of `routes/mail.js` and shared, and the notice half is a
 * deliberately narrow send: a body, an optional linked event, no attachments,
 * no reply, no mentions.
 */

import { create, getStore } from './store.js';
import {
  audienceForConversation,
  canAccessConversation,
  ensureMembership,
} from './mailAccess.js';
import { publishMail } from './mailStream.js';
import { publishNotification } from './notificationStream.js';
import { notifyUser } from './push.js';
import { organizationOf } from '../shared/organization.js';
import { isActiveUser } from '../shared/permissions.js';

/** The bell, the badge and the phone, for one recipient of one message. */
export async function notifyConversationMessage(target, actor, conversation, preview) {
  if (!target || !isActiveUser(target)) return;
  const channelName = conversation.nameAr || conversation.nameEn || '';
  const subject = conversation.subject || channelName;
  const title = {
    ar: conversation.kind === 'mail' ? `Qodo Mail: ${subject}` : `${actor.name} · ${subject}`,
    en: conversation.kind === 'mail' ? `Qodo Mail: ${subject}` : `${actor.name} · ${subject}`,
  };
  const body = preview.slice(0, 180);
  const link = `/mail?conversation=${encodeURIComponent(conversation.id)}`;
  const notification = await create('notifications', {
    organizationId: organizationOf(target),
    userId: target.id,
    actorId: actor.id,
    type: 'mail.message',
    title,
    body,
    link,
    read: false,
  });
  publishNotification(target.id, notification.id);
  await notifyUser(target.id, { title, body, link });
}

/**
 * One message into a conversation, attributed to a real person.
 *
 * Not a system account: the meeting card in the thread was put there by whoever
 * arranged the meeting, and attributing it to "the system" would hide that.
 * Everybody who can see the conversation is told, because a meeting card is the
 * kind of message a channel exists to carry.
 */
export async function postConversationNotice(conversation, actor, { body, eventId = null }) {
  if (!canAccessConversation(actor, conversation)) return null;

  const message = await create('mailMessages', {
    organizationId: organizationOf(conversation),
    conversationId: conversation.id,
    senderId: actor.id,
    body: String(body ?? '').slice(0, 2_000),
    replyToId: null,
    mentionIds: [],
    eventId,
    editedAt: null,
    deletedAt: null,
  });

  const store = await getStore();
  const preview = message.body.slice(0, 240);
  const updated = await store.update('mailConversations', conversation.id, {
    lastMessageAt: message.createdAt,
    lastMessagePreview: preview,
    lastSenderId: actor.id,
  });
  const ownMembership = await ensureMembership(conversation, actor.id);
  await store.update('mailMemberships', ownMembership.id, { lastReadAt: message.createdAt });

  for (const user of await audienceForConversation(conversation)) {
    if (user.id === actor.id) continue;
    publishMail(user.id, conversation.id, message.id);
    await notifyConversationMessage(user, actor, updated ?? conversation, preview);
  }
  publishMail(actor.id, conversation.id, message.id);

  return message;
}
