/**
 * The owner's side of a booking page: publishing it, and seeing who took an
 * hour.
 *
 * Behind `calendar.booking`, which no role grants — see `shared/permissions.js`
 * for why. Everything here is scoped to the caller's own page: there is no
 * endpoint that reads or edits somebody else's, not even for an administrator,
 * because an admin quietly republishing an employee's availability is not a
 * workspace problem anybody has.
 */

import { Router } from 'express';
import { create, findOne, getStore } from '../store.js';
import { logActivity, requireAuth, requirePermission } from '../auth.js';
import { organizationOf } from '../../shared/organization.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import {
  BUFFER_CHOICES,
  HORIZON_CHOICES,
  NOTICE_CHOICES,
  SLOT_DURATIONS,
  WEEKDAYS,
} from '../../shared/booking.js';
import {
  BookingError,
  MAX_SLUG,
  MIN_SLUG,
  bookingsForUser,
  cancelBooking,
  normalisePageInput,
  ownerBookingPage,
  pageBySlug,
  pageForUser,
  publicBooking,
  publicOrigin,
  serialiseBooking,
  slugFrom,
  validateSlug,
} from '../booking.js';

const router = Router();
router.use(requireAuth, requirePermission(PERMISSIONS.BOOKING_MANAGE));

function fail(res, error) {
  if (error instanceof BookingError) {
    return res.status(error.status).json({ error: error.code, ...error.extra });
  }
  console.error('[booking-admin]', error);
  return res.status(500).json({ error: 'server_error' });
}

router.get('/', async (req, res) => {
  const page = await pageForUser(req.user.id);
  res.json({
    page: page ? ownerBookingPage(page) : null,
    origin: publicOrigin(),
    options: {
      durations: SLOT_DURATIONS,
      buffers: BUFFER_CHOICES,
      notices: NOTICE_CHOICES,
      horizons: HORIZON_CHOICES,
      weekdays: WEEKDAYS,
      slug: { min: MIN_SLUG, max: MAX_SLUG },
    },
  });
});

/**
 * Create-or-update, because a person has at most one booking page and asking
 * the client to know which verb applies is asking it to track state the server
 * already holds.
 *
 * Serialised for the same reason booking is: two saves claiming one slug would
 * both pass a uniqueness check written the obvious way.
 */
router.put('/', async (req, res) => {
  try {
    const result = await serialiseBooking(async () => {
      const current = await pageForUser(req.user.id);
      const input = normalisePageInput(req.body, { current, owner: req.user });

      let slug = current?.slug ?? slugFrom(req.user.name);
      if (req.body?.slug !== undefined && String(req.body.slug).trim()) {
        const wanted = validateSlug(req.body.slug);
        if (!wanted) throw new BookingError('invalid_slug');
        const taken = await pageBySlug(wanted);
        if (taken && taken.userId !== req.user.id) throw new BookingError('slug_taken', 409);
        slug = wanted;
      }

      const store = await getStore();
      if (current) {
        return store.update('bookingPages', current.id, { ...input, slug });
      }
      return create('bookingPages', {
        ...input,
        slug,
        organizationId: organizationOf(req.user),
        userId: req.user.id,
      });
    });

    await logActivity({
      actorId: req.user.id,
      action: 'booking.page.save',
      subject: 'bookingPage',
      subjectId: result.id,
      meta: { active: result.active },
    });
    res.json({ page: ownerBookingPage(result), origin: publicOrigin() });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/bookings', async (req, res) => {
  const rows = await bookingsForUser(req.user.id, {
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
  });
  res.json({ bookings: rows.map(publicBooking) });
});

router.post('/bookings/:id/cancel', async (req, res) => {
  const booking = await findOne('bookings', (row) => row.id === req.params.id);
  // Somebody else's booking is not "forbidden", it is not theirs to know about.
  if (!booking || booking.userId !== req.user.id) return res.status(404).json({ error: 'not_found' });

  const page = await findOne('bookingPages', (row) => row.id === booking.pageId);
  const updated = await cancelBooking(booking, { by: 'owner', owner: req.user, page });
  await logActivity({
    actorId: req.user.id,
    action: 'booking.cancel',
    subject: 'booking',
    subjectId: booking.id,
    meta: {},
  });
  res.json({ booking: publicBooking(updated) });
});

export default router;
