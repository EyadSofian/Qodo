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
import { BarChart3, Bell, BookOpen, Database, LayoutGrid, Layers, Library, ListTodo, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, PanelTopClose, PanelTopOpen, Plus, Settings2, X } from 'lucide-react';
import { useShellChrome } from '../../components/Shell';
import { useI18n } from '../../lib/i18n';
import { ApiError } from '../../lib/api';
import { cx } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { runPaths } from '../../lib/learningProduction/runApi';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { AREA_THEME, areaOf, type LpTheme } from '../../lib/learningProduction/theme';
import type { CourseWithStats, Me } from '../../lib/learningProduction/types';
import type { MyWork2Response } from '../../lib/learningProduction/runTypes';
import { EmptyNote } from '../../components/learning-production/studio';
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
      { to: '/learning-production', end: true, icon: ListTodo, label: t('lp.nav.home'), count: waiting || undefined, attention: Boolean(work?.counts.overdue) },
      { to: '/learning-production/courses', icon: Library, label: t('lp.nav.courses') },
      ...(me?.canViewReports ? [{ to: '/learning-production/reports', icon: BarChart3, label: t('lp.nav.reports') }] : []),
    ],
    [t, waiting, work, me]
  );
  const { data: active } = useLpQuery<{ courses: CourseWithStats[] }>(paths.courses({ status: 'ACTIVE', sort: 'recent' }));
  const recent = (active?.courses ?? []).slice(0, 5);

  // The rail can fold to icons on a wide screen; on a phone it opens over the page.
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);
  const fold = (value: boolean) => {
    setFolded(value);
    try {
      localStorage.setItem(RAIL_KEY, value ? '1' : '0');
    } catch {
      /* the choice just won't be remembered */
    }
  };

  const rail = (compact: boolean) => (
    <div className={cx('lps-rail-inner', compact && 'lps-rail-compact')}>
      <div className="flex items-center gap-2.5 px-3 pb-4 pt-4">
        <Link to="/learning-production" className="flex min-w-0 flex-1 items-center gap-2.5" aria-label={t('lp.module')}>
          <span className="lps-logo shrink-0">
            <Layers size={17} aria-hidden="true" />
          </span>
          {!compact && <span className="font-display truncate text-[15px] font-bold text-white">{t('lp.module')}</span>}
        </Link>
      </div>

      {me?.canCreateRun && (
        <div className="px-3 pb-4">
          <Link to="/learning-production/runs/new" className="lps-rail-new" title={compact ? t('lp.run.new') : undefined}>
            <Plus size={17} aria-hidden="true" />
            {!compact && <span>{t('lp.run.new')}</span>}
          </Link>
        </div>
      )}

      <nav aria-label={t('lp.module')} className="space-y-1 px-3">
        {places.map((place) => (
          <NavLink key={place.to} to={place.to} end={place.end} className="lps-rail-link isolate" title={compact ? place.label : undefined}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId={compact ? 'lp-rail-c' : 'lp-rail'} className="lps-rail-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <place.icon size={19} aria-hidden="true" className="shrink-0" />
                {!compact && <span className="min-w-0 flex-1 truncate">{place.label}</span>}
                {place.count ? <span className={cx('lps-count', place.attention && 'lps-count-attention', compact && 'lps-rail-badge')}>{place.count}</span> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {!compact && recent.length > 0 && (
        <div className="mt-6 px-3">
          <p className="lps-rail-label">{t('lp.rail.active')}</p>
          <ul className="space-y-0.5">
            {recent.map((course) => (
              <li key={course.id}>
                <NavLink to={`/learning-production/courses/${course.id}`} className="lps-rail-course">
                  <span className="lps-rail-dot" style={{ background: course.health === 'DELAYED' ? '#fb7185' : course.health === 'AT_RISK' ? '#fbbf24' : '#34d399' }} aria-hidden="true" />
                  <span className="lps-bidi min-w-0 flex-1 truncate">{course.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto space-y-1 border-t border-white/10 px-3 pb-3 pt-3">
        <RailButton compact={compact} icon={LayoutGrid} label={t('lp.rail.workspace')} to="/" />
        <RailButton compact={compact} icon={BookOpen} label={t('lp.nav.guide')} to="/learning-production/guide" />
        {me?.canManageTemplates && <RailButton compact={compact} icon={Settings2} label={t('lp.nav.templates')} to="/learning-production/templates" />}
        <RailButton compact={compact} icon={Bell} label={t('lp.prefs.title')} onClick={() => setPrefs(true)} />
        {chrome && (
          <RailButton compact={compact} icon={chrome.hidden ? PanelTopOpen : PanelTopClose} label={chrome.hidden ? t('lp.chrome.show') : t('lp.chrome.hide')} onClick={() => chrome.setHidden(!chrome.hidden)} />
        )}
        <RailButton
          compact={compact}
          className="hidden lg:flex"
          icon={compact ? (dir === 'rtl' ? PanelRightOpen : PanelLeftOpen) : dir === 'rtl' ? PanelRightClose : PanelLeftClose}
          label={compact ? t('lp.rail.expand') : t('lp.rail.collapse')}
          onClick={() => fold(!compact)}
        />
      </div>
    </div>
  );

  return (
    <MeContext.Provider value={me}>
      <ThemeContext.Provider value={setOverride}>
        <div className="lps flex min-h-0 flex-1 flex-col lg:flex-row" dir={dir}>
          {/* Wide screens: the rail on the reading-start side. */}
          <aside className={cx('lps-rail hidden lg:flex', folded ? 'w-[76px]' : 'w-[256px]')} aria-label={t('lp.module')}>
            {rail(folded)}
          </aside>

          {/* Phones and tablets: a slim bar, and the rail over the page. */}
          <div className="lps-bar sticky top-0 z-20 flex items-center gap-2 px-3 py-2 lg:hidden">
            <button type="button" className="lps-btn-quiet !px-2" onClick={() => setMobileOpen(true)} aria-label={t('lp.rail.open')} aria-expanded={mobileOpen}>
              <MenuIcon size={20} aria-hidden="true" />
            </button>
            <Link to="/learning-production" className="flex min-w-0 flex-1 items-center gap-2">
              <span className="lps-logo !h-8 !w-8 shrink-0">
                <Layers size={15} aria-hidden="true" />
              </span>
              <span className="font-display truncate text-[14.5px] font-bold text-white">{t('lp.module')}</span>
            </Link>
            {waiting > 0 && (
              <Link to="/learning-production" className={cx('lps-count', Boolean(work?.counts.overdue) && 'lps-count-attention')}>
                {waiting}
              </Link>
            )}
            {me?.canCreateRun && (
              <Link to="/learning-production/runs/new" className="lps-btn-primary !px-2.5" aria-label={t('lp.run.new')}>
                <Plus size={17} aria-hidden="true" />
              </Link>
            )}
          </div>
          {mobileOpen && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <div className="lps-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />
              <aside className="lps-rail lps-rail-sheet" aria-label={t('lp.module')}>
                <button type="button" className="lps-btn-quiet absolute end-2 top-3 z-10 !px-2 !text-white" onClick={() => setMobileOpen(false)} aria-label={t('common.close')}>
                  <X size={18} aria-hidden="true" />
                </button>
                {rail(false)}
              </aside>
            </div>
          )}

          <main className="lps-canvas min-h-0 min-w-0 flex-1 overflow-y-auto">
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

const RAIL_KEY = 'engosoft.lpRailFolded';

function RailButton({ icon: Icon, label, to, onClick, compact, className }: { icon: typeof Bell; label: string; to?: string; onClick?: () => void; compact: boolean; className?: string }) {
  const body = (
    <>
      <Icon size={18} aria-hidden="true" className="shrink-0" />
      {!compact && <span className="min-w-0 flex-1 truncate">{label}</span>}
    </>
  );
  if (to) {
    return (
      <NavLink to={to} end className={cx('lps-rail-link lps-rail-quiet', className)} title={compact ? label : undefined}>
        {body}
      </NavLink>
    );
  }
  return (
    <button type="button" className={cx('lps-rail-link lps-rail-quiet w-full text-start', className)} onClick={onClick} title={compact ? label : undefined}>
      {body}
    </button>
  );
}
