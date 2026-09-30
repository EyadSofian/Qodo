/**
 * E-Learning Production — the module frame.
 *
 * A plain bar under the workspace header — the module's name, its five
 * places (Dashboard, Courses, My Work, Reviews, Reports) with the counts that
 * matter to the reader, and the one thing a manager starts from here, a new
 * production run — over a plain, light canvas.
 *
 * The colours live on <body> (class `lp-theme`, `--lp-a1` / `--lp-a2`) while
 * the module is open, so drawers, which portal there, wear them too. A page
 * with its own colours (a course takes its scenario's) sets them through
 * `useLpTheme`.
 *
 * The counts come from the same My Work response the My Work page reads, so
 * the badge and the page can never disagree.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, Database, Layers, PanelTopClose, PanelTopOpen, Plus, Settings2 } from 'lucide-react';
import { useShellChrome } from '../../components/Shell';
import { useI18n } from '../../lib/i18n';
import { ApiError } from '../../lib/api';
import { paths } from '../../lib/learningProduction/api';
import { runPaths } from '../../lib/learningProduction/runApi';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { AREA_THEME, areaOf, type LpTheme } from '../../lib/learningProduction/theme';
import type { Me } from '../../lib/learningProduction/types';
import type { MyWork2Response } from '../../lib/learningProduction/runTypes';
import { EmptyNote, RouteTabs } from '../../components/learning-production/studio';

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

  const tabs = useMemo(
    () => [
      { to: '/learning-production', end: true, label: t('lp.nav.dashboard') },
      { to: '/learning-production/courses', label: t('lp.nav.courses') },
      { to: '/learning-production/my-work', label: t('lp.nav.myWork'), count: work?.counts.now, attention: Boolean(work?.counts.overdue) },
      { to: '/learning-production/reviews', label: t('lp.nav.reviews'), count: work?.counts.review, attention: Boolean(work?.counts.review) },
      ...(me?.canViewReports ? [{ to: '/learning-production/reports', label: t('lp.nav.reports') }] : []),
    ],
    [t, work, me]
  );

  return (
    <MeContext.Provider value={me}>
      <ThemeContext.Provider value={setOverride}>
        <div className="lps flex min-h-0 flex-1 flex-col" dir={dir}>
          <div className="lps-bar sticky top-0 z-20">
            <div className="mx-auto flex w-full max-w-[1480px] items-center gap-3 px-4 sm:px-6">
              <Link to="/learning-production" className="hidden shrink-0 items-center gap-2.5 md:flex" aria-label={t('lp.module')}>
                <span className="lps-logo">
                  <Layers size={17} aria-hidden="true" />
                </span>
                <span className="font-display text-[14.5px] font-bold">{t('lp.module')}</span>
              </Link>
              <div className="min-w-0 flex-1 md:ms-3">
                <RouteTabs items={tabs} label={t('lp.module')} />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {chrome && (
                  <button
                    type="button"
                    className="lps-btn-quiet !px-2"
                    onClick={() => chrome.setHidden(!chrome.hidden)}
                    title={chrome.hidden ? t('lp.chrome.show') : t('lp.chrome.hide')}
                    aria-label={chrome.hidden ? t('lp.chrome.show') : t('lp.chrome.hide')}
                    aria-pressed={!chrome.hidden}
                  >
                    {chrome.hidden ? <PanelTopOpen size={16} aria-hidden="true" /> : <PanelTopClose size={16} aria-hidden="true" />}
                  </button>
                )}
                <Link to="/learning-production/guide" className="lps-btn-quiet !px-2" title={t('lp.nav.guide')}>
                  <BookOpen size={16} aria-hidden="true" />
                  <span className="hidden xl:inline">{t('lp.nav.guide')}</span>
                </Link>
                {me?.canManageTemplates && (
                  <Link to="/learning-production/templates" className="lps-btn-quiet !px-2" title={t('lp.nav.templates')}>
                    <Settings2 size={16} aria-hidden="true" />
                    <span className="hidden xl:inline">{t('lp.nav.templates')}</span>
                  </Link>
                )}
                {me?.canCreateRun && (
                  <Link to="/learning-production/runs/new" className="lps-btn-primary">
                    <Plus size={15} aria-hidden="true" />
                    <span className="hidden sm:inline">{t('lp.run.new')}</span>
                  </Link>
                )}
              </div>
            </div>
          </div>

          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-6 sm:py-6">
              {unavailable ? (
                <div className="lps-panel">
                  <EmptyNote icon={Database} title={t('lp.unavailable.title')} body={t('lp.unavailable.body')} />
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </main>
        </div>
      </ThemeContext.Provider>
    </MeContext.Provider>
  );
}
