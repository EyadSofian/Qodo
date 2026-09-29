/**
 * E-Learning Production — the course catalogue.
 *
 * A course is the long-lived identity; this list shows each one with the run
 * currently in flight (or its latest), where that run is, and how much of its
 * lesson content is approved. Search, a status filter and a sort — nothing
 * more is needed to find a course.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Library, Plus, Search } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { paths } from '../../lib/learningProduction/api';
import { useDebounced, useLpQuery, useSessionState } from '../../lib/learningProduction/hooks';
import type { CourseWithStats, People } from '../../lib/learningProduction/types';
import {
  Choice,
  EmptyNote,
  ErrorNote,
  LoadingRows,
  Meter,
  PageHero,
  Panel,
  PersonLine,
  RunStatusPill,
  ScenarioBadge,
  useDay,
  usePick,
} from '../../components/learning-production/studio';

type View = 'active' | 'hold' | 'archived';

export function Courses() {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const navigate = useNavigate();
  const [view, setView] = useSessionState<View>('lpstudio:courses.view', 'active');
  const [sort, setSort] = useSessionState('lpstudio:courses.sort', 'recent');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const { data, error, loading, reload } = useLpQuery<{ courses: CourseWithStats[]; people: People; canCreate: boolean }>(
    paths.courses({ q, sort, status: view === 'hold' ? 'ON_HOLD' : view === 'active' ? 'ACTIVE' : undefined, archived: view === 'archived' })
  );
  const courses = data?.courses ?? [];

  return (
    <div className="lps-stagger space-y-4">
      <PageHero
        icon={Library}
        title={t('lp.courses.title')}
        lede={t('lp.courses.lede')}
        actions={
          data?.canCreate ? (
            <Link to="/learning-production/runs/new" className="lps-btn-primary">
              <Plus size={15} aria-hidden="true" />
              {t('lp.run.new')}
            </Link>
          ) : undefined
        }
      />

      <Panel
        bodyClassName="p-0"
        title={
          <Choice<View>
            label={t('lp.courses.title')}
            value={view}
            onChange={setView}
            options={[
              { value: 'active', label: t('lp.courses.active') },
              { value: 'hold', label: t('lp.courses.onHold') },
              { value: 'archived', label: t('lp.courses.archived') },
            ]}
          />
        }
        action={
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <label className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
              <span className="sr-only">{t('common.search')}</span>
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 lps-faint" />
              <input className="lps-input !py-1.5 ps-8" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('lp.courses.search')} />
            </label>
            <select className="lps-input !w-auto !py-1.5" value={sort} onChange={(event) => setSort(event.target.value)} aria-label={t('lp.courses.sort')}>
              {['recent', 'name', 'target', 'progress'].map((value) => (
                <option key={value} value={value}>
                  {t(`lp.courses.sort.${value}` as StringKey)}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {error ? (
          <div className="p-4">
            <ErrorNote error={error} onRetry={reload} />
          </div>
        ) : loading && !data ? (
          <LoadingRows />
        ) : courses.length === 0 ? (
          <EmptyNote icon={Library} title={q ? t('lp.courses.noMatch') : t('lp.courses.empty')} body={q ? undefined : t('lp.courses.emptyBody')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="lps-table min-w-[880px]">
              <thead>
                <tr>
                  <th className="sticky start-0 z-[2]">{t('lp.col.course')}</th>
                  <th>{t('lp.col.run')}</th>
                  <th>{t('lp.col.stage')}</th>
                  <th className="text-center">{t('lp.col.lessons')}</th>
                  <th className="w-[150px]">{t('lp.col.content')}</th>
                  <th>{t('lp.col.target')}</th>
                  <th>{t('lp.col.manager')}</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id} className="lps-row-link" onClick={() => navigate(`/learning-production/courses/${course.id}`)}>
                    <td className="sticky start-0 z-[1] bg-white">
                      <Link to={`/learning-production/courses/${course.id}`} className="block max-w-[280px] hover:underline" onClick={(event) => event.stopPropagation()}>
                        <span className="lps-bidi block truncate font-semibold">{course.name}</span>
                        {course.code && <span className="text-[11.5px] lps-faint">{course.code}</span>}
                      </Link>
                    </td>
                    <td>
                      {course.run ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <ScenarioBadge scenario={course.run.scenario} short />
                          <RunStatusPill status={course.run.status} />
                        </span>
                      ) : (
                        <span className="text-[12.5px] lps-faint">{t('lp.courses.noRun')}</span>
                      )}
                    </td>
                    <td className="max-w-[220px] truncate text-[12.5px]">
                      {course.run?.currentStage ? pick(course.run.currentStage.label) : course.run?.scenario === 'LEGACY' ? <span className="lps-muted">{t('lp.run.legacyNoStages')}</span> : '—'}
                    </td>
                    <td className="text-center">{course.stats.lessons}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Meter value={course.progress} tone="ok" label={t('lp.col.content')} />
                        <span className="w-9 shrink-0 text-end text-[12px] font-semibold">{course.stats.totalAssets ? `${course.progress}%` : '—'}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-[12.5px]">{day(course.targetDate)}</td>
                    <td>
                      <PersonLine userId={course.managerUserId} people={data?.people ?? {}} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
