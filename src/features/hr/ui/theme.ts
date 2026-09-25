/**
 * HR's colour system. Each area has its own two-stop gradient — the sidebar
 * chip, the page hero, the primary buttons and the active tab all take it — so
 * moving between areas is visible at a glance. Status colours (red critical,
 * amber warning, blue info, green success) stay semantic on top of this.
 *
 * Colours are RGB triplets so CSS can mix alpha: `rgb(var(--hr-a1) / 0.2)`.
 */

import {
  BarChart3,
  BriefcaseBusiness,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  Network,
  Settings2,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

export type Area = 'home' | 'recruitment' | 'people' | 'personnel' | 'payroll' | 'performance' | 'organization' | 'reports' | 'settings';

export interface AreaTheme {
  /** Gradient start and end, as "r g b". */
  a1: string;
  a2: string;
  icon: LucideIcon;
}

export const AREA_THEME: Record<Area, AreaTheme> = {
  home: { a1: '79 70 229', a2: '37 99 235', icon: LayoutDashboard },
  recruitment: { a1: '124 58 237', a2: '192 38 211', icon: BriefcaseBusiness },
  people: { a1: '2 132 199', a2: '37 99 235', icon: UsersRound },
  personnel: { a1: '5 150 105', a2: '22 163 74', icon: ClipboardList },
  payroll: { a1: '217 119 6', a2: '234 88 12', icon: WalletCards },
  performance: { a1: '225 29 72', a2: '219 39 119', icon: Gauge },
  organization: { a1: '29 78 216', a2: '67 56 202', icon: Network },
  reports: { a1: '147 51 234', a2: '99 102 241', icon: BarChart3 },
  settings: { a1: '51 65 85', a2: '30 58 138', icon: Settings2 },
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
  ['79 70 229', '124 58 237'],
  ['2 132 199', '37 99 235'],
  ['5 150 105', '22 163 74'],
  ['217 119 6', '234 88 12'],
  ['225 29 72', '219 39 119'],
  ['147 51 234', '192 38 211'],
  ['29 78 216', '14 165 233'],
  ['234 88 12', '220 38 38'],
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
