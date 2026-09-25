/**
 * The recruitment team as a row you can move through.
 *
 * Native scroll with snap points does the heavy lifting — trackpad swipes,
 * touch swipes and momentum all come free and feel like the platform. On top
 * of it: mouse dragging (with snapping suspended while the pointer is down so
 * the row follows the hand, then restored to settle on a card), arrow
 * buttons, arrow keys (reversed in Arabic, where "next" is to the left),
 * Home/End, and dots. Four cards fit on a desktop, fewer as the screen narrows.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { shortName, useHRText } from '../../format';
import type { RecruiterCardData } from '../../types';
import { useMotion } from '../../ui/motion';
import { RecruiterCard } from './RecruiterCard';

const DRAG_THRESHOLD = 6;

export function RecruiterCarousel({ cards, onOpen }: { cards: RecruiterCardData[]; onOpen: (card: RecruiterCardData) => void }) {
  const { t, dir, lang } = useHRText();
  const motionPresets = useMotion();
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const drag = useRef<{ x: number; scroll: number; moved: boolean; pointer: number } | null>(null);
  const suppressClick = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const rtl = dir === 'rtl';

  const slides = () => Array.from(track.current?.querySelectorAll<HTMLElement>('[data-slide]') ?? []);

  /** How far from the reading-start edge a slide sits, in either direction. */
  const offsetOf = useCallback((element: HTMLElement) => {
    const container = track.current!;
    const box = container.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return rtl ? box.right - rect.right : rect.left - box.left;
  }, [rtl]);

  const measure = useCallback(() => {
    const container = track.current;
    if (!container) return;
    const items = slides();
    let nearest = 0;
    let best = Infinity;
    items.forEach((item, index) => {
      const distance = Math.abs(offsetOf(item));
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    setActive(nearest);
    const max = container.scrollWidth - container.clientWidth;
    const position = Math.abs(container.scrollLeft);
    setCanPrev(position > 4);
    setCanNext(position < max - 4);
  }, [offsetOf]);

  useEffect(() => {
    measure();
    const container = track.current;
    if (!container) return undefined;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [measure, cards.length]);

  const goTo = useCallback((index: number) => {
    const items = slides();
    const target = items[Math.max(0, Math.min(items.length - 1, index))];
    const container = track.current;
    if (!target || !container) return;
    const delta = offsetOf(target);
    container.scrollBy({ left: rtl ? -delta : delta, behavior: motionPresets.reduce ? 'auto' : 'smooth' });
  }, [offsetOf, rtl, motionPresets.reduce]);

  const step = (direction: 1 | -1) => goTo(active + direction);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward) { event.preventDefault(); step(1); }
    else if (event.key === backward) { event.preventDefault(); step(-1); }
    else if (event.key === 'Home') { event.preventDefault(); goTo(0); }
    else if (event.key === 'End') { event.preventDefault(); goTo(cards.length - 1); }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !track.current) return;
    drag.current = { x: event.clientX, scroll: track.current.scrollLeft, moved: false, pointer: event.pointerId };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const container = track.current;
    if (!state || !container) return;
    const dx = event.clientX - state.x;
    if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!state.moved) {
      state.moved = true;
      container.setPointerCapture(state.pointer);
      // Snapping fights a hand-held drag; it comes back on release.
      container.style.scrollSnapType = 'none';
      container.style.scrollBehavior = 'auto';
    }
    container.scrollLeft = state.scroll - dx;
  };

  const endDrag = () => {
    const state = drag.current;
    const container = track.current;
    drag.current = null;
    if (!state || !container) return;
    if (state.moved) {
      suppressClick.current = true;
      container.style.scrollSnapType = '';
      container.style.scrollBehavior = '';
      measure();
      requestAnimationFrame(() => goTo(activeRef.current));
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
  };

  if (!cards.length) return null;
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;

  return (
    <div className="relative" role="region" aria-roledescription={t('شريط عرض', 'carousel')} aria-label={t('فريق التوظيف', 'Recruitment team')}>
      <div className="mb-3 flex items-center justify-end gap-1.5">
        <span className="me-auto text-[12px] tabular-nums text-ink-faint" aria-live="polite">
          {t(`${active + 1} من ${cards.length}`, `${active + 1} of ${cards.length}`)}
        </span>
        <button type="button" onClick={() => step(-1)} disabled={!canPrev} className="grid h-8 w-8 place-items-center rounded-lg border border-[#E6ECF3] bg-white text-navy transition-opacity hover:bg-surface-sunken disabled:opacity-40" aria-label={t('السابق', 'Previous')}>
          <Prev size={16} />
        </button>
        <button type="button" onClick={() => step(1)} disabled={!canNext} className="grid h-8 w-8 place-items-center rounded-lg border border-[#E6ECF3] bg-white text-navy transition-opacity hover:bg-surface-sunken disabled:opacity-40" aria-label={t('التالي', 'Next')}>
          <Next size={16} />
        </button>
      </div>

      <div
        ref={track}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        className={cx(
          'no-scrollbar -mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 pb-3 pt-2 outline-none',
          'cursor-grab select-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F6F8FB] rounded-2xl'
        )}
        aria-label={t('استخدم الأسهم للتنقل بين أعضاء الفريق', 'Use the arrow keys to move between team members')}
      >
        {cards.map((card, index) => (
          <div
            key={card.member.employeeCode}
            data-slide
            role="group"
            aria-roledescription={t('شريحة', 'slide')}
            aria-label={t(`${index + 1} من ${cards.length}: ${shortName(card.member.shortName, lang)}`, `${index + 1} of ${cards.length}: ${shortName(card.member.shortName, lang)}`)}
            className="w-[84%] shrink-0 snap-start sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2rem)/3)] xl:w-[calc((100%-3rem)/4)]"
          >
            <RecruiterCard card={card} active={index === active} onOpen={() => onOpen(card)} />
          </div>
        ))}
      </div>

      {cards.length > 1 && (
        <div className="mt-1 flex justify-center gap-1.5" aria-hidden="true">
          {cards.map((card, index) => (
            <button
              key={card.member.employeeCode}
              type="button"
              tabIndex={-1}
              onClick={() => goTo(index)}
              className={cx('h-1.5 rounded-full transition-all duration-200', index === active ? 'w-5 bg-navy' : 'w-1.5 bg-slate-300 hover:bg-slate-400')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
