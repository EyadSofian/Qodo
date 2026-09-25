import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * `/hr/payroll#gaps` lands on the gaps section. The router does not scroll to
 * a hash by itself, and the section only exists once the data has arrived.
 */
export function useHashScroll(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [ready, hash]);
}
