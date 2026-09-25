/**
 * The HR rail: a deep navy-to-indigo sheet where every area carries its own
 * colour, so the way around HR is readable at a glance. Full labels from
 * 1024px; a compact icon rail on tablets that opens on demand; hidden on
 * phones, where the bottom navigation takes over. The active marker glides
 * between items rather than blinking from one to the next.
 */

import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { useHRText } from '../format';
import { useMotion } from '../ui/motion';
import { AREA_THEME, gradient, type Area } from '../ui/theme';
import { useHR } from './HRContext';
import { HR_NAV } from './nav';

export function HRSidebar({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { access } = useHR();
  const { t, pick } = useHRText();
  const motionPresets = useMotion();
  const items = access ? HR_NAV.filter((item) => item.visible(access)) : HR_NAV.slice(0, 1);

  return (
    <aside
      className={cx(
        'sticky top-[calc(var(--topbar-h)+var(--sat))] hidden h-[calc(100dvh-var(--topbar-h)-var(--sat))] shrink-0 flex-col overflow-hidden text-white md:flex',
        'bg-[linear-gradient(180deg,#0B2545_0%,#172E6B_48%,#2A1B6E_100%)] shadow-[inset_-1px_0_0_rgb(255_255_255/0.08),12px_0_40px_-28px_rgb(15_23_42/0.6)]',
        'transition-[width] duration-200 ease-out',
        expanded ? 'w-64' : 'w-[76px] lg:w-64'
      )}
      aria-label={t('أقسام الموارد البشرية', 'HR sections')}
    >
      {/* A little colour in the dark: two soft glows behind the list. */}
      <span aria-hidden="true" className="pointer-events-none absolute -start-16 top-10 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgb(124_58_237/0.45),transparent_65%)] blur-2xl" />
      <span aria-hidden="true" className="pointer-events-none absolute -end-20 bottom-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgb(56_189_248/0.3),transparent_65%)] blur-2xl" />

      <div className={cx('relative flex items-center gap-3 px-4 pb-4 pt-5', !expanded && 'justify-center px-0 lg:justify-start lg:px-4')}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6366F1,#C026D3)] shadow-[0_10px_24px_-10px_rgb(192_38_211/0.8)]">
          <Sparkles size={18} aria-hidden="true" />
        </span>
        <span className={cx('min-w-0', !expanded && 'hidden lg:block')}>
          <span className="block truncate text-[15px] font-bold">{t('الموارد البشرية', 'Human Resources')}</span>
          <span className="block text-[11px] font-semibold text-white/55">HR V2 · Odoo</span>
        </span>
      </div>

      <nav className="relative flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {items.map((item) => {
          const theme = AREA_THEME[item.id as Area] ?? AREA_THEME.home;
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.end}
              title={pick(item.label)}
              className={({ isActive }) => cx(
                'group relative flex h-11 items-center gap-3 rounded-2xl px-2.5 text-[13.5px] font-semibold outline-none transition-colors',
                isActive ? 'text-white' : 'text-white/70 hover:bg-white/[0.07] hover:text-white',
                !expanded && 'justify-center px-0 lg:justify-start lg:px-2.5'
              )}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="hr-nav-active"
                      className="absolute inset-0 rounded-2xl border border-white/15 bg-white/[0.12] shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] backdrop-blur"
                      transition={motionPresets.spring}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={cx('relative grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105', isActive && 'shadow-[0_8px_18px_-8px_rgb(0_0_0/0.6)]')}
                    style={{ backgroundImage: gradient(theme), opacity: isActive ? 1 : 0.85 }}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  {/* `max-lg:sr-only`, not `sr-only lg:not-sr-only`: the latter resets
                      the label to position: static at lg, and the active pill then
                      paints over it. */}
                  <span className={cx('relative truncate', !expanded && 'max-lg:sr-only')}>{pick(item.label)}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={onToggle}
        className="relative m-3 hidden h-9 items-center justify-center gap-2 rounded-xl text-[12px] font-semibold text-white/70 hover:bg-white/10 hover:text-white md:flex lg:hidden"
        aria-expanded={expanded}
        aria-label={expanded ? t('تصغير القائمة', 'Collapse menu') : t('توسيع القائمة', 'Expand menu')}
      >
        {expanded ? <PanelLeftClose size={16} className="rtl:rotate-180" /> : <PanelLeftOpen size={16} className="rtl:rotate-180" />}
      </button>
    </aside>
  );
}
