/**
 * HR's colour system. Each area has its own two-stop gradient — the sidebar
 * chip, the page hero, the primary buttons and the active tab all take it — so
 * moving between areas is visible at a glance. Status colours (red critical,
 * amber warning, blue info, green success) stay semantic on top of this.
 *
 * Calm on purpose (owner, 2026-11-26: the vivid set was "hard on the eye"):
 * deep, low-saturation tones, both stops dark enough that white text on a
 * hero stays at 4.5:1 or better. Never `teal-*`.
 *
 * Colours are RGB triplets so CSS can mix alpha: `rgb(var(--hr-a1) / 0.2)`.
 */

import {
  BarChart3,
  BriefcaseBusiness,
  ClipboardList,
  Fingerprint,
  Gauge,
  LayoutDashboard,
  Network,
  Settings2,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

export type Area = 'home' | 'recruitment' | 'people' | 'attendance' | 'personnel' | 'payroll' | 'performance' | 'organization' | 'reports' | 'settings';

export interface AreaTheme {
  /** Gradient start and end, as "r g b". */
  a1: string;
  a2: string;
  icon: LucideIcon;
}

export const AREA_THEME: Record<Area, AreaTheme> = {
  home: { a1: '30 47 84', a2: '44 68 115', icon: LayoutDashboard },
  recruitment: { a1: '96 66 150', a2: '116 82 166', icon: BriefcaseBusiness },
  people: { a1: '33 76 140', a2: '45 96 160', icon: UsersRound },
  attendance: { a1: '62 66 160', a2: '79 86 178', icon: Fingerprint },
  personnel: { a1: '28 102 70', a2: '38 120 84', icon: ClipboardList },
  payroll: { a1: '140 84 24', a2: '158 98 34', icon: WalletCards },
  performance: { a1: '154 52 82', a2: '170 70 98', icon: Gauge },
  organization: { a1: '52 74 116', a2: '66 90 134', icon: Network },
  reports: { a1: '118 62 118', a2: '136 80 134', icon: BarChart3 },
  settings: { a1: '64 76 96', a2: '82 96 116', icon: Settings2 },
};

const AREAS = Object.keys(AREA_THEME) as Area[];

/** The area a path belongs to: `/hr/payroll/...` → payroll, `/hr` → home. */
export function areaOf(pathname: string): Area {
  const segment = pathname.split('/').filter(Boolean)[1] ?? 'home';
  return (AREAS as string[]).includes(segment) ? (segment as Area) : 'home';
}

export const gradient = (theme: AreaTheme, angle = 135) => `linear-gradient(${angle}deg, rgb(${theme.a1}), rgb(${theme.a2}))`;

/**
 * Initials get a colour instead of a grey disc. The palette is picked by a
 * hash of the name, so a person keeps their colour everywhere they appear.
 */
const INITIAL_GRADIENTS = [
  ['62 66 160', '79 86 178'],
  ['33 76 140', '45 96 160'],
  ['28 102 70', '38 120 84'],
  ['140 84 24', '158 98 34'],
  ['154 52 82', '170 70 98'],
  ['96 66 150', '116 82 166'],
  ['52 74 116', '66 90 134'],
  ['160 72 40', '176 90 56'],
] as const;

export function nameHash(value: string) {
  let hash = 0;
  for (const char of String(value || '')) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash;
}

export function initialsGradient(name: string) {
  const [from, to] = INITIAL_GRADIENTS[nameHash(name) % INITIAL_GRADIENTS.length];
  return `linear-gradient(135deg, rgb(${from}), rgb(${to}))`;
}

/** A soft, stable colour for a label (a department, a leave type). */
export function labelColor(value: string) {
  const [from] = INITIAL_GRADIENTS[nameHash(value) % INITIAL_GRADIENTS.length];
  return from;
}

/** Odoo's 12-colour index (hr.leave.type.color) mapped onto this palette. */
export function odooColor(index: number) {
  const palette = ['100 116 139', '239 68 68', '249 115 22', '234 179 8', '14 165 233', '139 92 246', '236 72 153', '22 163 74', '29 78 216', '217 70 239', '5 150 105', '124 58 237'];
  return palette[Math.abs(Number(index) || 0) % palette.length];
}
