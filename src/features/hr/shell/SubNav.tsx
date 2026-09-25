/**
 * An area's own sections (Recruitment, Personnel). The underline glides to
 * the chosen section and the content below slides in the direction of travel.
 */

import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cx } from '../../../lib/utils';
import { useHRText } from '../format';
import type { HRAccess, Localised } from '../types';
import { useMotion } from '../ui/motion';
import { AnimatedOutlet } from './HRLayout';
import { useHR } from './HRContext';

export interface SubNavItem {
  to: string;
  end?: boolean;
  label: Localised;
  visible: (access: HRAccess) => boolean;
}

/** The section a path belongs to — the longest matching `to`, so `/requests/42` stays under Requests. */
export function subKey(items: SubNavItem[], pathname: string) {
  const [root] = items;
  const match = [...items].reverse().find((item) => item.to !== root.to && (pathname === item.to || pathname.startsWith(`${item.to}/`)));
  return match?.to ?? root.to;
}

export function SubNavLayout({ items, label, layoutId }: { items: SubNavItem[]; label: Localised; layoutId: string }) {
  const { access } = useHR();
  const { pick } = useHRText();
  const motionPresets = useMotion();
  const visible = items.filter((item) => (access ? item.visible(access) : false));
  return (
    <div>
      <nav aria-label={pick(label)} className="no-scrollbar -mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="hr-glass inline-flex min-w-max gap-1 rounded-2xl p-1.5">
          {visible.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => cx('relative inline-flex h-10 items-center rounded-xl px-4 text-[13px] font-semibold transition-colors duration-200', isActive ? 'text-white' : 'text-slate-600 hover:bg-white/70 hover:text-navy')}
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId={layoutId}
                        className="absolute inset-0 rounded-xl bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] shadow-[0_10px_22px_-12px_rgb(var(--hr-a1)/0.9)]"
                        transition={motionPresets.spring}
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative">{pick(item.label)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <AnimatedOutlet keyOf={(pathname) => subKey(items, pathname)} order={(pathname) => items.findIndex((item) => item.to === subKey(items, pathname))} />
    </div>
  );
}
