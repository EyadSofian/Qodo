/**
 * One lesson: its name, a way back to the course, and its five files as
 * steps in production order — outline, slides, script, voice-over, video.
 * Each step says its state in a word; the chosen one opens below. The step is
 * in the URL — `/lessons/:lessonId/ppt` — so a link to "Lesson 8's slides"
 * opens exactly that. `?asset=ppt` works too, for links written by hand.
 */

import { Link, Navigate, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { stageKey, stageSlug, statusKey } from '../../lib/learningProduction/format';
import { assetTypeFromSlug } from '@shared/learningProduction/constants';
import type { AssetSummary, AssetType, LessonDetail } from '../../lib/learningProduction/types';
import { ErrorPanel, SkeletonRows } from '../../components/learning-production/kit';
import { CountUp, Hero } from '../../components/learning-production/studio';
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

// Written out whole so Tailwind keeps them.
const WORD_CLASS: Record<StepTone, string> = {
  done: 'text-emerald-700',
  review: 'text-violet-700',
  changes: 'text-amber-700',
  progress: 'text-blue-700',
  waiting: 'lps-faint',
  idle: 'lps-muted',
  na: 'lps-faint',
};

const MARK_CLASS: Record<StepTone, string> = {
  done: 'lps-step-mark-done',
  review: 'lps-step-mark-review',
  changes: 'lps-step-mark-changes',
  progress: 'lps-step-mark-progress',
  waiting: 'lps-step-mark-waiting',
  idle: 'lps-step-mark-idle',
  na: 'lps-step-mark-na',
};

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

      <nav aria-label={t('lp.lesson.stages')} className="lps-panel no-scrollbar relative overflow-x-auto px-2 py-2">
        <ol className="flex min-w-max items-stretch sm:min-w-0">
          {data.assets.map((entry, index) => {
            const tone = stepTone(entry);
            const word = entry.applicable === false ? t('lp.lessonPage.notNeeded') : entry.blocked ? t('lp.lessonPage.notYet') : t(statusKey(entry.status));
            return (
              <li key={entry.assetType} className="flex flex-1 items-center">
                <NavLink
                  to={`/learning-production/courses/${courseId}/lessons/${lessonId}/${stageSlug(entry.assetType)}`}
                  className={({ isActive }) => cx('lps-step-link', isActive && 'lps-step-link-active')}
                >
                  <span className={cx('lps-step-mark', MARK_CLASS[tone])} aria-hidden="true">
                    {tone === 'done' ? <Check size={14} strokeWidth={3} /> : index + 1}
                  </span>
                  <span className="min-w-0 text-start">
                    <span className="block whitespace-nowrap text-[13.5px] font-semibold">{t(stageKey(entry.assetType))}</span>
                    <span className={cx('block whitespace-nowrap text-[12px]', WORD_CLASS[tone])}>{word}</span>
                  </span>
                </NavLink>
                {index < data.assets.length - 1 && <span aria-hidden="true" className={cx('lps-step-join', tone === 'done' && 'lps-step-join-done')} />}
              </li>
            );
          })}
        </ol>
      </nav>

      {asset ? <AssetWorkspace key={asset.id} assetId={asset.id} /> : null}
    </div>
  );
}
