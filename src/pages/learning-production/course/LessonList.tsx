/**
 * The lessons of a course, on the course page.
 *
 * One line per lesson under its module: its name, one sentence saying what
 * happens next and with whom, and five small marks for its files in
 * production order (outline, slides, script, voice-over, video). A line opens
 * the lesson. Editing the structure and assigning in bulk open over the page
 * from the buttons above the list.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronDown, ListPlus, Pencil, Table2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { paths } from '../../../lib/learningProduction/api';
import { useLpQuery } from '../../../lib/learningProduction/hooks';
import { STAGES, fileTone, stageKey } from '../../../lib/learningProduction/format';
import { cx } from '../../../lib/utils';
import type { AssetType, CourseCapabilities, MatrixLesson, MatrixResponse } from '../../../lib/learningProduction/types';
import { ErrorNote, FilePips, IconChip, LoadingRows, moduleClass } from '../../../components/learning-production/studio';
import { nextStep } from './CourseLessons';

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

  return (
    <section className="space-y-3" aria-labelledby="lp-lessons">
      <header className="lps-panel flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 sm:px-5">
        <div>
          <h2 id="lp-lessons" className="flex items-center gap-2.5 text-[16px] font-bold">
            <IconChip icon={BookOpen} tone="blue" size={15} />
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
        <ErrorNote error={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="lps-panel">
          <LoadingRows rows={4} />
        </div>
      ) : !data || data.lessons.length === 0 ? (
        <div className="lps-panel px-5 py-10 text-center">
          <p className="text-[14.5px] font-semibold">{t('lp.lessons.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] lps-muted">{t('lp.lessons.emptyBody')}</p>
        </div>
      ) : (
        <>
          <p className="px-1 text-[12.5px] lps-muted">{t('lp.course.pipsHint', { order: types.map((type) => t(stageKey(type))).join(dir === 'rtl' ? ' ← ' : ' → ') })}</p>
          {groups.map((group, groupIndex) => (
            <ModuleCard key={group.id ?? 'loose'} index={groupIndex} name={group.name} lessons={group.lessons} startAt={groups.slice(0, groupIndex).reduce((sum, entry) => sum + entry.lessons.length, 0)} types={types} data={data} courseId={courseId} />
          ))}
        </>
      )}
    </section>
  );
}

/** One module: a coloured, numbered header with its progress, and its lessons. Complete modules start folded. */
function ModuleCard({ index, name, lessons, startAt, types, data, courseId }: { index: number; name: string; lessons: MatrixLesson[]; startAt: number; types: readonly AssetType[]; data: MatrixResponse; courseId: string }) {
  const { t } = useI18n();
  const complete = lessons.filter((lesson) => lesson.state === 'COMPLETE').length;
  const [open, setOpen] = useState(complete < lessons.length);
  const percent = lessons.length ? Math.round((complete / lessons.length) * 100) : 0;
  return (
    <section className={cx('lps-module', moduleClass(index))}>
      <button type="button" className="lps-module-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="lps-module-num" aria-hidden="true">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="lps-bidi block truncate text-[15px] font-bold">{name}</span>
          <span className="mt-1 flex items-center gap-2.5 text-[12.5px] lps-muted">
            <span className="lps-module-bar" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </span>
            {t('lp.course.lessonsDone', { done: complete, total: lessons.length })}
          </span>
        </span>
        <ChevronDown size={18} aria-hidden="true" className={cx('shrink-0 lps-faint transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="lps-list">
          {lessons.map((lesson, position) => {
            const step = nextStep(lesson, types, data.people, t);
            const approved = types.filter((type) => fileTone(lesson.assets[type]) === 'ok').length;
            const applicable = types.filter((type) => lesson.assets[type] && lesson.assets[type]?.applicable !== false).length;
            return (
              <li key={lesson.id}>
                <Link to={`/learning-production/courses/${courseId}/lessons/${lesson.id}`} className="lps-line">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: 'var(--mod-soft)', color: 'var(--mod-ink)' }}>
                    {startAt + position + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="lps-bidi block truncate text-[14.5px] font-semibold">{lesson.name}</span>
                    {step.text && <span className={`mt-0.5 block truncate text-[13px] ${step.tone}`}>{step.text}</span>}
                  </span>
                  <span className="hidden shrink-0 items-center gap-2.5 sm:flex">
                    <FilePips types={types} assets={lesson.assets} />
                    <span className="w-9 text-end text-[13px] font-bold lps-muted">
                      {approved}/{applicable}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
