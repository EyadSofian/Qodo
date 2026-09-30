/**
 * E-Learning Production — the courses.
 *
 * A card per course: its name, where its production is now, how much of its
 * lesson content is approved, when it is due and whether it is on time. A
 * search box and one filter are all it takes to find a course.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Library, Search } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { paths } from '../../lib/learningProduction/api';
import { useDebounced, useLpQuery, useSessionState } from '../../lib/learningProduction/hooks';
import type { CourseWithStats, People } from '../../lib/learningProduction/types';
import { Dot, EmptyNote, ErrorNote, LoadingRows, Meter, useDay, usePick, type DotTone } from '../../components/learning-production/studio';

type View = 'active' | 'hold' | 'archived';

const HEALTH_DOT: Record<string, DotTone> = { ON_TRACK: 'ok', COMPLETED: 'ok', AT_RISK: 'attention', DELAYED: 'danger' };

export function Courses() {
  const { t } = useI18n();
  const [view, setView] = useSessionState<View>('lpstudio:courses.view', 'active');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const { data, error, loading, reload } = useLpQuery<{ courses: CourseWithStats[]; people: People; canCreate: boolean }>(
    paths.courses({ q, sort: 'target', status: view === 'hold' ? 'ON_HOLD' : view === 'active' ? 'ACTIVE' : undefined, archived: view === 'archived' })
  );
  const courses = data?.courses ?? [];

  return (
    <div className="lps-stagger space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="lps-title">{t('lp.courses.title')}</h1>
          <p className="mt-1.5 text-[14.5px] lps-muted">{data ? t('lp.courses.count', { n: courses.length }) : ' '}</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <label className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
            <span className="sr-only">{t('common.search')}</span>
            <Search size={15} aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 lps-faint" />
            <input className="lps-input ps-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('lp.courses.search')} />
          </label>
          <select className="lps-input !w-auto" value={view} onChange={(event) => setView(event.target.value as View)} aria-label={t('lp.courses.show')}>
            <option value="active">{t('lp.courses.active')}</option>
            <option value="hold">{t('lp.courses.onHold')}</option>
            <option value="archived">{t('lp.courses.archived')}</option>
          </select>
        </div>
      </header>

      {error ? (
        <ErrorNote error={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="lps-panel">
          <LoadingRows />
        </div>
      ) : courses.length === 0 ? (
        <div className="lps-panel">
          <EmptyNote icon={Library} title={q ? t('lp.courses.noMatch') : t('lp.courses.empty')} body={q ? undefined : t('lp.courses.emptyBody')} />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CourseCard({ course }: { course: CourseWithStats }) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const run = course.run;
  const legacy = run?.scenario === 'LEGACY';
  const where = run?.status === 'ON_HOLD'
    ? t('lp.runStatus.ON_HOLD')
    : run?.status === 'RELEASED'
      ? t('lp.runStatus.RELEASED')
      : run?.currentStage
        ? pick(run.currentStage.label)
        : legacy
          ? t('lp.courses.legacyWhere')
          : run
            ? t(`lp.runStatus.${run.status}` as StringKey)
            : t('lp.courses.noRun');
  const hasContent = course.stats.totalAssets > 0;

  return (
    <li>
      <Link to={`/learning-production/courses/${course.id}`} className="lps-panel lps-lift flex h-full flex-col gap-3 p-4 sm:p-5">
        <span className="min-w-0">
          <span className="lps-bidi block truncate text-[15.5px] font-bold">{course.name}</span>
          <span className="mt-0.5 block truncate text-[12.5px] lps-faint">
            {[course.code, run ? t(`lp.scenarioShort.${run.scenario}` as StringKey) : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="text-[13.5px]">
          <span className="lps-muted">{t('lp.courses.now')} </span>
          <span className="font-semibold">{where}</span>
        </span>
        <span className="mt-auto space-y-2">
          <span className="flex items-center gap-2">
            <Meter value={course.progress} tone="ok" label={t('lp.col.content')} />
            <span className="w-10 shrink-0 text-end text-[12.5px] font-semibold">{hasContent ? `${course.progress}%` : '—'}</span>
          </span>
          <span className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <span className="lps-muted">{course.targetDate ? t('lp.courses.due', { day: day(course.targetDate) }) : t('lp.courses.lessons', { n: course.stats.lessons })}</span>
            {run?.status === 'ACTIVE' && !legacy && <Dot tone={HEALTH_DOT[course.health] ?? 'idle'}>{t(`lp.health.${course.health}` as StringKey)}</Dot>}
          </span>
        </span>
      </Link>
    </li>
  );
}
