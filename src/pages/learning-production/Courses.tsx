/**
 * Courses — every production course this person can see, with its progress
 * and health. Cards, because a studio runs tens of courses, not thousands.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, BookOpen, Plus, Search } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { formatDate, timeAgo } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { useDebounced, useLpQuery } from '../../lib/learningProduction/hooks';
import { HEALTH_TONE, healthKey } from '../../lib/learningProduction/format';
import type { CourseHealth, CourseWithStats, People } from '../../lib/learningProduction/types';
import { Chip, EmptyPanel, ErrorPanel, PageHeader, PersonChip, ProgressBar } from '../../components/learning-production/kit';
import { HealthReasonText } from './course/CourseOverview';

const HEALTHS: CourseHealth[] = ['ON_TRACK', 'AT_RISK', 'DELAYED', 'COMPLETED'];

export function Courses() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 300);
  const health = params.get('health') ?? '';
  const managerId = params.get('manager') ?? '';
  const sort = params.get('sort') ?? 'recent';
  const archived = params.get('archived') === '1';

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const path = paths.courses({ q, health, managerId, sort, archived });
  const { data, error, loading, reload } = useLpQuery<{ courses: CourseWithStats[]; people: People; canCreate: boolean }>(path);

  const managers = useMemo(() => {
    const ids = new Set((data?.courses ?? []).map((course) => course.managerUserId).filter(Boolean) as string[]);
    return [...ids].map((id) => ({ id, name: data?.people[id]?.name ?? id }));
  }, [data]);

  const filtered = Boolean(q || health || managerId);

  return (
    <>
      <PageHeader
        title={t('lp.course.title')}
        description={t('lp.course.subtitle')}
        actions={
          data?.canCreate ? (
            <Link to="/learning-production/courses/new" className="btn-primary btn-sm">
              <Plus size={15} />
              {t('lp.course.new')}
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <span className="sr-only">{t('common.search')}</span>
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="field !ps-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('lp.course.search')} />
        </label>
        <select className="field !w-auto" value={health} onChange={(event) => set('health', event.target.value)} aria-label={t('lp.course.health')}>
          <option value="">{t('lp.course.allHealth')}</option>
          {HEALTHS.map((value) => (
            <option key={value} value={value}>
              {t(healthKey(value))}
            </option>
          ))}
        </select>
        {managers.length > 1 && (
          <select className="field !w-auto" value={managerId} onChange={(event) => set('manager', event.target.value)} aria-label={t('lp.course.manager')}>
            <option value="">{t('lp.course.allManagers')}</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        )}
        <select className="field !w-auto" value={sort} onChange={(event) => set('sort', event.target.value)} aria-label={t('lp.sort')}>
          <option value="recent">{t('lp.sort.recent')}</option>
          <option value="name">{t('lp.sort.name')}</option>
          <option value="target">{t('lp.sort.target')}</option>
          <option value="progress">{t('lp.sort.progress')}</option>
        </select>
        <button type="button" className={archived ? 'btn-navy btn-sm' : 'btn-ghost btn-sm'} onClick={() => set('archived', archived ? '' : '1')} aria-pressed={archived}>
          <Archive size={14} />
          {t('lp.course.archived')}
        </button>
      </div>

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton h-44 rounded-2xl" />
          ))}
        </div>
      ) : error && !data ? (
        <ErrorPanel error={error} onRetry={reload} />
      ) : data && data.courses.length === 0 ? (
        filtered || archived ? (
          <EmptyPanel icon={<Search size={24} />} title={archived ? t('lp.course.noArchived') : t('lp.course.noMatch')} />
        ) : (
          <EmptyPanel
            icon={<BookOpen size={26} />}
            title={t('lp.course.emptyTitle')}
            body={data.canCreate ? t('lp.course.emptyBodyManager') : t('lp.course.emptyBody')}
            action={
              data.canCreate ? (
                <Link to="/learning-production/courses/new" className="btn-primary btn-sm">
                  <Plus size={15} />
                  {t('lp.course.createFirst')}
                </Link>
              ) : null
            }
          />
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data?.courses.map((course) => <CourseCard key={course.id} course={course} people={data.people} />)}
        </div>
      )}
    </>
  );
}

function CourseCard({ course, people }: { course: CourseWithStats; people: People }) {
  const { t, lang } = useI18n();
  return (
    <Link to={`/learning-production/courses/${course.id}`} className="group flex flex-col rounded-2xl border border-surface-line bg-white p-4 transition-colors hover:border-brand-200">
      <div className="flex items-start gap-3">
        {course.hasCover ? (
          <img src={paths.cover(course.id, course.updatedAt)} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <BookOpen size={20} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold text-ink group-hover:text-brand-600">{course.name}</h3>
          <p className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-faint">
            {course.code && <span className="ltr font-semibold">{course.code}</span>}
            <span>{t('lp.course.lessonsCount', { n: course.stats.lessons })}</span>
          </p>
        </div>
        <Chip tone={HEALTH_TONE[course.health]}>{t(healthKey(course.health))}</Chip>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <ProgressBar value={course.progress} label={t('lp.progress')} className="!h-2" />
        <span className="w-10 shrink-0 text-end text-[13px] font-bold tabular-nums text-ink">{course.progress}%</span>
      </div>
      {course.healthReasons[0] && (
        <p className="mt-1.5 line-clamp-1 text-[12px] text-ink-muted">
          <HealthReasonText reason={course.healthReasons[0]} />
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-surface-line pt-3 text-[12px] text-ink-muted" style={{ marginTop: 14 }}>
        <PersonChip userId={course.managerUserId} people={people} size={20} />
        <span className="shrink-0 text-ink-faint">
          {course.targetDate ? `${t('lp.course.target')}: ${formatDate(course.targetDate, lang)}` : course.lastActivityAt ? timeAgo(course.lastActivityAt, t) : ''}
        </span>
      </div>
    </Link>
  );
}
