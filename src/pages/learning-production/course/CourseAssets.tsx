/**
 * Assets — one lesson's five deliverables, each drawn as the thing it is.
 *
 * A production team does not think in rows of "file, version, status"; they
 * think in an outline, a deck, a script, a recording and a cut. So the outline
 * card shows its objectives, the deck shows a slide, the script shows its
 * narration, the voice-over shows a waveform and the video shows a frame. The
 * five cards are never interchangeable, and the picture on each is real content
 * from the current version — not a file icon.
 *
 * The board is a way *in*: opening a card opens that asset's real workspace,
 * with its review tools, comments, annotations and version history intact.
 */

import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, FileAudio2, MessageSquare, Play } from 'lucide-react';
import { useI18n, type StringKey } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { paths } from '../../../lib/learningProduction/api';
import { useLpQuery } from '../../../lib/learningProduction/hooks';
import { STAGES, STAGE_HEX, assetRoute, stageKey } from '../../../lib/learningProduction/format';
import type { AssetBoardResponse, BoardAsset, MatrixResponse } from '../../../lib/learningProduction/types';
import {
  Chip,
  DueChip,
  EmptyPanel,
  ErrorPanel,
  PersonChip,
  SkeletonRows,
  StageTag,
  StatusBadge,
} from '../../../components/learning-production/kit';
import { useCourse } from '../CourseWorkspace';

