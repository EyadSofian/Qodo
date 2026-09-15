/**
 * Reviews — the reviewer's queue, oldest submission first, so a reviewer
 * works through it in the order people have been waiting.
 */

import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, RotateCcw } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { timeAgo } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery, useSessionState } from '../../lib/learningProduction/hooks';
import { STAGES, assetRoute, priorityKey, stageKey } from '../../lib/learningProduction/format';
import type { CourseWithStats, People, ReviewsResponse } from '../../lib/learningProduction/types';
import { Chip, EmptyPanel, ErrorPanel, PageHeader, Section, SkeletonRows, StageLabel } from '../../components/learning-production/kit';
import { WorkList } from '../../components/learning-production/WorkList';
import { useLpMe } from './Layout';

export function Reviews() {
  const { t } = useI18n();
  const me = useLpMe();
  const [filters, setFilters] = useSessionState('reviews.filters', { scope: 'mine', courseId: '', assetType: '', priority: '' });
  const { data, error, loading, reload } = useLpQuery<ReviewsResponse>(paths.reviews(filters));
  const { data: courses } = useLpQuery<{ courses: CourseWithStats[]; people: People }>(paths.courses({}));
  const set = (key: keyof typeof filters, value: string) => setFilters({ ...filters, [key]: value });

  const waiting = (data?.sections.needsReview.length ?? 0) + (data?.sections.resubmitted.length ?? 0);

  return (
    <>
      <PageHeader title={t('lp.reviews.title')} description={t('lp.reviews.subtitle')} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(me?.seesEveryCourse || me?.managesWork) && (
          <select className="field !w-auto" value={filters.scope} onChange={(event) => set('scope', event.target.value)} aria-label={t('lp.reviews.scope')}>
            <option value="mine">{t('lp.reviews.scopeMine')}</option>
            <option value="all">{t('lp.reviews.scopeAll')}</option>
          </select>
        )}
        <select className="field !w-auto" value={filters.courseId} onChange={(event) => set('courseId', event.target.value)} aria-label={t('lp.lesson.course')}>
          <option value="">{t('lp.reviews.allCourses')}</option>
          {courses?.courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
        <select className="field !w-auto" value={filters.assetType} onChange={(event) => set('assetType', event.target.value)} aria-label={t('lp.stage')}>
          <option value="">{t('lp.allStages')}</option>
          {STAGES.map((type) => (
            <option key={type} value={type}>
              {t(stageKey(type))}
            </option>
          ))}
        </select>
        <select className="field !w-auto" value={filters.priority} onChange={(event) => set('priority', event.target.value)} aria-label={t('lp.priority')}>
          <option value="">{t('lp.allPriorities')}</option>
          {(['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const).map((value) => (
            <option key={value} value={value}>
              {t(priorityKey(value))}
            </option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <SkeletonRows rows={5} height="h-16" />
      ) : error && !data ? (
        <ErrorPanel error={error} onRetry={reload} />
      ) : data ? (
        <div className="space-y-4">
          {waiting === 0 ? (
            <EmptyPanel icon={<CheckCircle2 size={26} />} title={t('lp.reviews.caughtUp')} body={t('lp.reviews.caughtUpBody')} />
          ) : (
            <>
              {data.sections.needsReview.length > 0 && (
                <Section title={<span className="flex items-center gap-2"><ClipboardCheck size={16} className="text-indigo-700" />{t('lp.reviews.needsReview')} · {data.sections.needsReview.length}</span>} bodyClassName="!p-0">
                  <WorkList items={data.sections.needsReview} people={data.people} show="submitted" />
                </Section>
              )}
              {data.sections.resubmitted.length > 0 && (
                <Section title={<span className="flex items-center gap-2"><RotateCcw size={16} className="text-accent-700" />{t('lp.reviews.resubmitted')} · {data.sections.resubmitted.length}</span>} bodyClassName="!p-0">
                  <WorkList items={data.sections.resubmitted} people={data.people} show="submitted" />
                </Section>
              )}
            </>
          )}
          {data.sections.recentlyReviewed.length > 0 && (
            <Section title={t('lp.reviews.recent')} bodyClassName="!p-0" className="bg-white/70">
              <ul className="divide-y divide-surface-line">
                {data.sections.recentlyReviewed.map((item) => (
                  <li key={item.approvalId}>
                    <Link to={assetRoute(item.course.id, item.lesson.id, item.assetType)} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] hover:bg-surface-bg">
                      <StageLabel type={item.assetType} className="font-semibold text-ink" />
                      <span className="text-ink-faint">v{item.versionNumber}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-muted">
                        {item.course.name} · {item.lesson.name}
                      </span>
                      <Chip tone={item.decision === 'APPROVED' ? 'ok' : 'warn'}>{t(`lp.decision.${item.decision}` as never)}</Chip>
                      <span className="text-[12px] text-ink-faint">{timeAgo(item.reviewedAt, t)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      ) : null}
    </>
  );
}
