/**
 * The seating plan's client half — row shapes and the API.
 *
 * The derivation rules live in `shared/offices.js` and are imported from there
 * rather than restated: a page that decided for itself what "available" means
 * would be the second place the number could be wrong, which is the whole
 * problem this module was built to end.
 */

import { api } from './api';

export type SeatState = 'occupied' | 'free' | 'reserved' | 'blocked';
export type OfficeKind = 'workroom' | 'meeting' | 'prayer' | 'other';
/** How a room is drawn: the schematic grid, the room to scale, or in 3D. */
export type OfficeLayout = 'grid' | 'plan' | 'space';
export type ShapePreset = 'rectangle' | 'l_shape' | 'l_mirror' | 't_shape';

export interface Point {
  x: number;
  y: number;
}

export interface SeatOccupant {
  id: string;
  name: string;
  title: string | null;
  department: string;
  avatarColor: string;
}

export interface OfficeSeat {
  id: string;
  officeId: string;
  label: string;
  gridIndex: number | null;
  /** Metres from the room's start corner. Null until somebody places it. */
  point: Point | null;
  state: SeatState;
  note: string | null;
  userId: string | null;
  /** The name on the desk — from the linked account, or typed at import. */
  occupantName: string | null;
  occupant: SeatOccupant | null;
}

export interface OfficeCounts {
  units: number;
  occupied: number;
  free: number;
  reserved: number;
  blocked: number;
}

/** What still stands between a room and being drawable to scale. */
export interface PlanReadiness {
  measured: boolean;
  placed: number;
  total: number;
  ready: boolean;
}

export interface Office {
  id: string;
  zone: string;
  nameAr: string;
  nameEn: string | null;
  department: string | null;
  kind: OfficeKind;
  columns: number | null;
  dimensions: { width: number; height: number } | null;
  /** The room's outline in metres. `null` means an ordinary rectangle. */
  shape: Point[] | null;
  note: string | null;
  order: number;
  seats: OfficeSeat[];
  counts: OfficeCounts;
  plan: PlanReadiness;
  updatedAt: string | null;
}

export interface OfficeSummary extends OfficeCounts {
  rooms: number;
  occupancyPercent: number;
}

export interface UnlinkedOccupant {
  seatId: string;
  officeId: string;
  officeName: string;
  name: string;
}

export interface OfficePlan {
  offices: Office[];
  zones: string[];
  summary: OfficeSummary;
  unlinked: UnlinkedOccupant[];
}

export interface OfficeBootstrap {
  kinds: Array<{ id: OfficeKind; ar: string; en: string }>;
  seatStates: Array<{ id: SeatState; ar: string; en: string }>;
  settableStates: SeatState[];
  departments: Array<{ id: string; ar: string; en: string; color: string }>;
  shapes: Array<{ id: ShapePreset; ar: string; en: string }>;
  limits: { seatsPerOffice: number; seatsPerRequest: number; shapePoints: number };
  canManage: boolean;
}

export interface MySeat {
  office: Office | null;
  seat: OfficeSeat | null;
}

/** Everything a seat may be changed to, in one shape. */
export interface SeatPatch {
  label?: string;
  note?: string | null;
  gridIndex?: number;
  point?: Point | null;
  status?: Exclude<SeatState, 'occupied'>;
  userId?: string | null;
  occupantName?: string | null;
}

export interface OfficePatch {
  nameAr?: string;
  nameEn?: string | null;
  zone?: string;
  department?: string | null;
  kind?: OfficeKind;
  columns?: number | null;
  dimensions?: { width: number; height: number } | null;
  shape?: Point[] | null;
  note?: string | null;
  order?: number;
}

/* Every mutation answers with the whole plan. It is a few kilobytes, and it is
   what keeps a moved person from appearing at two desks until the next refresh
   — the server already recomputed both rooms, so the page takes its word. */

export const officesApi = {
  bootstrap: () => api.get<OfficeBootstrap>('/offices/bootstrap'),
  plan: () => api.get<OfficePlan>('/offices'),
  mySeat: () => api.get<MySeat>('/offices/me'),

  createOffice: (body: OfficePatch & { seats?: number }) => api.post<OfficePlan>('/offices', body),
  updateOffice: (officeId: string, body: OfficePatch) =>
    api.patch<OfficePlan>(`/offices/${officeId}`, body),
  deleteOffice: (officeId: string) => api.delete<OfficePlan>(`/offices/${officeId}`),

  addSeats: (officeId: string, count: number) =>
    api.post<OfficePlan>(`/offices/${officeId}/seats`, { count }),
  updateSeat: (officeId: string, seatId: string, body: SeatPatch) =>
    api.patch<OfficePlan>(`/offices/${officeId}/seats/${seatId}`, body),
  removeSeat: (officeId: string, seatId: string) =>
    api.delete<OfficePlan>(`/offices/${officeId}/seats/${seatId}`),
};

/** Rooms grouped the way the plan is read — by zone, in zone order. */
export function byZone(offices: Office[]): Array<{ zone: string; offices: Office[] }> {
  const groups = new Map<string, Office[]>();
  for (const office of offices) {
    const list = groups.get(office.zone) ?? [];
    list.push(office);
    groups.set(office.zone, list);
  }
  return [...groups.entries()].map(([zone, list]) => ({ zone, offices: list }));
}

/** A zone's own partition, so a floor can be read without adding up rooms. */
export function zoneCounts(offices: Office[]): OfficeCounts {
  return offices.reduce<OfficeCounts>(
    (total, office) => ({
      units: total.units + office.counts.units,
      occupied: total.occupied + office.counts.occupied,
      free: total.free + office.counts.free,
      reserved: total.reserved + office.counts.reserved,
      blocked: total.blocked + office.counts.blocked,
    }),
    { units: 0, occupied: 0, free: 0, reserved: 0, blocked: 0 }
  );
}
