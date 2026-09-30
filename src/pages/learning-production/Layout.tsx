/**
 * E-Learning Production — the module frame.
 *
 * One plain bar with three places: My tasks (everything waiting for the
 * reader, reviews included), Courses, and — for the people who run
 * production — Reports. A new production run is the one button; the guide,
 * templates, notification settings and the workspace-bar toggle live in a
 * small menu beside it, out of the way.
 *
 * The colours live on <body> (class `lp-theme`, `--lp-a1` / `--lp-a2`) while
 * the module is open, so drawers, which portal there, wear them too. A page
 * with its own colours (a course takes its scenario's) sets them through
 * `useLpTheme`.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bell, BookOpen, Database, Layers, MoreHorizontal, PanelTopClose, PanelTopOpen, Plus, Settings2 } from 'lucide-react';
import { useShellChrome } from '../../components/Shell';
import { useI18n } from '../../lib/i18n';
import { ApiError } from '../../lib/api';
import { cx } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { runPaths } from '../../lib/learningProduction/runApi';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { AREA_THEME, areaOf, type LpTheme } from '../../lib/learningProduction/theme';
import type { Me } from '../../lib/learningProduction/types';
import type { MyWork2Response } from '../../lib/learningProduction/runTypes';
import { EmptyNote, Menu, MenuItem } from '../../components/learning-production/studio';
import { Preferences } from './Preferences';

const MeContext = createContext<Me | null>(null);
const ThemeContext = createContext<(theme: LpTheme | null) => void>(() => {});

export function useLpMe() {
  return useContext(MeContext);
}

/** Give the module a page's own colours while that page is on screen. */
export function useLpTheme(theme: LpTheme | null) {
  const set = useContext(ThemeContext);
  const a1 = theme?.a1;
  const a2 = theme?.a2;
  useEffect(() => {
    set(a1 && a2 ? { a1, a2 } : null);
    return () => set(null);
  }, [set, a1, a2]);
}

export function LearningProductionLayout() {
  const { t, dir } = useI18n();
  const location = useLocation();
  const { data: me, error } = useLpQuery<Me>(paths.me);
  const { data: work } = useLpQuery<MyWork2Response>(runPaths.work);
  const unavailable = error instanceof ApiError && error.status === 503;
  const [override, setOverride] = useState<LpTheme | null>(null);
  const [prefs, setPrefs] = useState(false);
  const chrome = useShellChrome();
  const area = areaOf(location.pathname);
  const theme = override ?? AREA_THEME[area];

  useEffect(() => {
    document.body.classList.add('lp-theme');
    return () => {
      document.body.classList.remove('lp-theme');
      document.body.style.removeProperty('--lp-a1');
      document.body.style.removeProperty('--lp-a2');
    };
  }, []);
  useEffect(() => {
    document.body.style.setProperty('--lp-a1', theme.a1);
    document.body.style.setProperty('--lp-a2', theme.a2);
  }, [theme.a1, theme.a2]);

  // Everything that waits for the reader, in one number: work to do plus
  // decisions to take.
  const waiting = work ? work.counts.now + work.counts.review : 0;
  const places = useMemo(
    () => [
      { to: '/learning-production', end: true, label: t('lp.nav.home'), count: waiting || undefined, attention: Boolean(work?.counts.overdue) },
      { to: '/learning-production/courses', label: t('lp.nav.courses') },
      ...(me?.canViewReports ? [{ to: '/learning-production/reports', label: t('lp.nav.reports') }] : []),
    ],
    [t, waiting, work, me]
  );

  return (
    <MeContext.Provider value={me}>
      <ThemeContext.Provider value={setOverride}>
        <div className="lps flex min-h-0 flex-1 flex-col" dir={dir}>
          <div className="lps-bar sticky top-0 z-20">
            <div className="mx-auto flex w-full max-w-[1280px] items-center gap-2 px-4 sm:gap-4 sm:px-6">
              <Link to="/learning-production" className="hidden shrink-0 items-center gap-2.5 md:flex" aria-label={t('lp.module')}>
                <span className="lps-logo">
                  <Layers size={17} aria-hidden="true" />
                </span>
                <span className="font-display text-[15px] font-bold text-white">{t('lp.module')}</span>
              </Link>
              <nav aria-label={t('lp.module')} className="lps-places min-w-0 flex-1 md:ms-4">
                {places.map((place) => (
                  <NavLink key={place.to} to={place.to} end={place.end} className="lps-place isolate">
                    {({ isActive }) => (
                      <>
                        {isActive && <motion.span layoutId="lp-place" className="lps-place-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                        {place.label}
                        {place.count ? <span className={cx('lps-count', place.attention && 'lps-count-attention')}>{place.count}</span> : null}
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>
              <div className="flex shrink-0 items-center gap-1.5">
                {me?.canCreateRun && (
                  <Link to="/learning-production/runs/new" className="lps-btn-primary">
                    <Plus size={16} aria-hidden="true" />
                    <span className="hidden sm:inline">{t('lp.run.new')}</span>
                  </Link>
                )}
                <Menu label={t('lp.nav.more')} icon={MoreHorizontal} buttonClassName="lps-btn-quiet !px-2">
                  {(close) => (
                    <>
                      <MenuItem icon={BookOpen} label={t('lp.nav.guide')} to="/learning-production/guide" onClick={close} />
                      {me?.canManageTemplates && <MenuItem icon={Settings2} label={t('lp.nav.templates')} to="/learning-production/templates" onClick={close} />}
                      <MenuItem
                        icon={Bell}
                        label={t('lp.prefs.title')}
                        onClick={() => {
                          close();
                          setPrefs(true);
                        }}
                      />
                      {chrome && (
                        <MenuItem
                          icon={chrome.hidden ? PanelTopOpen : PanelTopClose}
                          label={chrome.hidden ? t('lp.chrome.show') : t('lp.chrome.hide')}
                          onClick={() => {
                            close();
                            chrome.setHidden(!chrome.hidden);
                          }}
                        />
                      )}
                    </>
                  )}
                </Menu>
              </div>
            </div>
          </div>

          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 sm:py-7">
              {unavailable ? (
                <div className="lps-panel">
                  <EmptyNote icon={Database} title={t('lp.unavailable.title')} body={t('lp.unavailable.body')} />
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </main>
          {prefs && <Preferences onClose={() => setPrefs(false)} />}
        </div>
      </ThemeContext.Provider>
    </MeContext.Provider>
  );
}
