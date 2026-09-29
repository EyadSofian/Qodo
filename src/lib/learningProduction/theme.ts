/**
 * E-Learning Production colours. Each place in the module, and each way of
 * producing a program, has its own two-stop gradient: the aurora behind the
 * page, the hero, the primary buttons and the active tab all take it, so the
 * reader can tell where they are at a glance. Status colours (green done,
 * amber needs a person, rose late, indigo in progress) stay semantic on top.
 *
 * Colours are "r g b" triplets so CSS can mix alpha: `rgb(var(--lp-a1) / 0.2)`.
 * No teal, per the workspace palette rule.
 */

import type { Scenario } from './runTypes';

export interface LpTheme {
  a1: string;
  a2: string;
}

export type LpArea = 'dashboard' | 'courses' | 'myWork' | 'reviews' | 'reports' | 'templates' | 'newRun' | 'course';

export const AREA_THEME: Record<LpArea, LpTheme> = {
  dashboard: { a1: '79 70 229', a2: '147 51 234' },
  courses: { a1: '2 132 199', a2: '37 99 235' },
  myWork: { a1: '234 88 12', a2: '219 39 119' },
  reviews: { a1: '192 38 211', a2: '124 58 237' },
  reports: { a1: '5 150 105', a2: '22 163 74' },
  templates: { a1: '51 65 85', a2: '67 56 202' },
  newRun: { a1: '99 102 241', a2: '219 39 119' },
  course: { a1: '37 99 235', a2: '79 70 229' },
};

export const SCENARIO_THEME: Record<Scenario, LpTheme> = {
  AI_NEW: { a1: '124 58 237', a2: '219 39 119' },
  EXPERT_NEW: { a1: '37 99 235', a2: '79 70 229' },
  REVAMP: { a1: '234 88 12', a2: '225 29 72' },
  LEGACY: { a1: '51 65 85', a2: '30 58 138' },
};

/** `/learning-production/my-work` → myWork; a course page → course. */
export function areaOf(pathname: string): LpArea {
  const segment = pathname.split('/').filter(Boolean)[1] ?? '';
  if (segment === 'courses') return pathname.split('/').filter(Boolean).length > 2 ? 'course' : 'courses';
  if (segment === 'my-work') return 'myWork';
  if (segment === 'reviews') return 'reviews';
  if (segment === 'reports') return 'reports';
  if (segment === 'templates') return 'templates';
  if (segment === 'runs') return 'newRun';
  return 'dashboard';
}

export const gradient = (theme: LpTheme, angle = 135) => `linear-gradient(${angle}deg, rgb(${theme.a1}), rgb(${theme.a2}))`;
