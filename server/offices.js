/**
 * Seating — the rules that sit between the HTTP surface and the store.
 *
 * Three of them are worth naming here, because they are the ones the
 * spreadsheet this module replaces could not hold:
 *
 * 1. **No count is stored.** `officeCounts` derives them from the seats on
 *    every read. The inventory's ODOO row said four units were occupied and
 *    listed nobody; nothing in a spreadsheet stops those two from disagreeing,
 *    and nothing here lets them.
 *
 * 2. **One person, one desk.** Seating somebody vacates wherever they were
 *    sitting before, in the same write. «أحمد شعبان» appeared in three rooms in
 *    the inventory; for a linked account that is now impossible by construction.
 *    A typed name can still be duplicated — the plan cannot know two strings are
 *    the same human — which is exactly why linking accounts is worth doing.
 *
 * 3. **A room is measured or it isn't.** Dimensions and seat coordinates are
 *    optional, and the scaled plan is only offered once a room has both. A
 *    half-placed room drawn to scale reads as a room with missing desks.
 */

import { create, find, findOne, getStore } from './store.js';
import { organizationOf } from '../shared/organization.js';
import { DEPARTMENT_IDS } from '../shared/departments.js';
import { isActiveUser } from '../shared/permissions.js';
import {
  MAX_ROOM_METRES,
  MAX_SHAPE_POINTS,
  MIN_ROOM_METRES,
  MIN_SHAPE_POINTS,
  OFFICE_KINDS,
  SETTABLE_SEAT_STATES,
  isInsideRoom,
  isTaken,
  officeCounts,
  orderedSeats,
  planReadiness,
  seatLabelFor,
  seatState,
  summariseOffices,
} from '../shared/offices.js';

/** How many desks one room may hold. The largest real room today has 17. */
export const MAX_SEATS_PER_OFFICE = 120;
/** Adding desks in bulk is the normal case; this caps one request. */
export const MAX_SEATS_PER_REQUEST = 60;
export const MAX_NAME_LENGTH = 80;
export const MAX_NOTE_LENGTH = 400;

export class OfficeError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.name = 'OfficeError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const text = (value, max) => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/* ── reads ───────────────────────────────────────────────────────────── */

export async function officesOf(organizationId) {
  const rows = await find('offices', (row) => organizationOf(row) === organizationId);
  return rows.sort(
    (left, right) =>
      String(left.zone ?? '').localeCompare(String(right.zone ?? ''), 'ar') ||
      (left.order ?? 999) - (right.order ?? 999) ||
      String(left.nameAr ?? '').localeCompare(String(right.nameAr ?? ''), 'ar')
  );
}

export async function seatsOf(organizationId) {
  return find('officeSeats', (row) => organizationOf(row) === organizationId);
}

/** The one room this id names, or nothing — never another organization's. */
export async function officeFor(user, officeId) {
  const office = await findOne('offices', (row) => row.id === officeId);
  if (!office || organizationOf(office) !== organizationOf(user)) {
    throw new OfficeError('not_found', 404);
  }
  return office;
}

export async function seatFor(office, seatId) {
  const seat = await findOne('officeSeats', (row) => row.id === seatId);
  if (!seat || seat.officeId !== office.id) throw new OfficeError('not_found', 404);
  return seat;
}

/**
 * A room dressed for the client: its seats in layout order, its derived counts,
 * and how far it is from being drawable to scale.
 */
export function publicOffice(office, seats, people) {
  const mine = orderedSeats(seats.filter((seat) => seat.officeId === office.id));
  const dressed = mine.map((seat) => publicSeat(seat, people));
  // Counted from the stored rows, never from `dressed`: presentation renames
  // `status` to the already-derived `state`, so deriving a second time off the
  // dressed shape reads an absent field and silently calls every reserved desk
  // free. The store is the only thing that gets to answer "how many".
  const counts = officeCounts(mine);
  return {
    id: office.id,
    zone: office.zone,
    nameAr: office.nameAr,
    nameEn: office.nameEn ?? null,
    department: office.department ?? null,
    kind: office.kind ?? 'workroom',
    columns: office.columns ?? null,
    dimensions: office.dimensions ?? null,
    shape: office.shape ?? null,
    note: office.note ?? null,
    order: office.order ?? 999,
    seats: dressed,
    counts,
    plan: planReadiness({ ...office, seats: mine }),
    updatedAt: office.updatedAt ?? null,
  };
}

