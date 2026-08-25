/**
 * Offices and seating — the single definition, imported by the Express API and
 * by the React page.
 *
 * The module exists because the inventory arrived as a spreadsheet whose three
 * columns — units, occupied, available — were kept in step by hand, and one row
 * already disagreed with itself: ODOO counted four occupied units and listed no
 * names. So nothing here stores a count. A room's numbers are derived from its
 * seats every time they are asked for, which is why they cannot drift.
 *
 * The same reasoning shapes the seat: `status` records only what is true when
 * *nobody* is on it. Whether a seat is occupied is not a field anybody sets —
 * it is whether the seat carries an occupant. A stored `occupied` flag beside a
 * stored occupant is exactly the pair the spreadsheet let contradict itself.
 */

/**
 * Where a seat stands. Only three of these are ever stored; `occupied` is
 * always derived, never written.
 *
 * `reserved` is the "موظف جديد" written into the IT room's name column — a desk
 * held for somebody who has not arrived. Recording that as an occupant would
 * invent a person; recording it as free would let it be given away.
 *
 * `blocked` is a desk that physically exists but cannot be sat at.
 */
export const SEAT_STATES = ['occupied', 'free', 'reserved', 'blocked'];

/** The states an administrator may actually write. */
export const SETTABLE_SEAT_STATES = ['free', 'reserved', 'blocked'];

export const SEAT_STATE_LABELS = {
  occupied: { ar: 'مشغولة', en: 'Occupied' },
  free: { ar: 'متاحة', en: 'Available' },
  reserved: { ar: 'محجوزة', en: 'Reserved' },
  blocked: { ar: 'غير صالحة', en: 'Out of use' },
};

/**
 * What a room is for. `meeting` and `prayer` rooms hold no desks, so they are
 * kept out of every occupancy figure — the inventory's «اجتماعات» row carried
 * zero units and the word «مصلي», and folding that into a percentage would
 * understate how full the workrooms actually are.
 */
export const OFFICE_KINDS = ['workroom', 'meeting', 'prayer', 'other'];

export const OFFICE_KIND_LABELS = {
  workroom: { ar: 'غرفة عمل', en: 'Work room' },
  meeting: { ar: 'غرفة اجتماعات', en: 'Meeting room' },
  prayer: { ar: 'مصلّى', en: 'Prayer room' },
  other: { ar: 'أخرى', en: 'Other' },
};

/** Only work rooms have desks to count. */
export function countsTowardsOccupancy(office) {
  return (office?.kind ?? 'workroom') === 'workroom';
}

/* ── seats ───────────────────────────────────────────────────────────── */

/** Whether anybody — a linked account or a plain name — is on this seat. */
export function isTaken(seat) {
  return Boolean(seat?.userId || seat?.occupantName);
}

/**
 * The seat's real state.
 *
 * An occupant always wins over the stored status, so a reservation that gets
 * filled reads as occupied without a second write. `blocked` is the one thing
 * an occupant may not override, and the API refuses to seat anybody there
 * rather than silently resolving it here.
 */
export function seatState(seat) {
  if (isTaken(seat)) return 'occupied';
  const stored = seat?.status;
  return SETTABLE_SEAT_STATES.includes(stored) ? stored : 'free';
}

/**
 * How a seat names its occupant. A linked account is preferred over the typed
 * name so that renaming a person in the directory renames them on the plan.
 */
export function occupantLabel(seat, userById) {
  if (seat?.userId) return userById?.(seat.userId)?.name ?? seat.occupantName ?? null;
  return seat?.occupantName ?? null;
}

/* ── counts ──────────────────────────────────────────────────────────── */

/**
 * A room's numbers, as a strict partition: every seat lands in exactly one
 * bucket and the four always add back up to `units`. That is the property the
 * spreadsheet could not hold, and the reason none of these is a stored field.
 */
export function officeCounts(seats = []) {
  const counts = { units: seats.length, occupied: 0, free: 0, reserved: 0, blocked: 0 };
  for (const seat of seats) counts[seatState(seat)] += 1;
  return counts;
}

