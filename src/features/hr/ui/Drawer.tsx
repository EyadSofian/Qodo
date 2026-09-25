/**
 * A side sheet — the alerts drawer, "Why this score?", a personnel case. It
 * slides in from the reader's end edge, traps nothing but focus-returns on
 * close, and closes on Escape or a click outside.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useHRText } from '../format';
import { useMotion } from './motion';

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const { t, dir } = useHRText();
  const motionPresets = useMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  // The end edge is the right in English and the left in Arabic.
  const offscreen = dir === 'rtl' ? '-100%' : '100%';

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[65]">
          <motion.div
            className="absolute inset-0 bg-navy/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionPresets.ease}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            className="absolute inset-y-0 end-0 flex w-full flex-col bg-white shadow-panel outline-none"
            style={{ maxWidth: width }}
            initial={motionPresets.reduce ? { opacity: 0 } : { x: offscreen }}
            animate={motionPresets.reduce ? { opacity: 1 } : { x: 0 }}
            exit={motionPresets.reduce ? { opacity: 0 } : { x: offscreen }}
            transition={motionPresets.reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 40 }}
          >
            <header className="flex items-start justify-between gap-3 border-b border-[#E6ECF3] px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-[16px] font-bold text-navy">{title}</h2>
                {subtitle && <p className="mt-0.5 text-[12px] text-[#5A6C82]">{subtitle}</p>}
              </div>
              <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-navy" aria-label={t('إغلاق', 'Close')}>
                <X size={18} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[#E6ECF3] px-5 py-3 pb-safe">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