export function publicSeat(seat, people) {
  const person = seat.userId ? people.get(seat.userId) : null;
  return {
    id: seat.id,
    officeId: seat.officeId,
    label: seat.label,
    gridIndex: Number.isFinite(seat.gridIndex) ? seat.gridIndex : null,
    point: seat.point ?? null,
    state: seatState(seat),
    note: seat.note ?? null,
    userId: person ? seat.userId : null,
    // A linked account that has since been removed leaves the name it was
    // imported under rather than emptying the desk — the person may well still
    // be sitting there.
    occupantName: person?.name ?? seat.occupantName ?? null,
    occupant: person
      ? {
          id: person.id,
          name: person.name,
          title: person.title ?? null,
          department: person.department ?? 'general',
          avatarColor: person.avatarColor ?? '#1D6FB8',
        }
      : null,
  };
}

/** Everyone in this organization, indexed for seat presentation. */
export async function peopleIndex(organizationId) {
  const users = await find(
    'users',
    (user) => organizationOf(user) === organizationId && isActiveUser(user)
  );
  return new Map(users.map((user) => [user.id, user]));
}

/** The whole plan in one payload — what the page loads on open. */
export async function readPlan(user) {
  const organizationId = organizationOf(user);
  const [offices, seats, people] = await Promise.all([
    officesOf(organizationId),
    seatsOf(organizationId),
    peopleIndex(organizationId),
  ]);
  const dressed = offices.map((office) => publicOffice(office, seats, people));
  return {
    offices: dressed,
    zones: [...new Set(dressed.map((office) => office.zone))],
    summary: summariseOffices(dressed),
    // Names carried over from the inventory that never found an account. The
    // page lists them so somebody can link them, instead of leaving them to be
    // discovered one desk at a time.
    unlinked: dressed
      .flatMap((office) =>
        office.seats
          .filter((seat) => !seat.userId && seat.occupantName)
          .map((seat) => ({
            seatId: seat.id,
            officeId: office.id,
            officeName: office.nameAr,
            name: seat.occupantName,
          }))
      )
      .sort((left, right) => left.name.localeCompare(right.name, 'ar')),
  };
}

/** Where this person sits, if anywhere. Powers the launcher card. */
export async function seatOfUser(organizationId, userId) {
  const seat = await findOne(
    'officeSeats',
    (row) => organizationOf(row) === organizationId && row.userId === userId
  );
  if (!seat) return { office: null, seat: null };
  const office = await findOne('offices', (row) => row.id === seat.officeId);
  if (!office) return { office: null, seat: null };
  const people = await peopleIndex(organizationId);
  return { office: publicOffice(office, [seat], people), seat: publicSeat(seat, people) };
}

/* ── writes ──────────────────────────────────────────────────────────── */

export function normaliseOfficeInput(body, { partial = false, current = null } = {}) {
  const patch = {};

  if (body?.nameAr !== undefined || !partial) {
    const nameAr = text(body?.nameAr, MAX_NAME_LENGTH);
    if (!nameAr) throw new OfficeError('office_name_required');
    patch.nameAr = nameAr;
  }
  if (body?.nameEn !== undefined) patch.nameEn = text(body.nameEn, MAX_NAME_LENGTH);

  if (body?.zone !== undefined || !partial) {
    const zone = text(body?.zone, MAX_NAME_LENGTH);
    if (!zone) throw new OfficeError('office_zone_required');
    patch.zone = zone;
  }

  if (body?.department !== undefined) {
    const department = body.department === null ? null : String(body.department);
    if (department !== null && !DEPARTMENT_IDS.includes(department)) {
      throw new OfficeError('unknown_department');
    }
    patch.department = department;
  }

  if (body?.kind !== undefined) {
    if (!OFFICE_KINDS.includes(body.kind)) throw new OfficeError('unknown_kind');
    patch.kind = body.kind;
  }

  if (body?.columns !== undefined) {
    if (body.columns === null) patch.columns = null;
    else {
      const columns = Number(body.columns);
      if (!Number.isFinite(columns) || columns < 1 || columns > 24) {
        throw new OfficeError('invalid_columns');
      }
      patch.columns = Math.round(columns);
    }
  }

  if (body?.dimensions !== undefined) patch.dimensions = normaliseDimensions(body.dimensions);
  if (body?.shape !== undefined) {
    // Bounded by whichever size this request ends up with — the one it is
    // setting, or the one the room already has. Reshaping and measuring in a
    // single call must not be able to produce a polygon outside its own room.
    const size = patch.dimensions !== undefined ? patch.dimensions : current?.dimensions;
    patch.shape = normaliseShape(body.shape, size);
  }
  // An outline only means something inside a measured room; clearing the
  // measurement clears the drawing with it rather than leaving it orphaned.
  if (patch.dimensions === null && patch.shape === undefined) patch.shape = null;
  if (body?.note !== undefined) patch.note = text(body.note, MAX_NOTE_LENGTH);
  if (body?.order !== undefined) {
    const order = Number(body.order);
    patch.order = Number.isFinite(order) ? Math.round(order) : 999;
  }

  return patch;
}

