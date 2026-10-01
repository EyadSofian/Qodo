/**
 * One lesson: its name, a way back to the course, and its five files as
 * steps in production order — outline, slides, script, voice-over, video.
 * Each step says its state in a word; the chosen one opens below. The step is
 * in the URL — `/lessons/:lessonId/ppt` — so a link to "Lesson 8's slides"
 * opens exactly that. `?asset=ppt` works too, for links written by hand.
 */

import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Route } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { STAGE_ICON, stageKey, stageSlug, statusKey } from '../../lib/learningProduction/format';
import { assetTypeFromSlug } from '@shared/learningProduction/constants';
import type { AssetSummary, AssetType, LessonDetail } from '../../lib/learningProduction/types';
import { ErrorPanel, SkeletonRows } from '../../components/learning-production/kit';
import { CountUp, Hero, IconChip, JourneyMap, type JourneyState } from '../../components/learning-production/studio';
import { AssetWorkspace } from './AssetWorkspace';

type StepTone = 'done' | 'review' | 'changes' | 'progress' | 'waiting' | 'idle' | 'na';

function stepTone(asset: AssetSummary): StepTone {
  if (asset.applicable === false) return 'na';
  if (asset.status === 'APPROVED' || asset.status === 'LOCKED') return 'done';
  if (asset.blocked) return 'waiting';
  if (['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'].includes(asset.status)) return 'review';
  if (asset.status === 'CHANGES_REQUESTED') return 'changes';
  if (asset.status === 'IN_PROGRESS') return 'progress';
  return 'idle';
}



export function LessonWorkspace() {
  const { t, dir } = useI18n();
  const { courseId = '', lessonId = '', stage } = useParams();
  const [params] = useSearchParams();
  const { data, error, loading, reload } = useLpQuery<LessonDetail>(paths.lesson(lessonId));
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;

  if (loading && !data) {
    return (
      <>
        <div className="skeleton mb-3 h-16 w-2/3 rounded-2xl" />
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
  const applicable = data.assets.filter((entry) => entry.applicable !== false);
  const approved = applicable.filter((entry) => entry.status === 'APPROVED' || entry.status === 'LOCKED').length;

  return (
    <div className="space-y-5">
      <Hero
        back={
          <Link to={`/learning-production/courses/${courseId}`} className="lps-hero-back">
            <Back size={15} aria-hidden="true" className="shrink-0" />
            <span className="lps-bidi truncate">{data.course.name}</span>
          </Link>
        }
        title={data.lesson.name}
        subtitle={data.lesson.moduleName ? <span className="lps-bidi">{data.lesson.moduleName}</span> : undefined}
      >
        <span className="lps-hero-chip">
          <strong>
            <CountUp value={approved} />
          </strong>
          {t('lp.lessonPage.ofApproved', { total: applicable.length })}
        </span>
        <span className="lps-hero-chip min-w-[160px] flex-1 sm:max-w-[260px]">
          <span className="relative h-2 w-full overflow-hidden rounded-full bg-white/25">
            <span className="absolute inset-y-0 start-0 rounded-full bg-white transition-[width] duration-700" style={{ width: `${applicable.length ? Math.round((approved / applicable.length) * 100) : 0}%` }} />
          </span>
        </span>
      </Hero>

      <section className="lps-panel px-2 pb-1 sm:px-3" aria-label={t('lp.lesson.stages')}>
        <h2 className="flex items-center gap-2.5 px-2 pt-4 text-[15px] font-bold sm:px-3">
          <IconChip icon={Route} tone="blue" size={15} />
          {t('lp.lessonPage.journey')}
        </h2>
        <JourneyMap
          label={t('lp.lessonPage.journey')}
          nowLabel={t('lp.plan.now')}
          selected={requested}
          nodes={data.assets.map((entry) => {
            const tone = stepTone(entry);
            const state: JourneyState =
              tone === 'done' ? 'done' : tone === 'na' ? 'skipped' : entry.assetType === data.currentStage ? 'current' : tone === 'review' ? 'review' : tone === 'changes' ? 'attention' : tone === 'progress' ? 'next' : 'later';
            return {
              key: entry.assetType,
              label: t(stageKey(entry.assetType)),
              sub: entry.applicable === false ? t('lp.lessonPage.notNeeded') : entry.blocked ? t('lp.lessonPage.notYet') : t(statusKey(entry.status)),
              state,
              icon: STAGE_ICON[entry.assetType],
              to: `/learning-production/courses/${courseId}/lessons/${lessonId}/${stageSlug(entry.assetType)}`,
            };
          })}
        />
      </section>

      {asset ? <AssetWorkspace key={asset.id} assetId={asset.id} /> : null}
    </div>
  );
}
