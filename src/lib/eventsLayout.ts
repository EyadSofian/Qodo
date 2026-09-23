/**
 * The Events schedule layout's client contract: how Qodo arranges Odoo's
 * courses into Department → Package → optional Group → Course.
 *
 * A layout holds references (`eventId`) and display labels only. Every
 * operational value — dates, instructor, status, trainees — still comes from
 * the schedule rows, which come from Odoo. The pure editing operations live in
 * shared/eventsLayout.js so the server validates exactly what the page builds.
 */

import { api } from './api';
import type { StatusCanonical, TrainingScheduleRow } from './eventsSchedule';

export type LayoutAccent = 'blue' | 'violet' | 'green' | 'amber' | 'sky' | 'indigo' | 'pink' | 'orange' | 'coral' | 'slate';

export interface LayoutCourse {
  eventId: number;
  /** Odoo's code, digits only — kept for diagnostics and the first mapping. */
  code: string | null;
  /** Display override. Odoo's own name is never changed. */
  customLabel: string | null;
  badge: string | null;
  note: string | null;
}

export interface LayoutGroup {
  id: string;
  label: string;
  courses: LayoutCourse[];
}

export interface LayoutPackage {
  id: string;
  label: string;
  accent: LayoutAccent | null;
  description: string | null;
  /** Left out of the Schedule view only; its courses stay in This month, Today and Analytics. */
  hiddenInSchedule: boolean;
  courses: LayoutCourse[];
  groups: LayoutGroup[];
}

export interface EventLayout {
  departments: Array<{ department: string; packages: LayoutPackage[] }>;
  /** Courses left out of the Schedule view only — never out of operational views. */
  hiddenInSchedule: number[];
}

export interface LayoutResponse {
  layout: EventLayout;
  revision: number;
  updatedAt: string | null;
  updatedBy: { id: string; name: string | null } | null;
  /** Nobody has saved yet: this is the workbook default. */
  isDefault: boolean;
  /** The default could not be resolved (Odoo unreachable) — everything shows unplaced. */
  defaultPending: boolean;
  canManage?: boolean;
}

export interface Placement {
  department: string;
  packageId: string;
  packageLabel: string;
  packageAccent: LayoutAccent | null;
  packageHiddenInSchedule: boolean;
  groupId: string | null;
  groupLabel: string | null;
  position: number;
  customLabel: string | null;
  badge: string | null;
  note: string | null;
  code: string | null;
}

/** A schedule row with its place in the layout. */
export type PlacedRow = TrainingScheduleRow & {
  odooName?: string;
  placement?: Placement | null;
  /** Presentation only: the Schedule skips it, operational views do not. */
  hiddenInSchedule?: boolean;
  monthBucket?: string;
};

export interface LayoutSearchResult {
  id: number;
  courseName: string;
  courseCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface StaleReference {
  eventId: number;
  code: string | null;
  packageId: string | null;
}

export const fetchLayout = () => api.get<LayoutResponse>('/events/layout');

export const saveLayout = (layout: EventLayout, expectedRevision: number) =>
  api.put<LayoutResponse>('/events/layout', { layout, expectedRevision });

export const resetLayout = (expectedRevision: number) => api.post<LayoutResponse>('/events/layout/reset', { expectedRevision });

export const fetchStaleReferences = () => api.get<{ missing: StaleReference[]; checked: number }>('/events/layout/references');

export const searchLayoutCourses = (q: string) =>
  api.get<{ results: LayoutSearchResult[] }>(`/events/layout/search?q=${encodeURIComponent(q)}`);

export type { StatusCanonical };

/** `arrangeSchedule`'s answer, typed for the page. */
export interface ArrangedPackage {
  package: LayoutPackage;
  direct: PlacedRow[];
  groups: Array<{ group: LayoutGroup; rows: PlacedRow[] }>;
  total: number;
  /** Placed courses with no row in view — outside the dates or the filters, or gone from Odoo. */
  elsewhere: number;
}

export interface Arranged {
  departments: Array<{ department: string; packages: ArrangedPackage[] }>;
  unassigned: PlacedRow[];
}