/**
 * Room size in metres. `null` is a first-class answer and the default: most
 * rooms have not been measured, and inventing a size so the plan has something
 * to draw would be a drawing of a room nobody surveyed.
 */
export function normaliseDimensions(value) {
  if (value === null || value === undefined) return null;
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new OfficeError('invalid_dimensions');
  if (
    width < MIN_ROOM_METRES ||
    height < MIN_ROOM_METRES ||
    width > MAX_ROOM_METRES ||
    height > MAX_ROOM_METRES
  ) {
    throw new OfficeError('invalid_dimensions', 400, { min: MIN_ROOM_METRES, max: MAX_ROOM_METRES });
  }
  return { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 };
}

/**
 * The room's outline in metres, or `null` for an ordinary rectangle.
 *
 * Every corner is clamped into the bounding box rather than rejected: a corner
 * dragged a few centimetres past the wall is somebody drawing, not an error
 * worth throwing away their whole outline for.
 */
export function normaliseShape(value, sizeOverride) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new OfficeError('invalid_shape');
  if (value.length < MIN_SHAPE_POINTS || value.length > MAX_SHAPE_POINTS) {
    throw new OfficeError('invalid_shape', 400, {
      min: MIN_SHAPE_POINTS,
      max: MAX_SHAPE_POINTS,
    });
  }
  const size = sizeOverride;
  return value.map((point) => {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new OfficeError('invalid_shape');
    const clamp = (n, max) =>
      Math.round(Math.max(0, Number.isFinite(max) ? Math.min(n, max) : n) * 100) / 100;
    return { x: clamp(x, size?.width), y: clamp(y, size?.height) };
  });
}

/** A seat's spot on the scaled plan, checked against the room it belongs to. */
export function normalisePoint(value, office) {
  if (value === null || value === undefined) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new OfficeError('invalid_point');
  const size = office?.dimensions;
  if (!size) throw new OfficeError('room_not_measured', 409);
  const rounded = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  // The outline, not the bounding box: an L-shaped room has a corner inside its
  // rectangle that is not inside the room.
  if (!isInsideRoom(office, rounded)) {
    throw new OfficeError('point_outside_room', 400, { width: size.width, height: size.height });
  }
  return rounded;
}

export async function createOffice(user, body) {
  const patch = normaliseOfficeInput(body);
  const organizationId = organizationOf(user);
  const existing = await officesOf(organizationId);
  return create('offices', {
    organizationId,
    kind: 'workroom',
    department: null,
    columns: null,
    dimensions: null,
    shape: null,
    note: null,
    order: Math.max(0, ...existing.map((office) => office.order ?? 0)) + 10,
    ...patch,
  });
}

/**
 * Add desks to a room. Labels continue from whatever is already there, so the
 * numbering a manager reads on the plan matches the order they were added in.
 */
export async function addSeats(office, count) {
  const wanted = Number(count);
  if (!Number.isFinite(wanted) || wanted < 1) throw new OfficeError('invalid_count');
  if (wanted > MAX_SEATS_PER_REQUEST) {
    throw new OfficeError('too_many_seats', 400, { max: MAX_SEATS_PER_REQUEST });
  }

  const existing = await find('officeSeats', (row) => row.officeId === office.id);
  if (existing.length + wanted > MAX_SEATS_PER_OFFICE) {
    throw new OfficeError('office_full', 409, { max: MAX_SEATS_PER_OFFICE });
  }

  const nextIndex = existing.reduce(
    (highest, seat) => Math.max(highest, Number.isFinite(seat.gridIndex) ? seat.gridIndex + 1 : 0),
    0
  );

  const created = [];
  for (let step = 0; step < Math.round(wanted); step += 1) {
    const gridIndex = nextIndex + step;
    created.push(
      await create('officeSeats', {
        organizationId: organizationOf(office),
        officeId: office.id,
        label: seatLabelFor(gridIndex),
        gridIndex,
        point: null,
        status: 'free',
        userId: null,
        occupantName: null,
        note: null,
      })
    );
  }
  return created;
}

