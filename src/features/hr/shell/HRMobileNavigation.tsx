/**
 * Phone navigation for HR: the four areas this person uses most, and "More"
 * for the rest — replacing the workspace's own bottom bar while inside HR.
 */

import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MoreHorizontal, X } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { useHRText } from '../format';
import { useMotion } from '../ui/motion';
import { AREA_THEME, gradient, type Area } from '../ui/theme';
import { useHR } from './HRContext';
import { HR_NAV } from './nav';

export function HRMobileNavigation() {
  const { access } = useHR();
  const { t, pick } = useHRText();
  const location = useLocation();
  const motionPresets = useMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const items = access ? HR_NAV.filter((item) => item.visible(access)) : HR_NAV.slice(0, 1);
  const primary = items.slice(0, items.length > 5 ? 4 : 5);
  const rest = items.slice(primary.length);
  const moreActive = rest.some((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/70 bg-white/70 pb-safe shadow-[0_-10px_30px_-20px_rgb(30_41_99/0.5)] backdrop-blur-xl md:hidden" aria-label={t('أقسام الموارد البشرية', 'HR sections')}>
        <div className="flex items-stretch justify-around px-1">
          {primary.map((item) => {
            const Icon = item.icon;
            const theme = AREA_THEME[item.id as Area] ?? AREA_THEME.home;
            return (
              <NavLink
                key={item.id}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cx('flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[10.5px] font-semibold transition-colors', isActive ? 'text-navy' : 'text-slate-500')}
              >
                {({ isActive }) => (
                  <>
                    <span className={cx('grid h-8 w-10 place-items-center rounded-xl transition-all duration-200', isActive ? 'text-white shadow-[0_8px_16px_-8px_rgb(15_23_42/0.5)]' : '')} style={isActive ? { backgroundImage: gradient(theme) } : undefined}>
                      <Icon size={19} aria-hidden="true" />
                    </span>
                    <span className="max-w-full truncate px-1">{pick(item.label)}</span>
                  </>
                )}
              </NavLink>
            );
          })}
          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cx('flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[10.5px] font-semibold', moreActive ? 'text-navy' : 'text-slate-500')}
              aria-expanded={moreOpen}
            >
              <span className={cx('grid h-8 w-10 place-items-center rounded-xl', moreActive && 'bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] text-white')}>
                <MoreHorizontal size={19} aria-hidden="true" />
              </span>
              {t('المزيد', 'More')}
            </button>
          )}
        </div>
      </nav>

      <AnimatePresence>
        {moreOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <motion.div className="absolute inset-0 bg-navy/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionPresets.ease} onClick={() => setMoreOpen(false)} aria-hidden="true" />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={t('المزيد من أقسام HR', 'More HR sections')}
              className="absolute inset-x-0 bottom-0 rounded-t-3xl p-4 pb-safe"
              initial={motionPresets.reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={motionPresets.reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
              transition={motionPresets.spring}
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[14px] font-bold text-navy">{t('المزيد', 'More')}</p>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-surface-sunken" onClick={() => setMoreOpen(false)} aria-label={t('إغلاق', 'Close')}>
                  <X size={18} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 pb-2">
                {rest.map((item) => {
                  const Icon = item.icon;
                  const theme = AREA_THEME[item.id as Area] ?? AREA_THEME.home;
                  return (
                    <NavLink key={item.id} to={item.to} className={({ isActive }) => cx('flex items-center gap-2.5 rounded-2xl border px-3 py-3 text-[13px] font-semibold transition-colors', isActive ? 'border-[rgb(var(--hr-a1)/0.4)] bg-[rgb(var(--hr-a1)/0.08)] text-navy' : 'border-white/80 bg-white/70 text-navy')}>
                      <span className="grid h-8 w-8 place-items-center rounded-xl text-white" style={{ backgroundImage: gradient(theme) }}>
                        <Icon size={16} aria-hidden="true" />
                      </span>
                      {pick(item.label)}
                    </NavLink>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
