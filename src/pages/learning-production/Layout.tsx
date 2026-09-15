/**
 * E-Learning Production — the module frame.
 *
 * Its own dark vertical rail, full height under the workspace top bar — a
 * deliberate one-off next to every other module's horizontal tab strip. A
 * production team lives on these five screens all day, and the per-stage
 * colors used throughout the module (see `format.ts`'s `STAGE_COLOR`) read
 * more clearly against one calm dark surface than fighting the light app
 * chrome above them.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, ClipboardCheck, Database, GraduationCap, Inbox, LayoutDashboard, Library, Menu, X, type LucideIcon } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { cx } from '../../lib/utils';
import { ApiError } from '../../lib/api';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import type { CourseWithStats, DashboardResponse, Me } from '../../lib/learningProduction/types';
import { Avatar } from '../../components/ui';
import { EmptyPanel } from '../../components/learning-production/kit';

const MeContext = createContext<Me | null>(null);

export function useLpMe() {
  return useContext(MeContext);
}

interface NavTab {
  to: string;
  end: boolean;
  key: StringKey;
  icon: LucideIcon;
}

const PRIMARY_NAV: NavTab[] = [
  { to: '/learning-production', end: true, key: 'lp.nav.dashboard', icon: LayoutDashboard },
  { to: '/learning-production/courses', end: false, key: 'lp.nav.courses', icon: Library },
  { to: '/learning-production/my-work', end: false, key: 'lp.nav.myWork', icon: Inbox },
  { to: '/learning-production/reviews', end: false, key: 'lp.nav.reviews', icon: ClipboardCheck },
];

export function LearningProductionLayout() {
  const { t } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: me, error } = useLpQuery<Me>(paths.me);
  // Same cache entry Dashboard.tsx reads — the rail piggybacks on it for
  // "my work"/"reviews" badge counts rather than adding a bespoke endpoint.
  const { data: summary } = useLpQuery<DashboardResponse>(paths.dashboard);
  const { data: recentData } = useLpQuery<{ courses: CourseWithStats[] }>(paths.courses({ sort: 'recent' }));

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const unavailable = error instanceof ApiError && error.status === 503;
  const tabs: NavTab[] = [...PRIMARY_NAV, ...(me?.canViewReports ? [{ to: '/learning-production/reports', end: false, key: 'lp.nav.reports' as StringKey, icon: BarChart3 }] : [])];
  const badges: Record<string, number> = {
    '/learning-production/my-work': summary?.mine?.assigned ?? 0,
    '/learning-production/reviews': summary?.mine?.reviews ?? 0,
  };
  const recentCourses = (recentData?.courses ?? []).slice(0, 4);

  return (
    <MeContext.Provider value={me}>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex items-center justify-between border-b border-surface-line bg-white px-4 py-3 lg:hidden">
          <span className="flex items-center gap-2 text-[13.5px] font-bold text-ink">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-navy text-white">
              <GraduationCap size={15} aria-hidden="true" />
            </span>
            {t('lp.module')}
          </span>
          <button type="button" className="btn-ghost btn-sm !min-h-9 !px-2.5" aria-label={t('lp.sidebar.menu')} onClick={() => setDrawerOpen(true)}>
            <Menu size={18} aria-hidden="true" />
          </button>
        </div>

        <aside className="hidden w-[248px] shrink-0 flex-col bg-navy text-white lg:flex">
          <RailContent t={t} tabs={tabs} badges={badges} recentCourses={recentCourses} user={user} />
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-navy/40" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
            <div className="absolute inset-y-0 start-0 flex w-[84%] max-w-[300px] flex-col bg-navy text-white shadow-panel">
              <div className="flex items-center justify-end px-3 pt-3">
                <button type="button" className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label={t('lp.sidebar.close')} onClick={() => setDrawerOpen(false)}>
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <RailContent t={t} tabs={tabs} badges={badges} recentCourses={recentCourses} user={user} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6">
            {unavailable ? <EmptyPanel icon={<Database size={26} />} title={t('lp.unavailable.title')} body={t('lp.unavailable.body')} /> : <Outlet />}
          </div>
        </div>
      </div>
    </MeContext.Provider>
  );
}

/** Shared between the desktop rail and the mobile drawer so they never drift. */
function RailContent({
  t,
  tabs,
  badges,
  recentCourses,
  user,
  onNavigate,
}: {
  t: (key: StringKey) => string;
  tabs: NavTab[];
  badges: Record<string, number>;
  recentCourses: CourseWithStats[];
  user: { name: string; title: string | null; avatarColor: string } | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10">
          <GraduationCap size={18} aria-hidden="true" />
        </span>
        <span className="truncate text-[14px] font-bold">{t('lp.module')}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <nav aria-label={t('lp.module')} className="flex flex-col gap-0.5 px-3">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg border-s-2 px-3 py-2.5 text-[13.5px] font-semibold transition-colors',
                  isActive ? 'border-brand-400 bg-white/10 text-white' : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
                )
              }
            >
              <tab.icon size={17} aria-hidden="true" />
              <span className="flex-1 truncate">{t(tab.key)}</span>
              {Boolean(badges[tab.to]) && (
                <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-bold text-white">
                  {badges[tab.to]}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {recentCourses.length > 0 && (
          <div className="mt-5 flex min-h-0 flex-1 flex-col px-3">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">{t('lp.sidebar.recentCourses')}</p>
            <div className="lp-rail-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2">
              {recentCourses.map((course) => (
                <Link
                  key={course.id}
                  to={`/learning-production/courses/${course.id}`}
                  onClick={onNavigate}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] text-white/70 hover:bg-white/5 hover:text-white"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />
                  <span className="truncate">{course.name}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={user?.name ?? ''} color={user?.avatarColor ?? '#94A3B8'} size={32} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-white">{user?.name}</p>
            {user?.title && <p className="truncate text-[11.5px] text-white/50">{user.title}</p>}
          </div>
        </div>
      </div>
    </>
  );
}
