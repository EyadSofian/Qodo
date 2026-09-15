/**
 * One lesson: a compact header and its five stages as tabs. The stage is in
 * the URL — `/lessons/:lessonId/ppt` — so a link to "Lesson 8's PPT" opens
 * exactly that. `?asset=ppt` works too, for links written by hand.
 */

import { Navigate, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import { cx, formatDate } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { BLOCKED_META, STAGE_COLOR, STAGE_ICON, STATUS_META, stageKey, stageSlug, statusKey } from '../../lib/learningProduction/format';
import { assetTypeFromSlug } from '@shared/learningProduction/constants';
import type { AssetType, LessonDetail } from '../../lib/learningProduction/types';
import { ErrorPanel, PageHeader, PersonChip, ProgressBar, SkeletonRows } from '../../components/learning-production/kit';
import { AssetWorkspace } from './AssetWorkspace';

export function LessonWorkspace() {
  const { t, lang } = useI18n();
  const { courseId = '', lessonId = '', stage } = useParams();
  const [params] = useSearchParams();
  const { data, error, loading, reload } = useLpQuery<LessonDetail>(paths.lesson(lessonId));

  if (loading && !data) {
    return (
      <>
        <div className="skeleton mb-3 h-16 w-full rounded-2xl" />
        <SkeletonRows rows={5} />
      </>
    );
  }
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return null;

  const requested = assetTypeFromSlug(stage ?? params.get('asset') ?? '') as AssetType | null;
  if (!requested) {
    const fallback = data.currentStage ?? 'OUTLINE';
    return <Navigate to={`/learning-production/courses/${courseId}/lessons/${lessonId}/${stageSlug(fallback)}`} replace />;
  }
  const asset = data.assets.find((entry) => entry.assetType === requested);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t('lp.nav.courses'), to: '/learning-production/courses' },
          { label: data.course.name, to: `/learning-production/courses/${courseId}/production` },
          ...(data.lesson.moduleName ? [{ label: data.lesson.moduleName }] : []),
          { label: data.lesson.name },
          { label: t(stageKey(requested)) },
        ]}
        title={data.lesson.name}
        meta={
          <>
            <span className="flex items-center gap-2 text-[12.5px] text-ink-muted">
              <span className="w-24">
                <ProgressBar value={data.progress.percent} label={t('lp.progress')} />
              </span>
              <span className="font-semibold tabular-nums text-ink">{data.progress.percent}%</span>
            </span>
            {data.currentStage && (
              <span className="text-[12.5px] text-ink-muted">
                {t('lp.lesson.currentStage')}: <span className="font-semibold text-ink">{t(stageKey(data.currentStage))}</span>
              </span>
            )}
            {data.lesson.ownerUserId && (
              <span className="text-[12.5px] text-ink-muted">
                <PersonChip userId={data.lesson.ownerUserId} people={data.people} size={20} />
              </span>
            )}
            {data.lesson.targetDate && (
              <span className="text-[12.5px] text-ink-muted">
                {t('lp.dueDate')}: {formatDate(data.lesson.targetDate, lang)}
              </span>
            )}
          </>
        }
      />

      <nav aria-label={t('lp.lesson.stages')} className="no-scrollbar mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-surface-line bg-white p-1">
        {data.assets.map((entry) => {
          const meta = entry.blocked ? BLOCKED_META : STATUS_META[entry.status];
          const StatusIcon = meta.icon;
          const StageIcon = STAGE_ICON[entry.assetType];
          return (
            <NavLink
              key={entry.assetType}
              to={`/learning-production/courses/${courseId}/lessons/${lessonId}/${stageSlug(entry.assetType)}`}
              className={({ isActive }) =>
                cx(
                  'flex min-w-[130px] flex-1 items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold transition-colors',
                  isActive ? 'bg-navy text-white' : 'text-ink hover:bg-surface-sunken'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <StageIcon size={15} className={isActive ? undefined : STAGE_COLOR[entry.assetType]} aria-hidden="true" />
                  <span className="flex-1 truncate">{t(stageKey(entry.assetType))}</span>
                  <span className="flex items-center gap-1 text-[11px] font-normal opacity-80" title={entry.blocked ? t('lp.blocked') : t(statusKey(entry.status))}>
                    <StatusIcon size={12} aria-hidden="true" />
                    <span className="sr-only">{entry.blocked ? t('lp.blocked') : t(statusKey(entry.status))}</span>
                  </span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {asset ? <AssetWorkspace key={asset.id} assetId={asset.id} /> : null}
    </>
  );
}
