/**
 * HR V2's frame: sidebar, header, the animated content region, the phone
 * navigation and the alert centre. Moving between areas never reloads the
 * page — the outlet slides ±10px in the direction of travel down the rail.
 */

import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useOutlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useHRText } from '../format';
import { useMotion } from '../ui/motion';
import { AlertsDrawer } from '../recruitment/components/AlertsDrawer';
import { RecruitmentAlertToasts } from '../recruitment/components/RecruitmentAlert';
import { HRHeader } from './HRHeader';
import { HRMobileNavigation } from './HRMobileNavigation';
import { HRSidebar } from './HRSidebar';
import { HRProvider, useHR } from './HRContext';
import { navIndex } from './nav';
import { AREA_THEME, areaOf } from '../ui/theme';

function AuthorizedOutlet() {
  const { access, accessError } = useHR();
  const { pathname } = useLocation();
  if (!access && !accessError) return null;
  const requestsArea = Boolean(access?.requests) && /^\/hr\/recruitment(\/requests(\/|$)|$)/.test(pathname);
  if (access?.performanceOnly && pathname !== '/hr/performance' && !requestsArea) return <Navigate to="/hr/performance" replace />;
  return <AnimatedOutlet keyOf={sectionOf} order={navIndex} />;
}

/** The top-level area, so moving inside Recruitment is not an HR-level transition. */
function sectionOf(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  return `/${parts.slice(0, 2).join('/')}`;
}

/**
 * The routed page, sliding in from the direction of travel.
 *
 * Enter-only on purpose. An exit phase (`AnimatePresence mode="wait"`) holds
 * the next page until the old one has faded, and when a second navigation
 * lands mid-exit — two quick clicks, or a tab in the background where frames
 * are paused — framer-motion can leave the old page parked at opacity 0 and
 * never mount the new one. A keyed enter animation cannot get stuck: the new
 * page replaces the old at once and eases in.
 */
export function AnimatedOutlet({ keyOf, order }: { keyOf: (pathname: string) => string; order: (pathname: string) => number }) {
  const location = useLocation();
  const outlet = useOutlet();
  const { dir } = useHRText();
  const motionPresets = useMotion();
  const key = keyOf(location.pathname);
  const previous = useRef({ key, index: order(location.pathname), direction: 1 as 1 | -1 });

  if (previous.current.key !== key) {
    const index = order(location.pathname);
    previous.current = { key, index, direction: index >= previous.current.index ? 1 : -1 };
  }

  // In Arabic "forward" travels leftwards.
  const signed = (dir === 'rtl' ? -previous.current.direction : previous.current.direction) as 1 | -1;
  const preset = motionPresets.page(signed);
  return (
    <motion.div key={key} initial={preset.initial} animate={preset.animate} transition={preset.transition}>
      {outlet}
    </motion.div>
  );
}

/**
 * The quiet backdrop behind every HR page: a cool grey with one faint wash of
 * the current area's colour along the top, and a fine dot grid. No moving
 * blobs — the colour lives in the heroes and actions, not behind the text.
 */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#F3F5F9]">
      <div className="absolute inset-x-0 top-0 h-[420px] transition-[background] duration-700" style={{ background: 'linear-gradient(180deg, rgb(var(--hr-a1) / 0.07), transparent)' }} />
      <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(rgb(15_23_42/0.06)_1px,transparent_1px)] [background-size:24px_24px]" />
    </div>
  );
}

export function HRLayout() {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();
  const area = areaOf(location.pathname);
  useEffect(() => {
    setExpanded(false);
  }, [location.pathname]);

  // The theme lives on <body> while HR is open, so dialogs and drawers —
  // which portal there — wear it too; it leaves with the module.
  useEffect(() => {
    const body = document.body;
    body.classList.add('hr-theme');
    return () => {
      body.classList.remove('hr-theme');
      body.style.removeProperty('--hr-a1');
      body.style.removeProperty('--hr-a2');
      delete body.dataset.hrArea;
    };
  }, []);
  useEffect(() => {
    const theme = AREA_THEME[area];
    document.body.style.setProperty('--hr-a1', theme.a1);
    document.body.style.setProperty('--hr-a2', theme.a2);
    document.body.dataset.hrArea = area;
  }, [area]);

  return (
    <HRProvider>
      <div className="relative isolate min-h-[calc(100dvh-var(--topbar-h)-var(--sat))]">
        <Backdrop />
        <div className="mx-auto flex w-full max-w-[1680px]">
          <HRSidebar expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
          <div className="min-w-0 flex-1">
            <HRHeader />
            <div className="px-4 pb-28 pt-5 sm:px-6 md:pb-12 lg:px-8">
              <AuthorizedOutlet />
            </div>
          </div>
        </div>
        <HRMobileNavigation />
        <AlertsDrawer />
        <RecruitmentAlertToasts />
      </div>
    </HRProvider>
  );
}

export default HRLayout;