export function CourseAssets() {
  const { t } = useI18n();
  const { detail } = useCourse();
  const courseId = detail.course.id;
  const [params, setParams] = useSearchParams();
  const { data: matrix, error, loading } = useLpQuery<MatrixResponse>(paths.matrix(courseId));

  // Which lesson the board is showing lives in the address, so "the assets of
  // lesson 08" is a link somebody can send.
  const chosen = params.get('lesson') ?? '';
  const lessons = matrix?.lessons ?? [];
  const active = useMemo(() => {
    if (chosen && lessons.some((lesson) => lesson.id === chosen)) return chosen;
    // Default to the lesson that is actually moving — a board of five "not
    // started" cards teaches nobody anything about the course.
    const moving = lessons.find((lesson) => lesson.state === 'IN_REVIEW' || lesson.state === 'CHANGES_REQUESTED') ?? lessons.find((lesson) => lesson.state === 'IN_PRODUCTION');
    return (moving ?? lessons[0])?.id ?? '';
  }, [chosen, lessons]);

  const moduleName = new Map((matrix?.modules ?? []).map((module) => [module.id, module.name]));
  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; lessons: typeof lessons }>();
    for (const lesson of lessons) {
      const key = lesson.moduleId ?? 'none';
      if (!groups.has(key)) groups.set(key, { name: lesson.moduleId ? moduleName.get(lesson.moduleId) ?? '' : t('lp.noModule'), lessons: [] });
      groups.get(key)!.lessons.push(lesson);
    }
    return [...groups.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- moduleName is derived from matrix.
  }, [lessons, matrix]);

  if (loading && !matrix) return <SkeletonRows rows={4} height="h-40" />;
  if (error && !matrix) return <ErrorPanel error={error} />;
  if (lessons.length === 0) return <EmptyPanel title={t('lp.lessons.emptyTitle')} body={t('lp.assets.emptyBody')} />;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="min-w-[240px] flex-1 sm:max-w-md">
          <span className="sr-only">{t('lp.assets.chooseLesson')}</span>
          <select
            className="field"
            value={active}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              next.set('lesson', event.target.value);
              setParams(next, { replace: true });
            }}
          >
            {grouped.map(([key, group]) => (
              <optgroup key={key} label={group.name}>
                {group.lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {active && (
          <Link to={`/learning-production/courses/${courseId}/lessons/${active}`} className="btn-ghost btn-sm">
            <ArrowUpRight size={14} />
            {t('lp.assets.openLesson')}
          </Link>
        )}
      </div>

      {active && <AssetBoard key={active} courseId={courseId} lessonId={active} />}
    </>
  );
}

function AssetBoard({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLpQuery<AssetBoardResponse>(paths.assetBoard(lessonId));

  useEffect(() => {
    document.getElementById('lp-asset-board')?.scrollIntoView({ block: 'nearest' });
  }, [lessonId]);

  if (loading && !data) return <SkeletonRows rows={2} height="h-56" />;
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return null;

  const byType = new Map(data.assets.map((asset) => [asset.assetType, asset]));

  return (
    <div id="lp-asset-board">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-surface-line bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold text-ink">{data.lesson.name}</p>
          <p className="text-[12px] text-ink-faint">
            {data.lesson.moduleName ? `${data.lesson.moduleName} · ` : ''}
            {t('lp.assets.complete', { done: data.progress.complete, total: data.progress.total })}
          </p>
        </div>
        <Chip tone={data.progress.percent === 100 ? 'ok' : 'neutral'}>{data.progress.percent}%</Chip>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {STAGES.map((type) => {
          const asset = byType.get(type);
          return asset ? <AssetCard key={type} asset={asset} courseId={courseId} lessonId={lessonId} people={data.people} /> : null;
        })}
      </div>
    </div>
  );
}

function AssetCard({
  asset,
  courseId,
  lessonId,
  people,
}: {
  asset: BoardAsset;
  courseId: string;
  lessonId: string;
  people: AssetBoardResponse['people'];
}) {
  const { t } = useI18n();
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-surface-line bg-white">
      <div className="h-1" style={{ background: STAGE_HEX[asset.assetType] }} aria-hidden="true" />
      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-start justify-between gap-2">
          <StageTag type={asset.assetType} />
          {asset.openComments > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-accent-700" title={t('lp.openComments', { n: asset.openComments })}>
              <MessageSquare size={11} aria-hidden="true" />
              {asset.openComments}
            </span>
          )}
        </div>

        <h3 className="mt-2 text-[13.5px] font-bold text-ink">{t(`lp.asset.title.${asset.assetType}` as StringKey)}</h3>

        <Preview asset={asset} />

        <div className="mt-auto space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={asset.status} blocked={asset.blocked} size="sm" />
            {asset.currentVersionNumber ? <Chip tone="neutral">{t('lp.assets.version', { n: asset.currentVersionNumber })}</Chip> : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            <PersonChip userId={asset.assigneeUserId} people={people} size={20} />
            <DueChip dueDate={asset.dueDate} dueState={asset.dueState} />
          </div>
          <Link to={assetRoute(courseId, lessonId, asset.assetType)} className="btn-ghost btn-sm w-full">
            {t('lp.assets.open')}
          </Link>
        </div>
      </div>
    </article>
  );
}

/** The 100px window onto the content — a different drawing for every stage. */
function Preview({ asset }: { asset: BoardAsset }) {
  const { t } = useI18n();
  const preview = asset.preview;
  const frame = 'my-2.5 overflow-hidden rounded-xl border border-surface-line';

  if (!preview) {
    return (
      <div className={cx(frame, 'grid h-[104px] place-items-center bg-surface-bg px-3 text-center text-[11.5px] text-ink-faint')}>
        {asset.blocked ? t('lp.assets.waitingOn', { stages: asset.waitingFor.map((type) => t(stageKey(type))).join('، ') }) : t('lp.assets.noVersion')}
      </div>
    );
  }

  if (preview.kind === 'OUTLINE') {
    return (
      <div className={cx(frame, 'h-[104px] overflow-hidden bg-stage-outlineBg/60 p-2.5')}>
        {preview.sections.slice(0, 1).map((section) => (
          <p key={section.key} className="text-[10.5px] font-extrabold uppercase tracking-wide text-stage-outline">
            {t(`lp.outline.${section.key}` as StringKey)}
          </p>
        ))}
        <ul className="mt-1 space-y-0.5">
          {preview.sections.slice(0, 3).map((section) => (
            <li key={section.key} className="line-clamp-1 text-[11px] leading-relaxed text-ink-muted">
              • {section.text}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (preview.kind === 'PPT') {
    return (
      <div className={cx(frame, 'grid h-[104px] place-items-center bg-surface-bg p-2')}>
        <div className="aspect-video w-[74%] rounded-md border border-surface-line bg-white p-2 shadow-sm">
          <span className="block h-[5px] w-[85%] rounded bg-stage-ppt/50" />
          <span className="mt-1 block h-[5px] w-[60%] rounded bg-stage-ppt/25" />
          <span className="mt-1 block h-[5px] w-[70%] rounded bg-ink/10" />
          <span className="mt-1 block h-[5px] w-[45%] rounded bg-ink/10" />
        </div>
      </div>
    );
  }

  if (preview.kind === 'SCRIPT') {
    const block = preview.blocks[0];
    return (
      <div className={cx(frame, 'h-[104px] overflow-hidden bg-stage-scriptBg/60 p-2.5')}>
        <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-stage-script">
          {block?.title || t(`lp.script.mode.${preview.mode}` as StringKey)}
        </p>
        <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-muted">{block?.narration || t('lp.assets.noNarration')}</p>
      </div>
    );
  }

  if (preview.kind === 'VOICE_OVER') {
    return (
      <div className={cx(frame, 'relative grid h-[104px] place-items-center bg-stage-voiceBg/60 p-2')}>
        <Waveform seed={asset.id} />
        <span className="absolute bottom-1.5 end-2 inline-flex items-center gap-1 text-[10.5px] font-bold tabular-nums text-stage-voice">
          <FileAudio2 size={11} aria-hidden="true" />
          {clock(preview.durationSeconds)}
        </span>
      </div>
    );
  }

  return (
    <div className={cx(frame, 'grid h-[104px] place-items-center bg-surface-bg p-2')}>
      <div className="relative grid aspect-video w-[84%] place-items-center rounded-lg" style={{ background: 'linear-gradient(135deg,#0B2545,#12497A)' }}>
        <Play size={20} className="text-white/90" aria-hidden="true" />
        <span className="absolute bottom-1 end-1.5 rounded bg-black/40 px-1 text-[10px] font-bold tabular-nums text-white">{clock(preview.durationSeconds)}</span>
      </div>
    </div>
  );
}

/**
 * The bars a voice-over card shows.
 *
 * Derived from the asset's own id, so the same recording draws the same shape
 * on every screen and every reload. It is a *sign* that this asset is audio —
 * not a rendering of the waveform, which only the player knows.
 */
function Waveform({ seed }: { seed: string }) {
  const bars = useMemo(() => {
    let state = 0;
    for (let index = 0; index < seed.length; index += 1) state = (state * 31 + seed.charCodeAt(index)) >>> 0;
    return Array.from({ length: 30 }, () => {
      state = (state * 1103515245 + 12345) >>> 0;
      return 22 + ((state >>> 8) % 45);
    });
  }, [seed]);

  return (
    <span className="flex h-[58px] items-center gap-[3px]" aria-hidden="true">
      {bars.map((height, index) => (
        <span key={index} className="block w-[3px] rounded-full bg-stage-voice/70" style={{ height: `${height}%` }} />
      ))}
    </span>
  );
}

/** m:ss for a duration a card prints; an em dash when nothing recorded it. */
function clock(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