/**
 * Change one seat.
 *
 * The occupant half is the delicate one. `userId` and `occupantName` are two
 * ways of answering the same question, so setting either clears the other —
 * otherwise a desk ends up labelled with a name that is not the account sitting
 * on it. Passing `null` for both empties the desk.
 */
export async function updateSeat({ office, seat, body, actor }) {
  const store = await getStore();
  const patch = {};
  const events = [];

  if (body?.label !== undefined) {
    const label = text(body.label, 12);
    if (!label) throw new OfficeError('label_required');
    patch.label = label;
  }
  if (body?.note !== undefined) patch.note = text(body.note, MAX_NOTE_LENGTH);
  if (body?.gridIndex !== undefined) {
    const index = Number(body.gridIndex);
    if (!Number.isFinite(index) || index < 0) throw new OfficeError('invalid_grid_index');
    patch.gridIndex = Math.round(index);
  }
  if (body?.point !== undefined) patch.point = normalisePoint(body.point, office);

  if (body?.status !== undefined) {
    if (!SETTABLE_SEAT_STATES.includes(body.status)) throw new OfficeError('unknown_status');
    // `occupied` is not a state anybody sets — it is what having an occupant
    // means. Blocking a desk somebody is on would be a silent eviction.
    if (body.status === 'blocked' && isTaken({ ...seat, ...patch })) {
      throw new OfficeError('seat_occupied', 409);
    }
    patch.status = body.status;
  }

  const assigningUser = body?.userId !== undefined;
  const assigningName = body?.occupantName !== undefined;

  if (assigningUser || assigningName) {
    const nextUserId = assigningUser ? body.userId || null : null;
    const nextName = assigningName ? text(body.occupantName, MAX_NAME_LENGTH) : null;

    if (nextUserId && nextName) throw new OfficeError('one_occupant_only');

    const target = { ...seat, ...patch };
    if ((nextUserId || nextName) && seatState({ ...target, userId: null, occupantName: null }) === 'blocked') {
      throw new OfficeError('seat_blocked', 409);
    }

    if (nextUserId) {
      const person = await findOne('users', (row) => row.id === nextUserId);
      if (
        !person ||
        organizationOf(person) !== organizationOf(office) ||
        !isActiveUser(person)
      ) {
        throw new OfficeError('unknown_user', 404);
      }
      // One person, one desk — seating them here empties wherever they were.
      const previous = await find(
        'officeSeats',
        (row) =>
          row.userId === nextUserId &&
          row.id !== seat.id &&
          organizationOf(row) === organizationOf(office)
      );
      for (const old of previous) {
        await store.update('officeSeats', old.id, { userId: null, occupantName: null });
        events.push({ action: 'office.seat.vacate', seatId: old.id, officeId: old.officeId });
      }
    }

    patch.userId = nextUserId;
    patch.occupantName = nextUserId ? null : nextName;
    // Filling a reservation retires it; emptying a desk leaves it plainly free
    // unless this same request said otherwise.
    if (patch.status === undefined) patch.status = 'free';
  }

  const updated = await store.update('officeSeats', seat.id, patch);
  if (!updated) throw new OfficeError('not_found', 404);

  events.push({
    action: isTaken(updated) ? 'office.seat.assign' : 'office.seat.update',
    seatId: updated.id,
    officeId: office.id,
    actorId: actor?.id ?? null,
  });
  return { seat: updated, events };
}

/** A room may only be removed once nobody is sitting in it. */
export async function removeOffice(office) {
  const store = await getStore();
  const seats = await find('officeSeats', (row) => row.officeId === office.id);
  const taken = seats.filter(isTaken);
  if (taken.length) throw new OfficeError('office_occupied', 409, { occupied: taken.length });
  for (const seat of seats) await store.remove('officeSeats', seat.id);
  await store.remove('offices', office.id);
  return seats.length;
}

export async function removeSeat(seat) {
  if (isTaken(seat)) throw new OfficeError('seat_occupied', 409);
  const store = await getStore();
  await store.remove('officeSeats', seat.id);
}
