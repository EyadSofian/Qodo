/**
 * Qodo Calendar's HTTP surface.
 *
 * Open to every signed-in member of the organization, like Qodo Mail and unlike
 * the management desk: a calendar that only managers may put an entry in is a
 * calendar the rest of the workspace has no reason to open. What an entry
 * *reaches* is decided per entry by its visibility and its invite list, which
 * is checked on every read in `calendarAccess.js` rather than here.
 */

import { Router } from 'express';
import { create, find, findOne, getStore } from '../store.js';
import { logActivity, requireAuth } from '../auth.js';
import { organizationOf } from '../../shared/organization.js';
import {
  CALENDAR_KINDS,
  CALENDAR_VISIBILITIES,
  INVITE_RESPONSES,
  activeOrganizationUsers,
  canAccessEvent,
  canManageEvent,
  canRespondToEvent,
  ensureInvite,
  invitesForEvent,
  isCancelled,
  participantIds,
} from '../calendarAccess.js';
import {
  CalendarError,
  MAX_INVITEES,
  REMINDER_CHOICES,
  announceEvent,
  announceResponse,
  busyForUsers,
  eventsInRange,
  normaliseEventInput,
  normaliseRange,
  publicEvent,
  whenLabel,
} from '../calendar.js';
import { canAccessConversation } from '../mailAccess.js';
import { postConversationNotice } from '../mailNotice.js';
import calendarFiles, { MAX_EVENT_FILES } from './calendarFiles.js';

const router = Router();
router.use(requireAuth);
router.use('/events/:eventId/files', calendarFiles);

function fail(res, error) {
  if (error instanceof CalendarError) {
    return res.status(error.status).json({ error: error.code, ...error.extra });
  }
  console.error('[calendar]', error);
  return res.status(500).json({ error: 'server_error' });
}

function publicPerson(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    title: user.title ?? null,
    department: user.department ?? 'general',
    avatarColor: user.avatarColor ?? '#1D6FB8',
    role: user.role,
  };
}

/** One event, dressed for the client, with its invites and file count. */
async function present(event, user) {
  const attachments = await find('calendarAttachments', (row) => row.eventId === event.id);
  return publicEvent(event, {
    invites: await invitesForEvent(event.id),
    user,
    attachmentCount: attachments.length,
  });
}

/* ── bootstrap ───────────────────────────────────────────────────── */

router.get('/bootstrap', async (req, res) => {
  const users = await activeOrganizationUsers(organizationOf(req.user));
  res.json({
    people: users
      .map(publicPerson)
      .sort((left, right) => left.name.localeCompare(right.name, 'ar')),
    kinds: CALENDAR_KINDS,
    visibilities: CALENDAR_VISIBILITIES,
    reminderChoices: REMINDER_CHOICES,
    limits: { invitees: MAX_INVITEES, files: MAX_EVENT_FILES },
  });
});

/* ── reads ───────────────────────────────────────────────────────── */

router.get('/events', async (req, res) => {
  try {
    const range = normaliseRange(req.query.from, req.query.to);
    const rows = await eventsInRange(req.user, range);
    const events = [];
    for (const event of rows) events.push(await present(event, req.user));
    res.json({ events, ...range });
  } catch (error) {
    fail(res, error);
  }
});

/**
 * Taken hours for the people you are trying to get in a room, and nothing else
 * about them. `eventId` never leaves the server — see `busyForUsers`.
 *
 * `ignoreEventId` is what lets an organizer move their own meeting without the
 * form warning that the whole room is busy — with the entry they are editing.
 * It is honoured only for an entry this person actually organizes, so it cannot
 * be used to ask "does event X take these people's hour?" about somebody else's.
 */
