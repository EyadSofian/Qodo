/**
 * One course. Loads it once and gives its tabs a stable frame, so moving from
 * Lessons to Production is a route change rather than a reload.
 */

import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { Activity, FolderOpen, LayoutGrid, ListTree, Settings2, SquareStack, Users } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx, formatDate } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { HEALTH_TONE, healthKey } from '../../lib/learningProduction/format';
import type { CourseDetail } from '../../lib/learningProduction/types';
import { Chip, ErrorPanel, PageHeader, PersonChip, ProgressBar, SkeletonRows } from '../../components/learning-production/kit';

export interface CourseOutlet {
  detail: CourseDetail;
  reload: () => Promise<void>;
}

export function useCourse() {
  return useOutletContext<CourseOutlet>();
}

export function CourseWorkspace() {
  const { courseId = '' } = useParams();
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useLpQuery<CourseDetail>(paths.course(courseId));

  if (loading && !data) {
    return (
      <>
        <div className="skeleton mb-4 h-20 w-full" />
        <SkeletonRows rows={5} />
      </>
    );
  }
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return null;

  const { course, capabilities } = data;
  const tabs = [
    { to: '', end: true, label: t('lp.tab.overview'), icon: LayoutGrid },
    { to: 'lessons', label: t('lp.tab.lessons'), icon: ListTree },
    { to: 'production', label: t('lp.tab.production'), icon: SquareStack },
    { to: 'team', label: t('lp.tab.team'), icon: Users },
    { to: 'files', label: t('lp.tab.files'), icon: FolderOpen },
    { to: 'activity', label: t('lp.tab.activity'), icon: Activity },
    ...(capabilities.edit || capabilities.archive ? [{ to: 'settings', label: t('lp.tab.settings'), icon: Settings2 }] : []),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('lp.nav.courses'), to: '/learning-production/courses' }, { label: course.name }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {course.name}
            {course.code && <span className="ltr rounded-md bg-surface-sunken px-1.5 py-0.5 text-[12px] font-semibold text-ink-muted">{course.code}</span>}
          </span>
        }
        meta={
          <>
            <Chip tone={HEALTH_TONE[course.health]}>{t(healthKey(course.health))}</Chip>
            {course.status === 'ON_HOLD' && <Chip tone="warn">{t('lp.course.onHold')}</Chip>}
            {course.archivedAt && <Chip tone="neutral">{t('lp.course.archivedChip')}</Chip>}
            <span className="flex items-center gap-2 text-[12.5px] text-ink-muted">
              <span className="w-24">
                <ProgressBar value={course.progress} label={t('lp.progress')} />
              </span>
              <span className="font-semibold tabular-nums text-ink">{course.progress}%</span>
            </span>
            <span className="text-[12.5px] text-ink-muted">
              <PersonChip userId={course.managerUserId} people={data.people} size={20} />
            </span>
            {course.targetDate && (
              <span className="text-[12.5px] text-ink-muted">
                {t('lp.course.target')}: {formatDate(course.targetDate, lang)}
              </span>
            )}
          </>
        }
      />
      <nav aria-label={t('lp.course.sections')} className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b border-surface-line">
        {tabs.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to || 'overview'}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-semibold',
                isActive ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-muted hover:text-ink'
              )
            }
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ detail: data, reload } satisfies CourseOutlet} />
    </>
  );
}
