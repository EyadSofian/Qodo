import { create, find, findOne, getStore } from './store.js';
import { DEPARTMENTS } from '../shared/departments.js';
import { isActiveUser } from '../shared/permissions.js';
import { organizationOf } from '../shared/organization.js';

export const MAIL_KINDS = ['channel', 'direct', 'mail'];
export const CHANNEL_SCOPES = ['public', 'department', 'private'];

export function canAccessConversation(user, conversation) {
  if (!user || !conversation || conversation.archivedAt) return false;
  if (organizationOf(user) !== organizationOf(conversation)) return false;

  if (conversation.kind === 'direct' || conversation.kind === 'mail') {
    return (conversation.memberIds ?? []).includes(user.id);
  }

  // `memberIds` is the whole roster of a private channel and the guest list of
  // the other two — the person from another department who was invited in by
  // hand. Either one is access, so the written list is read before the scope.
  if ((conversation.memberIds ?? []).includes(user.id)) return true;
  if (conversation.scope === 'private') return false;
  if (conversation.scope === 'public') return true;
  if (conversation.scope === 'department') {
    return user.role === 'admin' || user.department === conversation.department;
  }
  return false;
}

/**
 * Whether the channel already holds this person without anybody adding them.
 *
 * A derived member has no roster row to delete — their department is what
 * grants the access — so this is the line between "remove from the channel" and
 * "move their department on the Team screen".
 */
export function isDerivedMember(user, conversation) {
  if (!user || conversation?.kind !== 'channel') return false;
  if (conversation.scope === 'public') return true;
  if (conversation.scope === 'department') return user.department === conversation.department;
  return false;
}

export function canManageConversation(user, conversation) {
  if (!canAccessConversation(user, conversation) || conversation.kind !== 'channel') return false;
  if (user.role === 'admin' || conversation.createdBy === user.id) return true;
  return user.role === 'manager' && conversation.department === user.department;
}

export function canPostToConversation(user, conversation) {
  if (!canAccessConversation(user, conversation)) return false;
  if (!conversation.announcementOnly) return true;
  return canManageConversation(user, conversation);
}

export async function activeOrganizationUsers(organizationId) {
  return find(
    'users',
    (user) => isActiveUser(user) && organizationOf(user) === organizationOf({ organizationId })
  );
}

export async function audienceForConversation(conversation) {
  const users = await activeOrganizationUsers(organizationOf(conversation));
  return users.filter((user) => canAccessConversation(user, conversation));
}

export async function ensureMembership(conversation, userId, { unreadFromStart = false } = {}) {
  const id = `${conversation.id}:${userId}`;
  const existing = await findOne('mailMemberships', (row) => row.id === id);
  if (existing) return existing;
  return create('mailMemberships', {
    id,
    organizationId: organizationOf(conversation),
    conversationId: conversation.id,
    userId,
    lastReadAt: unreadFromStart ? null : new Date().toISOString(),
    muted: false,
    archivedAt: null,
  });
}

/** Stable built-in ids make this idempotent for both JSON and Postgres stores. */
export async function ensureDefaultConversations(organizationId) {
  const store = await getStore();
  const defaults = [
    {
      id: `mail:${organizationId}:announcements`,
      organizationId,
      kind: 'channel',
      scope: 'public',
      nameAr: 'إعلانات الشركة',
      nameEn: 'Company announcements',
      descriptionAr: 'القرارات والتنبيهات التي تهم كل الشركة.',
      descriptionEn: 'Company-wide decisions and important updates.',
      department: null,
      memberIds: [],
      announcementOnly: true,
      builtin: true,
      createdBy: null,
      lastMessageAt: null,
      lastMessagePreview: '',
      lastSenderId: null,
      archivedAt: null,
    },
    ...DEPARTMENTS.map((department) => ({
      id: `mail:${organizationId}:department:${department.id}`,
      organizationId,
      kind: 'channel',
      scope: 'department',
      nameAr: department.ar,
      nameEn: department.en,
      descriptionAr: `مساحة عمل قسم ${department.ar}.`,
      descriptionEn: `${department.en} team workspace.`,
      department: department.id,
      memberIds: [],
      announcementOnly: false,
      builtin: true,
      createdBy: null,
      lastMessageAt: null,
      lastMessagePreview: '',
      lastSenderId: null,
      archivedAt: null,
    })),
  ];

  for (const conversation of defaults) {
    if (!(await store.get('mailConversations', conversation.id))) {
      await create('mailConversations', conversation);
    }
  }
}
