import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useHRText } from '../format';

/** ‹ March 2026 › — steps a month or a quarter; the arrows follow the reading direction. */
export function Stepper({ label, onPrev, onNext, nextDisabled = false, prevLabel, nextLabel }: { label: ReactNode; onPrev: () => void; onNext: () => void; nextDisabled?: boolean; prevLabel: string; nextLabel: string }) {
  const { dir } = useHRText();
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-white/70 bg-white/90 p-1 text-navy shadow-[0_12px_26px_-16px_rgb(15_23_42/0.55)] backdrop-blur">
      <button type="button" className="grid h-8 w-8 place-items-center rounded-xl text-[rgb(var(--hr-a1))] transition-colors hover:bg-[rgb(var(--hr-a1)/0.1)]" onClick={onPrev} aria-label={prevLabel}><Prev size={16} /></button>
      <span className="min-w-[8.5rem] text-center text-[13px] font-bold text-navy" aria-live="polite">{label}</span>
      <button type="button" className="grid h-8 w-8 place-items-center rounded-xl text-[rgb(var(--hr-a1))] transition-colors hover:bg-[rgb(var(--hr-a1)/0.1)] disabled:text-slate-300 disabled:hover:bg-transparent" disabled={nextDisabled} onClick={onNext} aria-label={nextLabel}><Next size={16} /></button>
    </div>
  );
}
