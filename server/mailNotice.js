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

/** The bell, the badge and the phone — the one delivery every alert here uses. */
async function deliver(target, actor, conversation, { type, title, preview }) {
  const body = preview.slice(0, 180);
  const link = `/mail?conversation=${encodeURIComponent(conversation.id)}`;
  const notification = await create('notifications', {
    organizationId: organizationOf(target),
    userId: target.id,
    actorId: actor.id,
    type,
    title,
    body,
    link,
    read: false,
  });
  publishNotification(target.id, notification.id);
  await notifyUser(target.id, { title, body, link });
}

/** What to call the place a message landed, when telling somebody about it. */
function conversationLabel(conversation, lang) {
  const name = conversation.nameAr || conversation.nameEn || '';
  const named = conversation.subject || name;
  if (named) return named;
  return lang === 'en' ? 'a private chat' : 'محادثة خاصة';
}

export async function notifyConversationMessage(target, actor, conversation, preview) {
  if (!target || !isActiveUser(target)) return;
  const subject = conversation.subject || conversation.nameAr || conversation.nameEn || '';
  const title = {
    ar: conversation.kind === 'mail' ? `Qodo Mail: ${subject}` : `${actor.name} · ${subject}`,
    en: conversation.kind === 'mail' ? `Qodo Mail: ${subject}` : `${actor.name} · ${subject}`,
  };
  await deliver(target, actor, conversation, { type: 'mail.message', title, preview });
}

/**
 * Being named in a message, which is not the same event as the message.
 *
 * In a busy department channel an ordinary post is deliberately silent, so a
 * mention is the only way to reach one person in it; in a channel that is
 * already loud, it is the line that separates the message addressed to you from
 * the fifty that are not. It therefore carries its own type and its own wording
 * rather than borrowing `mail.message`, so the bell can say why it rang.
 *
 * Only somebody who can open the conversation is ever told. Naming a colleague
 * in a private thread they are not in is a reference for the people reading it,
 * not a summons: alerting them would announce both the existence of the thread
 * and a slice of what was said in it to somebody deliberately outside it, and
 * hand them a link that would refuse them anyway.
 */
export async function notifyConversationMention(target, actor, conversation, preview) {
  if (!target || !isActiveUser(target)) return;
  const title = {
    ar: `${actor.name} ذكرك في ${conversationLabel(conversation, 'ar')}`,
    en: `${actor.name} mentioned you in ${conversationLabel(conversation, 'en')}`,
  };
  await deliver(target, actor, conversation, { type: 'mail.mention', title, preview });
}

/**
 * The bell and the phone, for somebody just added to a private channel.
 *
 * Being added is not a message, so it deliberately does not post one: a channel
 * that announces every arrival into its own history buries the conversation it
 * exists for. The arrival is told directly, and the record of who did it lives
 * in the activity log.
 */
export async function notifyChannelMembership(target, actor, conversation) {
  if (!target || !isActiveUser(target)) return;
  const name = conversation.nameAr || conversation.nameEn || '';
  const title = {
    ar: `${actor.name} أضافك إلى ${name}`,
    en: `${actor.name} added you to ${name}`,
  };
  const body = conversation.descriptionAr || conversation.descriptionEn || '';
  const link = `/mail?conversation=${encodeURIComponent(conversation.id)}`;
  const notification = await create('notifications', {
    organizationId: organizationOf(target),
    userId: target.id,
    actorId: actor.id,
    type: 'mail.channel.member',
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
