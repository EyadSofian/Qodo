/**
 * Production — the matrix, its filters and the manager's bulk tools.
 * Filters are kept for the browser session, per course.
 */

import { useMemo, useState } from 'react';
import { Filter, Search, X } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { lp, paths } from '../../../lib/learningProduction/api';
import { invalidate, useLpQuery, useSessionState } from '../../../lib/learningProduction/hooks';
import { STAGES, lpErrorKey, priorityKey, stageKey } from '../../../lib/learningProduction/format';
import { EMPTY_FILTERS, activeFilterCount, filterLessons, quickCounts, type MatrixFilters, type QuickFilter } from '../../../lib/learningProduction/matrix';
import type { AssetType, MatrixResponse, Priority } from '../../../lib/learningProduction/types';
import { Spinner, useToast } from '../../../components/ui';
import { EmptyPanel, ErrorPanel, PersonSelect, SkeletonRows, usePeople } from '../../../components/learning-production/kit';
import { ProductionMatrix } from '../../../components/learning-production/ProductionMatrix';
import { useCourse } from '../CourseWorkspace';

const QUICK: QuickFilter[] = ['ALL', 'OVERDUE', 'REVIEW', 'CHANGES', 'APPROVED', 'BLOCKED'];

export function CourseProduction() {
  const { t } = useI18n();
  const { detail } = useCourse();
  const courseId = detail.course.id;
  const { data, error, loading, reload } = useLpQuery<MatrixResponse>(paths.matrix(courseId));
  const [filters, setFilters] = useSessionState<MatrixFilters>(`matrix.${courseId}`, EMPTY_FILTERS);
  const [moreOpen, setMoreOpen] = useState(activeFilterCount({ ...filters, quick: 'ALL', search: '' }) > 0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const canAssign = detail.capabilities.assignAny;
  const people = usePeople(canAssign);

  const lessons = useMemo(() => (data ? filterLessons(data.lessons, filters) : []), [data, filters]);
  const counts = useMemo(() => (data ? quickCounts(data.lessons) : null), [data]);
  const assigneeOptions = useMemo(() => {
    if (!data) return [];
    const ids = new Set<string>();
    for (const lesson of data.lessons) for (const asset of Object.values(lesson.assets)) {
      if (asset?.assigneeUserId) ids.add(asset.assigneeUserId);
      if (asset?.reviewerUserId) ids.add(asset.reviewerUserId);
    }
    return [...ids].map((id) => ({ id, name: data.people[id]?.name ?? id })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const teamIds = detail.team.map((member) => member.userId);

  const set = <K extends keyof MatrixFilters>(key: K, value: MatrixFilters[K]) => setFilters({ ...filters, [key]: value });

  if (loading && !data) return <SkeletonRows rows={8} height="h-12" />;
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return null;

  if (data.lessons.length === 0) {
    return <EmptyPanel title={t('lp.lessons.emptyTitle')} body={t('lp.production.emptyBody')} />;
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('lp.production.quick')} className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-surface-line bg-white p-1">
          {QUICK.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters.quick === key}
              onClick={() => set('quick', key)}
              className={cx(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold',
                filters.quick === key ? 'bg-navy text-white' : 'text-ink-muted hover:bg-surface-sunken'
              )}
            >
              {t(`lp.quick.${key}` as never)}
              {key !== 'ALL' && counts && <span className="tabular-nums opacity-70">{counts[key]}</span>}
            </button>
          ))}
        </div>
        <label className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <span className="sr-only">{t('common.search')}</span>
          <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="field !min-h-9 !py-1.5 !ps-8" value={filters.search} onChange={(event) => set('search', event.target.value)} placeholder={t('lp.production.searchLesson')} />
        </label>
        <button type="button" className={cx('btn-sm', moreOpen ? 'btn-navy' : 'btn-ghost')} onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen}>
          <Filter size={14} />
          {t('lp.production.filters')}
        </button>
        {activeFilterCount(filters) > 0 && (
          <button type="button" className="btn-quiet btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            <X size={14} />
            {t('lp.production.clear')}
          </button>
        )}
        <span className="ms-auto text-[12.5px] text-ink-faint">{t('lp.production.showing', { n: lessons.length, total: data.lessons.length })}</span>
      </div>

      {moreOpen && (
        <div className="mb-3 grid gap-2 rounded-2xl border border-surface-line bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
          <select className="field" value={filters.moduleId} onChange={(event) => set('moduleId', event.target.value)} aria-label={t('lp.module.label')}>
            <option value="">{t('lp.production.allModules')}</option>
            {data.modules.map((module) => (
              <option key={module.id} value={module.id}>
                {module.name}
              </option>
            ))}
            <option value="none">{t('lp.noModule')}</option>
          </select>
          <select className="field" value={filters.stage} onChange={(event) => set('stage', event.target.value as AssetType | '')} aria-label={t('lp.stage')}>
            <option value="">{t('lp.allStages')}</option>
            {STAGES.map((type) => (
              <option key={type} value={type}>
                {t(stageKey(type))}
              </option>
            ))}
          </select>
          <select className="field" value={filters.assigneeId} onChange={(event) => set('assigneeId', event.target.value)} aria-label={t('lp.assignee')}>
            <option value="">{t('lp.production.anyAssignee')}</option>
            {assigneeOptions.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <select className="field" value={filters.reviewerId} onChange={(event) => set('reviewerId', event.target.value)} aria-label={t('lp.reviewer')}>
            <option value="">{t('lp.production.anyReviewer')}</option>
            {assigneeOptions.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {canAssign && selected.size > 0 && (
        <BulkBar
          courseId={courseId}
          data={data}
          lessonIds={[...selected]}
          people={people}
          teamIds={teamIds}
          onDone={() => setSelected(new Set())}
        />
      )}

      {lessons.length === 0 ? (
        <EmptyPanel icon={<Filter size={22} />} title={t('lp.production.noMatch')} action={<button type="button" className="btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>{t('lp.production.clear')}</button>} />
      ) : (
        <ProductionMatrix
          data={data}
          lessons={lessons}
          people={people}
          teamIds={teamIds}
          selected={selected}
          onToggle={(id) =>
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleAll={(ids) => setSelected((current) => (ids.every((id) => current.has(id)) ? new Set() : new Set(ids)))}
        />
      )}
    </>
  );
}

/** Assign one stage of the selected lessons at once — never anything irreversible. */
function BulkBar({
  courseId,
  data,
  lessonIds,
  people,
  teamIds,
  onDone,
}: {
  courseId: string;
  data: MatrixResponse;
  lessonIds: string[];
  people: ReturnType<typeof usePeople>;
  teamIds: string[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [stage, setStage] = useState<AssetType>('PPT');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    const assetIds = data.lessons
      .filter((lesson) => lessonIds.includes(lesson.id))
      .map((lesson) => lesson.assets[stage]?.id)
      .filter(Boolean) as string[];
    const patch: Record<string, unknown> = {};
    if (assignee) patch.assigneeUserId = assignee;
    if (reviewer) patch.reviewerUserId = reviewer;
    if (dueDate) patch.dueDate = dueDate;
    if (priority) patch.priority = priority;
    if (!assetIds.length || !Object.keys(patch).length) return;
    setBusy(true);
    try {
      const result = await lp.bulkAssign(courseId, { assetIds, ...patch });
      invalidate();
      toast.push(result.skipped ? t('lp.toast.bulkSkipped', { n: result.updated, skipped: result.skipped }) : t('lp.toast.bulkAssigned', { n: result.updated }));
      onDone();
    } catch (error) {
      toast.push(t(lpErrorKey(error)), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    // Sticks relative to the module's own scrolling pane (Layout.tsx), not
    // the document under the fixed topbar — see the same fix in ReviewSidebar.
    <div className="sticky top-3 z-40 mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-brand-200 bg-brand-50 p-3 shadow-card">
      <p className="w-full text-[13px] font-semibold text-ink sm:w-auto sm:self-center">{t('lp.bulk.selected', { n: lessonIds.length })}</p>
      <label className="block">
        <span className="label !mb-1">{t('lp.stage')}</span>
        <select className="field !min-h-9 !py-1" value={stage} onChange={(event) => setStage(event.target.value as AssetType)}>
          {STAGES.map((type) => (
            <option key={type} value={type}>
              {t(stageKey(type))}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-[160px]">
        <span className="label !mb-1">{t('lp.assignTo')}</span>
        <PersonSelect value={assignee} onChange={setAssignee} people={people} preferred={teamIds} placeholder={t('lp.bulk.keep')} exclude={reviewer} />
      </label>
      <label className="block min-w-[160px]">
        <span className="label !mb-1">{t('lp.reviewer')}</span>
        <PersonSelect value={reviewer} onChange={setReviewer} people={people} preferred={teamIds} placeholder={t('lp.bulk.keep')} exclude={assignee} />
      </label>
      <label className="block">
        <span className="label !mb-1">{t('lp.dueDate')}</span>
        <input type="date" className="field !min-h-9 !py-1" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      </label>
      <label className="block">
        <span className="label !mb-1">{t('lp.priority')}</span>
        <select className="field !min-h-9 !py-1" value={priority} onChange={(event) => setPriority(event.target.value as Priority | '')}>
          <option value="">{t('lp.bulk.keep')}</option>
          {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((value) => (
            <option key={value} value={value}>
              {t(priorityKey(value))}
            </option>
          ))}
        </select>
      </label>
      <div className="ms-auto flex gap-2">
        <button type="button" className="btn-quiet btn-sm" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={apply} disabled={busy || (!assignee && !reviewer && !dueDate && !priority)}>
          {busy && <Spinner size={14} />}
          {t('lp.bulk.apply')}
        </button>
      </div>
    </div>
  );
}
