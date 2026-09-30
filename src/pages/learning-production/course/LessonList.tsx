/**
 * The lessons of a course, on the course page.
 *
 * One line per lesson under its module: its name, one sentence saying what
 * happens next and with whom, and five small marks for its files in
 * production order (outline, slides, script, voice-over, video). A line opens
 * the lesson. Editing the structure and assigning in bulk open over the page
 * from the buttons above the list.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ListPlus, Pencil, Table2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { paths } from '../../../lib/learningProduction/api';
import { useLpQuery } from '../../../lib/learningProduction/hooks';
import { STAGES, stageKey } from '../../../lib/learningProduction/format';
import type { AssetSummary, AssetType, CourseCapabilities, MatrixLesson, MatrixResponse } from '../../../lib/learningProduction/types';
import { ErrorNote, LoadingRows } from '../../../components/learning-production/studio';
import { nextStep } from './CourseLessons';

function pipTone(asset: AssetSummary | undefined) {
  if (!asset) return undefined;
  if (asset.applicable === false) return 'na';
  if (asset.status === 'APPROVED' || asset.status === 'LOCKED') return 'ok';
  if (['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'].includes(asset.status)) return 'review';
  if (asset.status === 'CHANGES_REQUESTED') return 'attention';
  if (asset.status === 'IN_PROGRESS') return 'progress';
  return undefined;
}

export function LessonList({ courseId, capabilities, onOpen }: { courseId: string; capabilities: CourseCapabilities; onOpen: (panel: 'lessons' | 'matrix', add?: boolean) => void }) {
  const { t, dir } = useI18n();
  const { data, error, loading, reload } = useLpQuery<MatrixResponse>(paths.matrix(courseId));

  const groups = useMemo(() => {
    if (!data) return [];
    const list = data.modules.map((module) => ({ id: module.id as string | null, name: module.name, lessons: [] as MatrixLesson[] }));
    const byId = new Map(list.map((group) => [group.id, group]));
    const loose = { id: null as string | null, name: t('lp.noModule'), lessons: [] as MatrixLesson[] };
    for (const lesson of data.lessons) (lesson.moduleId ? byId.get(lesson.moduleId) ?? loose : loose).lessons.push(lesson);
    for (const group of list) group.lessons.sort((a, b) => a.sortOrder - b.sortOrder);
    return [...list, ...(loose.lessons.length ? [loose] : [])].filter((group) => group.lessons.length > 0);
  }, [data, t]);

  const types: readonly AssetType[] = data?.assetTypes?.length ? data.assetTypes : STAGES;
  const complete = data?.lessons.filter((lesson) => lesson.state === 'COMPLETE').length ?? 0;
  let number = 0;

  return (
    <section className="lps-panel" aria-labelledby="lp-lessons">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3.5 sm:px-5" style={{ borderColor: 'var(--lps-line)' }}>
        <div>
          <h2 id="lp-lessons" className="text-[16px] font-bold">
            {t('lp.course.lessons')}
          </h2>
          {data && data.lessons.length > 0 && <p className="mt-0.5 text-[12.5px] lps-muted">{t('lp.course.lessonsDone', { done: complete, total: data.lessons.length })}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {capabilities.assignAny && (
            <button type="button" className="lps-btn-quiet" onClick={() => onOpen('matrix')}>
              <Table2 size={15} aria-hidden="true" />
              {t('lp.course.assignAll')}
            </button>
          )}
          {(capabilities.editLessons || capabilities.createLessons) && (
            <button type="button" className="lps-btn-quiet" onClick={() => onOpen('lessons')}>
              <Pencil size={15} aria-hidden="true" />
              {t('lp.course.editLessons')}
            </button>
          )}
          {capabilities.createLessons && (
            <button type="button" className="lps-btn" onClick={() => onOpen('lessons', true)}>
              <ListPlus size={15} aria-hidden="true" />
              {t('lp.lessons.add')}
            </button>
          )}
        </div>
      </header>

      {error && !data ? (
        <div className="p-4">
          <ErrorNote error={error} onRetry={reload} />
        </div>
      ) : loading && !data ? (
        <LoadingRows rows={4} />
      ) : !data || data.lessons.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-[14.5px] font-semibold">{t('lp.lessons.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] lps-muted">{t('lp.lessons.emptyBody')}</p>
        </div>
      ) : (
        <>
          <p className="px-4 pt-3 text-[12px] lps-faint sm:px-5">{t('lp.course.pipsHint', { order: types.map((type) => t(stageKey(type))).join(dir === 'rtl' ? ' ← ' : ' → ') })}</p>
          {groups.map((group) => (
            <div key={group.id ?? 'loose'} className="pt-2">
              {groups.length > 1 && <h3 className="lps-bidi px-4 pb-1 pt-2 text-[12.5px] font-bold lps-muted sm:px-5">{group.name}</h3>}
              <ul className="lps-list">
                {group.lessons.map((lesson) => {
                  number += 1;
                  const step = nextStep(lesson, types, data.people, t);
                  const approved = types.filter((type) => pipTone(lesson.assets[type]) === 'ok').length;
                  const applicable = types.filter((type) => lesson.assets[type] && lesson.assets[type]?.applicable !== false).length;
                  return (
                    <li key={lesson.id}>
                      <Link to={`/learning-production/courses/${courseId}/lessons/${lesson.id}`} className="lps-line">
                        <span className="w-6 shrink-0 text-center text-[12.5px] font-semibold lps-faint">{number}</span>
                        <span className="min-w-0 flex-1">
                          <span className="lps-bidi block truncate text-[14px] font-semibold">{lesson.name}</span>
                          {step.text && <span className={`mt-0.5 block truncate text-[12.5px] ${step.tone}`}>{step.text}</span>}
                        </span>
                        <span className="hidden shrink-0 items-center gap-2.5 sm:flex">
                          <span className="lps-pips">
                            {types.map((type) => (
                              <span key={type} data-tone={pipTone(lesson.assets[type])} title={`${t(stageKey(type))} — ${lesson.assets[type] ? t(`lp.status.${lesson.assets[type]!.status}` as never) : '—'}`} />
                            ))}
                          </span>
                          <span className="w-9 text-end text-[12.5px] font-semibold lps-muted">
                            {approved}/{applicable}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
