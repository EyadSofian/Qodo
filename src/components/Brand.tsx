/**
 * The Engosoft lockup.
 *
 * `/logo.png` and `/logo-white.png` are the company's own files, dropped in
 * untouched — never redrawn, recoloured or traced. Only the surface underneath
 * decides which of the two is used.
 */

import { cx } from '../lib/utils';

interface LogoProps {
  /** `color` for light surfaces, `white` for navy ones. */
  tone?: 'color' | 'white';
  /** Rendered height in px; width follows the file's 1073×353 ratio. */
  height?: number;
  className?: string;
}

export function Logo({ tone = 'color', height = 30, className }: LogoProps) {
  return (
    <img
      src={tone === 'white' ? '/logo-white.png' : '/logo.png'}
      alt="Engosoft"
      height={height}
      style={{ height, width: 'auto' }}
      className={cx('select-none object-contain', className)}
      draggable={false}
    />
  );
}

/**
 * The "e" mark on its own, for square slots the full lockup can't fit — the
 * avatar corner, the login card, a browser tab. Same geometry as favicon.svg.
 */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={cx('shrink-0', className)}
      role="img"
      aria-label="Engosoft"
    >
      <defs>
        <linearGradient id="engosoft-mark" x1="14" y1="12" x2="80" y2="86" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2AA7F0" />
          <stop offset="0.55" stopColor="#0F72D8" />
          <stop offset="1" stopColor="#0B4FA8" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="22" fill="#0A2540" />
      <path
        d="M74 66 A28 28 0 1 1 78 44"
        stroke="url(#engosoft-mark)"
        strokeWidth="13"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M42 50 H78" stroke="#FFFFFF" strokeWidth="13" strokeLinecap="round" fill="none" />
      <circle cx="28" cy="80" r="4.6" fill="#2AA7F0" />
    </svg>
  );
}
