/**
 * The public half of client booking — the only router in this app mounted
 * outside `requireAuth`.
 *
 * Because of that, every handler here is written as though the caller is
 * hostile, and the rules are narrow enough to state in full:
 *
 * - Nothing identifies an employee beyond the display name and job title the
 *   owner chose to publish. No user id, no email address, no department.
 * - A slug that is not a published page and a slug that does not exist give the
 *   same answer, so the endpoint cannot be used to test whether a person works
 *   here.
 * - Free time comes from `busyForUsers`, which carries no titles, so "that hour
 *   is gone" never leaks what took it.
 * - Every route is throttled per address, on the same reasoning as the invite
 *   links: the point is not brute force, it is that one script cannot fill an
 *   employee's week with appointments that were never real.
 */

import { Router } from 'express';
import { findOne } from '../store.js';
import { isActiveUser, PERMISSIONS, can } from '../../shared/permissions.js';
import {
  BookingError,
  bookSlot,
  cancelBooking,
  normaliseClientInput,
  normaliseSlotRange,
  ownerOf,
  pageBySlug,
  publicBookingPage,
  serialiseBooking,
  slotsForPage,
} from '../booking.js';

const router = Router();

const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const READ_MAX = 120;
const WRITE_MAX = 8;

function throttled(req, limit) {
  const key = `${req.ip}:${limit}`;
  const entry = hits.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    hits.set(key, { count: 1, first: Date.now() });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

function fail(res, error) {
  if (error instanceof BookingError) {
    return res.status(error.status).json({ error: error.code, ...error.extra });
  }
  console.error('[booking]', error);
  return res.status(500).json({ error: 'server_error' });
}

/**
 * Resolves a slug to a page that may actually be booked.
 *
 * The owner is re-checked on every request rather than trusted from the page
 * document: somebody who left the company, was disabled, or had
 * `calendar.booking` taken away must stop being bookable immediately, without
 * anybody remembering to go and unpublish their page.
 */
async function livePage(slug) {
  const page = await pageBySlug(String(slug ?? '').toLowerCase());
  if (!page || !page.active) return null;
  const owner = await ownerOf(page);
  if (!owner || !isActiveUser(owner)) return null;
  if (!can(owner, PERMISSIONS.BOOKING_MANAGE)) return null;
  return { page, owner };
}

router.get('/:slug', async (req, res) => {
  if (throttled(req, READ_MAX)) return res.status(429).json({ error: 'too_many_attempts' });
  const live = await livePage(req.params.slug);
  if (!live) return res.status(404).json({ error: 'not_found' });
  res.json({ page: publicBookingPage(live.page, live.owner) });
});

router.get('/:slug/slots', async (req, res) => {
  if (throttled(req, READ_MAX)) return res.status(429).json({ error: 'too_many_attempts' });
  const live = await livePage(req.params.slug);
  if (!live) return res.status(404).json({ error: 'not_found' });
  try {
    const range = normaliseSlotRange(req.query.from, req.query.to, live.page);
    res.json({ slots: await slotsForPage(live.page, range), ...range });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/:slug/book', async (req, res) => {
  if (throttled(req, WRITE_MAX)) return res.status(429).json({ error: 'too_many_attempts' });
  const live = await livePage(req.params.slug);
  if (!live) return res.status(404).json({ error: 'not_found' });

  try {
    const client = normaliseClientInput(req.body);
    const startAt = new Date(String(req.body?.startAt ?? ''));
    const endAt = new Date(String(req.body?.endAt ?? ''));
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BookingError('invalid_slot');
    }

    // The availability re-check lives inside the lock, in `bookSlot`: checking
    // out here would be checking a fact that can change before the write.
    const { booking } = await serialiseBooking(() =>
      bookSlot(live.page, live.owner, {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        client,
      })
    );

    res.status(201).json({
      booking: {
        startAt: booking.startAt,
        endAt: booking.endAt,
        clientName: booking.clientName,
        // Handed back once, so the page can show a cancel link even where no
        // email was configured to carry one.
        manageToken: booking.manageToken,
      },
    });
  } catch (error) {
    fail(res, error);
  }
});

/* ── the client's own appointment ────────────────────────────────── */

async function bookingByToken(token) {
  const value = String(token ?? '');
  if (value.length < 20) return null;
  return findOne('bookings', (row) => row.manageToken === value);
}

router.get('/manage/:token', async (req, res) => {
  if (throttled(req, READ_MAX)) return res.status(429).json({ error: 'too_many_attempts' });
  const booking = await bookingByToken(req.params.token);
  if (!booking) return res.status(404).json({ error: 'not_found' });

  const page = await findOne('bookingPages', (row) => row.id === booking.pageId);
  const owner = await findOne('users', (row) => row.id === booking.userId);
  res.json({
    booking: {
      startAt: booking.startAt,
      endAt: booking.endAt,
      status: booking.status,
      clientName: booking.clientName,
      cancelledBy: booking.cancelledBy ?? null,
    },
    page: page && owner ? publicBookingPage(page, owner) : null,
  });
});

router.post('/manage/:token/cancel', async (req, res) => {
  if (throttled(req, WRITE_MAX)) return res.status(429).json({ error: 'too_many_attempts' });
  const booking = await bookingByToken(req.params.token);
  if (!booking) return res.status(404).json({ error: 'not_found' });

  const owner = await findOne('users', (row) => row.id === booking.userId);
  const updated = await cancelBooking(booking, { by: 'client', owner });
  res.json({ booking: { startAt: updated.startAt, status: updated.status } });
});

export default router;
