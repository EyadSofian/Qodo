/**
 * Motion for HR V2 — short, springy, and off when the reader asked for less.
 *
 * Everything sits in the 180–320ms band: long enough to show where something
 * went, short enough never to be waited on. `useReducedMotion` collapses every
 * preset to an instant change, so a person with reduced motion set gets the
 * same states with none of the travel.
 */

import { useReducedMotion, type Transition } from 'framer-motion';

export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 };
export const EASE_OUT: Transition = { duration: 0.22, ease: [0.22, 1, 0.36, 1] };
const INSTANT: Transition = { duration: 0 };

export function useMotion() {
  const reduce = Boolean(useReducedMotion());
  return {
    reduce,
    spring: reduce ? INSTANT : SPRING,
    ease: reduce ? INSTANT : EASE_OUT,
    /** Section change: the new content slides 10px in from the direction of travel. */
    page: (direction: 1 | -1) => ({
      initial: reduce ? { opacity: 0 } : { opacity: 0, x: 10 * direction },
      animate: { opacity: 1, x: 0 },
      transition: reduce ? INSTANT : { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
    }),
    /** A popover or toast arriving from just above its resting place. */
    pop: {
      initial: reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.96 },
      transition: reduce ? INSTANT : { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
    },
  };
}
