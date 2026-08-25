/**
 * The seating plan's HTTP surface.
 *
 * Reading is open to every signed-in member, like Qodo Mail and Qodo Calendar:
 * "which desk is she at" is a question the whole workspace has a reason to ask,
 * and a plan behind a permission is a plan nobody consults. Everything that
 * moves a person or a desk is behind `offices.manage`, which belongs to no role
 * and is granted one person at a time.
 */

import { Router } from 'express';
import { getStore } from '../store.js';
import { logActivity, requireAuth, requirePermission } from '../auth.js';
import { PERMISSIONS, can } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { DEPARTMENTS } from '../../shared/departments.js';
import {
  OFFICE_KINDS,
  OFFICE_KIND_LABELS,
  SEAT_STATE_LABELS,
  SETTABLE_SEAT_STATES,
} from '../../shared/offices.js';
import {
  MAX_SEATS_PER_OFFICE,
  MAX_SEATS_PER_REQUEST,
  OfficeError,
  addSeats,
  createOffice,
  normaliseOfficeInput,
  officeFor,
  readPlan,
  removeOffice,
  removeSeat,
  seatFor,
  seatOfUser,
  updateSeat,
} from '../offices.js';

const router = Router();
router.use(requireAuth);

const manage = requirePermission(PERMISSIONS.OFFICES_MANAGE);

function fail(res, error) {
  if (error instanceof OfficeError) {
    return res.status(error.status).json({ error: error.code, ...error.extra });
  }
  console.error('[offices]', error);
  return res.status(500).json({ error: 'server_error' });
}

/* ── reads ───────────────────────────────────────────────────────────── */

/** What the page needs once, on open, that never changes between requests. */
router.get('/bootstrap', (req, res) => {
  res.json({
    kinds: OFFICE_KINDS.map((id) => ({ id, ...OFFICE_KIND_LABELS[id] })),
    seatStates: Object.entries(SEAT_STATE_LABELS).map(([id, labels]) => ({ id, ...labels })),
    settableStates: SETTABLE_SEAT_STATES,
    departments: DEPARTMENTS.map((department) => ({
      id: department.id,
      ar: department.ar,
      en: department.en,
      color: department.color,
    })),
    limits: { seatsPerOffice: MAX_SEATS_PER_OFFICE, seatsPerRequest: MAX_SEATS_PER_REQUEST },
    canManage: can(req.user, PERMISSIONS.OFFICES_MANAGE),
  });
});

router.get('/', async (req, res) => {
  try {
    res.json(await readPlan(req.user));
  } catch (error) {
    fail(res, error);
  }
});

/** Where the signed-in person sits — the launcher card reads this. */
router.get('/me', async (req, res) => {
  try {
    res.json(await seatOfUser(organizationOf(req.user), req.user.id));
  } catch (error) {
    fail(res, error);
  }
});

/* ── rooms ───────────────────────────────────────────────────────────── */

router.post('/', manage, async (req, res) => {
  try {
    const office = await createOffice(req.user, req.body);
    const seats = Number(req.body?.seats);
    if (Number.isFinite(seats) && seats > 0) await addSeats(office, seats);

    await logActivity({
      actorId: req.user.id,
      organizationId: organizationOf(req.user),
      action: 'office.create',
      subject: 'office',
      subjectId: office.id,
      meta: { name: office.nameAr, zone: office.zone },
    });
    res.status(201).json(await readPlan(req.user));
  } catch (error) {
    fail(res, error);
  }
});

router.patch('/:officeId', manage, async (req, res) => {
  try {
    const office = await officeFor(req.user, req.params.officeId);
    const patch = normaliseOfficeInput(req.body, { partial: true });
    const store = await getStore();
    const updated = await store.update('offices', office.id, patch);

    await logActivity({
      actorId: req.user.id,
      organizationId: organizationOf(req.user),
      action: 'office.update',
      subject: 'office',
      subjectId: office.id,
      // Measuring a room is the change worth being able to find again later.
      meta: { name: updated.nameAr, measured: Boolean(updated.dimensions) },
    });
    res.json(await readPlan(req.user));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/:officeId', manage, async (req, res) => {
  try {
    const office = await officeFor(req.user, req.params.officeId);
    const removed = await removeOffice(office);

    await logActivity({
      actorId: req.user.id,
      organizationId: organizationOf(req.user),
      action: 'office.delete',
      subject: 'office',
      subjectId: office.id,
      meta: { name: office.nameAr, seats: removed },
    });
    res.json(await readPlan(req.user));
  } catch (error) {
    fail(res, error);
  }
});

/* ── seats ───────────────────────────────────────────────────────────── */

router.post('/:officeId/seats', manage, async (req, res) => {
  try {
    const office = await officeFor(req.user, req.params.officeId);
    const created = await addSeats(office, req.body?.count ?? 1);

    await logActivity({
      actorId: req.user.id,
      organizationId: organizationOf(req.user),
      action: 'office.seats.add',
      subject: 'office',
      subjectId: office.id,
      meta: { name: office.nameAr, added: created.length },
    });
    res.status(201).json(await readPlan(req.user));
  } catch (error) {
    fail(res, error);
  }
});

router.patch('/:officeId/seats/:seatId', manage, async (req, res) => {
  try {
    const office = await officeFor(req.user, req.params.officeId);
    const seat = await seatFor(office, req.params.seatId);
    const { events } = await updateSeat({ office, seat, body: req.body, actor: req.user });

    // One log line per seat touched, including the desk somebody was moved off
    // — otherwise the record shows an arrival with no matching departure.
    for (const event of events) {
      await logActivity({
        actorId: req.user.id,
        organizationId: organizationOf(req.user),
        action: event.action,
        subject: 'officeSeat',
        subjectId: event.seatId,
        meta: { officeId: event.officeId, officeName: office.nameAr },
      });
    }
    res.json(await readPlan(req.user));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/:officeId/seats/:seatId', manage, async (req, res) => {
  try {
    const office = await officeFor(req.user, req.params.officeId);
    const seat = await seatFor(office, req.params.seatId);
    await removeSeat(seat);

    await logActivity({
      actorId: req.user.id,
      organizationId: organizationOf(req.user),
      action: 'office.seat.remove',
      subject: 'officeSeat',
      subjectId: seat.id,
      meta: { officeId: office.id, officeName: office.nameAr, label: seat.label },
    });
    res.json(await readPlan(req.user));
  } catch (error) {
    fail(res, error);
  }
});

export default router;
