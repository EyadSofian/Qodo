import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cx } from '../../../lib/utils';
import { useMotion } from './motion';

/**
 * Frosted pill tabs with a gradient marker that glides to the chosen tab —
 * the in-page counterpart of the area sub-navigation. `count` puts a small
 * figure after the label; `wrap` lets a long set break into rows from tablet
 * width up instead of scrolling (phones always scroll one row).
 */
export function PillTabs<T extends string>({ value, onChange, options, label, layoutId, className, wrap = false }: { value: T; onChange: (value: T) => void; options: Array<{ id: T; label: ReactNode; icon?: ReactNode; count?: ReactNode }>; label: string; layoutId: string; className?: string; wrap?: boolean }) {
  const motionPresets = useMotion();
  return (
    <div className={cx('no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}>
      <div role="tablist" aria-label={label} className={cx('hr-glass inline-flex min-w-max gap-1 rounded-2xl p-1.5', wrap && 'sm:flex sm:min-w-0 sm:flex-wrap')}>
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(option.id)}
              className={cx('relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold transition-colors duration-200', active ? 'text-white' : 'text-slate-600 hover:bg-white/70 hover:text-navy')}
            >
              {active && (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 rounded-xl bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] shadow-[0_10px_22px_-12px_rgb(var(--hr-a1)/0.9)]"
                  transition={motionPresets.spring}
                  aria-hidden="true"
                />
              )}
              <span className="relative inline-flex items-center gap-1.5">
                {option.icon}
                {option.label}
                {option.count !== undefined && (
                  <span className={cx('rounded-full px-1.5 text-[10.5px] font-bold tabular-nums transition-colors', active ? 'bg-white/25 text-white' : 'bg-[rgb(var(--hr-a1)/0.1)] text-[rgb(var(--hr-a1))]')}>{option.count}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