router.get('/busy', async (req, res) => {
  try {
    const range = normaliseRange(req.query.from, req.query.to);
    const requested = String(req.query.userIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const users = await activeOrganizationUsers(organizationOf(req.user));
    const known = new Set(users.map((user) => user.id));
    const userIds = [...new Set([req.user.id, ...requested])].filter((id) => known.has(id));

    let ignoreEventId = null;
    if (req.query.ignoreEventId) {
      const own = await findOne('calendarEvents', (row) => row.id === req.query.ignoreEventId);
      if (own && canManageEvent(req.user, own)) ignoreEventId = own.id;
    }

    const blocks = await busyForUsers(organizationOf(req.user), userIds, range);
    res.json({
      busy: blocks
        .filter((block) => block.eventId !== ignoreEventId)
        .map(({ userId, startAt, endAt }) => ({ userId, startAt, endAt })),
      ...range,
    });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/events/:id', async (req, res) => {
  const event = await findOne('calendarEvents', (row) => row.id === req.params.id);
  if (!event || !canAccessEvent(req.user, event)) return res.status(404).json({ error: 'not_found' });
  res.json({ event: await present(event, req.user) });
});

/* ── writes ──────────────────────────────────────────────────────── */

router.post('/events', async (req, res) => {
  try {
    const organizationId = organizationOf(req.user);
    const users = await activeOrganizationUsers(organizationId);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const input = normaliseEventInput(req.body, { actor: req.user, usersById });

    // A meeting arranged from a thread keeps the thread: the card posted below
    // is what makes the two halves one conversation rather than two records.
    let conversation = null;
    if (req.body?.conversationId) {
      conversation = await findOne(
        'mailConversations',
        (row) => row.id === req.body.conversationId
      );
      if (!conversation || !canAccessConversation(req.user, conversation)) {
        throw new CalendarError('invalid_conversation', 400);
      }
    }

    const event = await create('calendarEvents', {
      ...input,
      organizationId,
      organizerId: req.user.id,
      conversationId: conversation?.id ?? null,
      status: 'confirmed',
      remindedAt: null,
      cancelledAt: null,
      createdBy: req.user.id,
    });

    for (const id of participantIds(event)) await ensureInvite(event, id);
    await announceEvent(event, req.user, 'invited');

    if (conversation) {
      await postConversationNotice(conversation, req.user, {
        body: `📅 ${event.kind === 'meeting' ? 'اجتماع' : 'موعد'}: ${event.title} — ${whenLabel(event)}`,
        eventId: event.id,
      });
    }

    await logActivity({
      actorId: req.user.id,
      action: 'calendar.event.create',
      subject: 'calendarEvent',
      subjectId: event.id,
      meta: { kind: event.kind, invitees: event.inviteeIds.length, fromMail: Boolean(conversation) },
    });

    res.status(201).json({ event: await present(event, req.user) });
  } catch (error) {
    fail(res, error);
  }
});

router.patch('/events/:id', async (req, res) => {
  try {
    const event = await findOne('calendarEvents', (row) => row.id === req.params.id);
    if (!event || !canAccessEvent(req.user, event)) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (!canManageEvent(req.user, event)) return res.status(403).json({ error: 'forbidden' });
    if (isCancelled(event)) return res.status(409).json({ error: 'event_cancelled' });

    const users = await activeOrganizationUsers(organizationOf(req.user));
    const usersById = new Map(users.map((user) => [user.id, user]));
    const input = normaliseEventInput(req.body, {
      actor: req.user,
      usersById,
      current: event,
    });

    const timeMoved = input.startAt !== event.startAt || input.endAt !== event.endAt;
    const store = await getStore();
    const updated = await store.update('calendarEvents', event.id, {
      ...input,
      // A moved entry is a new question for everybody who answered the old one,
      // so the reminder is armed again rather than counted as already sent.
      remindedAt: timeMoved ? null : event.remindedAt,
    });

    for (const id of participantIds(updated)) await ensureInvite(updated, id);
    // Somebody taken off the list keeps no answer on an entry they are no
    // longer part of.
    const stillIn = new Set(participantIds(updated));
    for (const invite of await invitesForEvent(updated.id)) {
      if (!stillIn.has(invite.userId)) await store.remove('calendarInvites', invite.id);
      else if (timeMoved && invite.userId !== updated.organizerId) {
        await store.update('calendarInvites', invite.id, {
          response: 'needs_action',
          respondedAt: null,
        });
      }
    }

    await announceEvent(updated, req.user, 'updated');
    await logActivity({
      actorId: req.user.id,
      action: 'calendar.event.update',
      subject: 'calendarEvent',
      subjectId: updated.id,
      meta: { timeMoved },
    });
    res.json({ event: await present(updated, req.user) });
  } catch (error) {
    fail(res, error);
  }
});

/**
 * Cancelling, not deleting.
 *
 * The people who arranged their morning around it are told, and the row stays
 * so that "was there a meeting on Tuesday?" has an answer. Removing it outright
 * would leave the thread's card pointing at nothing.
 */
router.delete('/events/:id', async (req, res) => {
  const event = await findOne('calendarEvents', (row) => row.id === req.params.id);
  if (!event || !canAccessEvent(req.user, event)) return res.status(404).json({ error: 'not_found' });
  if (!canManageEvent(req.user, event)) return res.status(403).json({ error: 'forbidden' });
  if (isCancelled(event)) return res.json({ event: await present(event, req.user) });

  const store = await getStore();
  const updated = await store.update('calendarEvents', event.id, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
  });
  await announceEvent(updated, req.user, 'cancelled');
  await logActivity({
    actorId: req.user.id,
    action: 'calendar.event.cancel',
    subject: 'calendarEvent',
    subjectId: updated.id,
    meta: { kind: updated.kind },
  });
  res.json({ event: await present(updated, req.user) });
});

router.post('/events/:id/respond', async (req, res) => {
  const event = await findOne('calendarEvents', (row) => row.id === req.params.id);
  if (!event || !canAccessEvent(req.user, event)) return res.status(404).json({ error: 'not_found' });
  if (!canRespondToEvent(req.user, event)) return res.status(403).json({ error: 'not_invited' });

  const response = String(req.body?.response || '');
  if (!INVITE_RESPONSES.includes(response) || response === 'needs_action') {
    return res.status(400).json({ error: 'invalid_response' });
  }

  const invite = await ensureInvite(event, req.user.id);
  const store = await getStore();
  await store.update('calendarInvites', invite.id, {
    response,
    respondedAt: new Date().toISOString(),
  });
  await announceResponse(event, req.user, response);
  res.json({ event: await present(event, req.user) });
});

export default router;
