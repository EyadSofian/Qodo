/**
 * One course. Loads it once and gives its tabs a stable frame, so moving from
 * Content to Production is a route change rather than a reload.
 *
 * The header is the course's identity card: cover, name, and one line of the
 * four facts a production manager asks for first — how many lessons, how far
 * along, when it is due, and whose course it is. Everything else about the
 * course lives behind a tab.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { FolderOpen, Link2, ListPlus, MoreHorizontal, Settings2 } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { cx, formatDate } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { HEALTH_TONE, healthKey } from '../../lib/learningProduction/format';
import type { CourseDetail } from '../../lib/learningProduction/types';
import { useToast } from '../../components/ui';
import { Chip, CourseCover, ErrorPanel, PersonChip, SkeletonRows } from '../../components/learning-production/kit';

export interface CourseOutlet {
  detail: CourseDetail;
  reload: () => Promise<void>;
}

export function useCourse() {
  return useOutletContext<CourseOutlet>();
}

interface Tab {
  to: string;
  end?: boolean;
  key: StringKey;
}

export function CourseWorkspace() {
  const { courseId = '' } = useParams();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useLpQuery<CourseDetail>(paths.course(courseId));

  if (loading && !data) {
    return (
      <>
        <div className="skeleton mb-4 h-24 w-full" />
        <SkeletonRows rows={5} />
      </>
    );
  }
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return null;

  const { course, capabilities } = data;
  const tabs: Tab[] = [
    { to: '', end: true, key: 'lp.tab.overview' },
    { to: 'lessons', key: 'lp.tab.content' },
    { to: 'production', key: 'lp.tab.production' },
    { to: 'assets', key: 'lp.tab.assets' },
    { to: 'team', key: 'lp.tab.team' },
    { to: 'activity', key: 'lp.tab.activity' },
    { to: 'files', key: 'lp.tab.files' },
    ...(capabilities.edit || capabilities.archive ? [{ to: 'settings', key: 'lp.tab.settings' as StringKey }] : []),
  ];

  const facts = [
    t('lp.course.lessonsCount', { n: course.stats.lessons }),
    t('lp.course.completedShare', { n: course.progress }),
    course.targetDate ? `${t('lp.course.target')}: ${formatDate(course.targetDate, lang)}` : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <nav aria-label="breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-[12px] text-ink-faint">
        <Link to="/learning-production/courses" className="hover:text-brand-600 hover:underline">
          {t('lp.nav.courses')}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="max-w-[18rem] truncate text-ink-muted">{course.name}</span>
      </nav>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        {/* Full width on a phone so the actions wrap underneath rather than
            squeezing the course name into a column. */}
        <div className="flex w-full min-w-0 items-center gap-4 sm:w-auto sm:flex-1">
          <CourseCover courseId={course.id} name={course.name} hasCover={course.hasCover} stamp={course.updatedAt} size={68} />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-[26px] font-extrabold leading-tight tracking-tight text-ink">
              {course.name}
              {course.code && <span className="ltr rounded-md bg-surface-sunken px-1.5 py-0.5 text-[12px] font-semibold text-ink-muted">{course.code}</span>}
            </h1>
            {/* One sentence rather than a row of flex items: at phone width a
                row puts every fact — and every separator — on its own line. */}
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              {facts.join(' · ')}
              <span className="ms-1.5 inline-flex items-center gap-1.5 align-middle">
                · {t('lp.course.manager')}:
                <PersonChip userId={course.managerUserId} people={data.people} size={20} />
              </span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip tone={HEALTH_TONE[course.health]}>{t(healthKey(course.health))}</Chip>
              {course.status === 'ON_HOLD' && <Chip tone="warn">{t('lp.course.onHold')}</Chip>}
              {course.archivedAt && <Chip tone="neutral">{t('lp.course.archivedChip')}</Chip>}
              {course.isDemo && <Chip tone="neutral">{t('lp.course.demo')}</Chip>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(window.location.href)
                .then(() => toast.push(t('lp.course.linkCopied')))
                .catch(() => toast.push(t('lp.error.GENERIC'), 'bad'));
            }}
          >
            <Link2 size={14} />
            {t('lp.course.share')}
          </button>
          <CourseMenu courseId={courseId} canEdit={capabilities.edit || capabilities.archive} />
          {capabilities.createLessons && (
            <button type="button" className="btn-primary btn-sm" onClick={() => navigate(`/learning-production/courses/${courseId}/lessons?add=1`)}>
              <ListPlus size={15} />
              {t('lp.lessons.add')}
            </button>
          )}
        </div>
      </header>

      <nav aria-label={t('lp.course.sections')} className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b border-surface-line">
        {tabs.map(({ to, end, key }) => (
          <NavLink
            key={to || 'overview'}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                '-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-[13px]',
                isActive ? 'border-brand-500 font-bold text-ink' : 'border-transparent font-semibold text-ink-muted hover:text-ink'
              )
            }
          >
            {t(key)}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ detail: data, reload } satisfies CourseOutlet} />
    </>
  );
}

/** The header's overflow: the destinations that are not worth a tab-strip slot. */
function CourseMenu({ courseId, canEdit }: { courseId: string; canEdit: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button type="button" className="btn-ghost btn-sm !px-2.5" aria-haspopup="menu" aria-expanded={open} aria-label={t('lp.course.more')} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute end-0 top-full z-40 mt-1 w-52 rounded-xl border border-surface-line bg-white p-1 shadow-panel animate-pop-in">
          <Link role="menuitem" to={`/learning-production/courses/${courseId}/files`} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink hover:bg-surface-bg" onClick={() => setOpen(false)}>
            <FolderOpen size={14} aria-hidden="true" />
            {t('lp.tab.files')}
          </Link>
          {canEdit && (
            <Link role="menuitem" to={`/learning-production/courses/${courseId}/settings`} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink hover:bg-surface-bg" onClick={() => setOpen(false)}>
              <Settings2 size={14} aria-hidden="true" />
              {t('lp.tab.settings')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
