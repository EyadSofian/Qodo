/**
 * Production Matrix filtering — pure, so the same rules drive the table, the
 * counts on the quick filters and the bulk selection.
 */

import type { AssetSummary, AssetType, MatrixLesson } from './types';

export type QuickFilter = 'ALL' | 'OVERDUE' | 'REVIEW' | 'CHANGES' | 'APPROVED' | 'BLOCKED';

export interface MatrixFilters {
  quick: QuickFilter;
  moduleId: string;
  assigneeId: string;
  reviewerId: string;
  stage: AssetType | '';
  search: string;
}

export const EMPTY_FILTERS: MatrixFilters = { quick: 'ALL', moduleId: '', assigneeId: '', reviewerId: '', stage: '', search: '' };

export function matchesQuick(asset: AssetSummary | undefined, quick: QuickFilter) {
  if (!asset) return false;
  switch (quick) {
    case 'ALL':
      return true;
    case 'OVERDUE':
      return asset.dueState === 'OVERDUE';
    case 'REVIEW':
      return asset.status === 'SUBMITTED' || asset.status === 'UNDER_REVIEW' || asset.status === 'RESUBMITTED';
    case 'CHANGES':
      return asset.status === 'CHANGES_REQUESTED';
    case 'APPROVED':
      return asset.status === 'APPROVED' || asset.status === 'LOCKED';
    case 'BLOCKED':
      return asset.blocked;
    default:
      return true;
  }
}

/**
 * The assets a filter set looks at: one stage if chosen, otherwise all five.
 * A lesson is shown when any of those assets passes every filter.
 */
export function filterLessons(lessons: MatrixLesson[], filters: MatrixFilters) {
  const needle = filters.search.trim().toLowerCase();
  return lessons.filter((lesson) => {
    if (filters.moduleId && (lesson.moduleId ?? 'none') !== filters.moduleId) return false;
    if (needle && !lesson.name.toLowerCase().includes(needle)) return false;
    const assets = Object.values(lesson.assets).filter(
      (asset): asset is AssetSummary => Boolean(asset) && (!filters.stage || asset!.assetType === filters.stage)
    );
    return assets.some(
      (asset) =>
        matchesQuick(asset, filters.quick) &&
        (!filters.assigneeId || asset.assigneeUserId === filters.assigneeId) &&
        (!filters.reviewerId || asset.reviewerUserId === filters.reviewerId)
    );
  });
}

/** How many assets each quick filter would match, for the counts on its button. */
export function quickCounts(lessons: MatrixLesson[]) {
  const counts: Record<QuickFilter, number> = { ALL: 0, OVERDUE: 0, REVIEW: 0, CHANGES: 0, APPROVED: 0, BLOCKED: 0 };
  for (const lesson of lessons) {
    for (const asset of Object.values(lesson.assets)) {
      if (!asset) continue;
      for (const key of Object.keys(counts) as QuickFilter[]) if (matchesQuick(asset, key)) counts[key] += 1;
    }
  }
  return counts;
}

export function activeFilterCount(filters: MatrixFilters) {
  return [filters.quick !== 'ALL', filters.moduleId, filters.assigneeId, filters.reviewerId, filters.stage, filters.search.trim()].filter(Boolean).length;
}
