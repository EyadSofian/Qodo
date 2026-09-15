/**
 * E-Learning Production — the module frame.
 *
 * Five destinations and no more: Dashboard, Courses, My Work, Reviews and
 * Reports. The strip sits under the workspace bar on every module screen, so
 * somebody who followed a notification into one PPT is one click from their
 * whole inbox.
 */

import { createContext, useContext } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, ClipboardCheck, Database, Inbox, LayoutDashboard, Library } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/utils';
import { ApiError } from '../../lib/api';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import type { Me } from '../../lib/learningProduction/types';
import { EmptyPanel } from '../../components/learning-production/kit';

const MeContext = createContext<Me | null>(null);

export function useLpMe() {
  return useContext(MeContext);
}

export function LearningProductionLayout() {
  const { t } = useI18n();
  const { data: me, error } = useLpQuery<Me>(paths.me);

  const unavailable = error instanceof ApiError && error.status === 503;
  const tabs = [
    { to: '/learning-production', end: true, label: t('lp.nav.dashboard'), icon: LayoutDashboard },
    { to: '/learning-production/courses', end: false, label: t('lp.nav.courses'), icon: Library },
    { to: '/learning-production/my-work', end: false, label: t('lp.nav.myWork'), icon: Inbox },
    { to: '/learning-production/reviews', end: false, label: t('lp.nav.reviews'), icon: ClipboardCheck },
    ...(me?.canViewReports ? [{ to: '/learning-production/reports', end: false, label: t('lp.nav.reports'), icon: BarChart3 }] : []),
  ];

  return (
    <MeContext.Provider value={me}>
      <div className="border-b border-surface-line bg-white/90">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <span className="hidden shrink-0 py-3 text-[13px] font-bold text-ink lg:block">{t('lp.module')}</span>
          <nav aria-label={t('lp.module')} className="no-scrollbar -mb-px flex flex-1 gap-1 overflow-x-auto">
            {tabs.map(({ to, end, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx(
                    'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-[13px] font-semibold transition-colors',
                    isActive ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-muted hover:text-ink'
                  )
                }
              >
                <Icon size={15} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6">
        {unavailable ? (
          <EmptyPanel icon={<Database size={26} />} title={t('lp.unavailable.title')} body={t('lp.unavailable.body')} />
        ) : (
          <Outlet />
        )}
      </div>
    </MeContext.Provider>
  );
}