/** The same partition across many rooms, plus the percentage people ask for. */
export function summariseOffices(offices = []) {
  const total = { units: 0, occupied: 0, free: 0, reserved: 0, blocked: 0, rooms: 0 };
  for (const office of offices) {
    if (!countsTowardsOccupancy(office)) continue;
    const counts = office.counts ?? officeCounts(office.seats);
    total.rooms += 1;
    for (const key of ['units', 'occupied', 'free', 'reserved', 'blocked']) {
      total[key] += counts[key] ?? 0;
    }
  }
  return {
    ...total,
    // A room with no desks would otherwise report 100% full.
    occupancyPercent: total.units ? Math.round((total.occupied / total.units) * 100) : 0,
  };
}

/* ── layout ──────────────────────────────────────────────────────────── */

/**
 * Two layouts over one set of seats, because the inventory answers "who sits
 * where" long before anybody has measured a room.
 *
 * `grid` is the schematic: seats wrap into `columns`, ordered by `gridIndex`.
 * It needs nothing but the seats themselves, so it works from day one.
 *
 * `plan` is the room drawn to scale, and needs two things the schematic does
 * not: the room's `dimensions` in metres, and a `point` on every seat. A room
 * that has them renders as a real floor plan; a room that doesn't falls back to
 * the schematic instead of rendering an empty rectangle.
 */
export const OFFICE_LAYOUTS = ['grid', 'plan'];

export const MIN_ROOM_METRES = 1;
export const MAX_ROOM_METRES = 60;

export function hasDimensions(office) {
  const size = office?.dimensions;
  return Boolean(
    size &&
      Number.isFinite(size.width) &&
      Number.isFinite(size.height) &&
      size.width >= MIN_ROOM_METRES &&
      size.height >= MIN_ROOM_METRES
  );
}

/** A seat is placed when it carries a point inside the room it belongs to. */
export function isPlaced(seat) {
  const point = seat?.point;
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

/**
 * Whether the scaled plan can honestly be drawn for this room: it must be
 * measured, and every seat must have been put somewhere. A half-placed room
 * drawn to scale is worse than the schematic, because the desks that are
 * missing look like desks that don't exist.
 */
export function canDrawPlan(office) {
  if (!hasDimensions(office)) return false;
  const seats = office.seats ?? [];
  return seats.length > 0 && seats.every(isPlaced);
}

/** What is still needed before this room can be drawn to scale. */
export function planReadiness(office) {
  const seats = office?.seats ?? [];
  const placed = seats.filter(isPlaced).length;
  return {
    measured: hasDimensions(office),
    placed,
    total: seats.length,
    ready: canDrawPlan(office),
  };
}

/** Columns for the schematic, kept sane whatever is stored on the room. */
export function gridColumns(office) {
  const stored = Number(office?.columns);
  if (Number.isFinite(stored) && stored >= 1 && stored <= 24) return Math.round(stored);
  // Roughly square, which keeps a 17-desk room from becoming a single long line.
  const units = office?.seats?.length ?? 0;
  return Math.max(1, Math.min(8, Math.ceil(Math.sqrt(units || 1))));
}

/** Seats in the order the schematic lays them out. */
export function orderedSeats(seats = []) {
  return [...seats].sort((left, right) => {
    const a = Number.isFinite(left.gridIndex) ? left.gridIndex : Number.MAX_SAFE_INTEGER;
    const b = Number.isFinite(right.gridIndex) ? right.gridIndex : Number.MAX_SAFE_INTEGER;
    if (a !== b) return a - b;
    return String(left.label ?? '').localeCompare(String(right.label ?? ''), 'ar');
  });
}

/** `A1`, `A2`, … — short enough to sit inside a 26px square. */
export function seatLabelFor(index) {
  const row = String.fromCharCode(65 + Math.floor(index / 12));
  return `${row}${(index % 12) + 1}`;
}
