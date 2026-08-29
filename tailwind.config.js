/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Engosoft identity, taken from the logo ────────────────────────
        // The wordmark is navy `ENGO` + electric blue `SOFT`; the "e" mark is a
        // gradient between the two. Same ramp the SLA and HR dashboards use, so
        // moving between apps never feels like changing companies.
        navy: '#0B2545',
        brand: {
          50: '#EFF6FC',
          100: '#D8E9F7',
          200: '#B4D4EF',
          300: '#6FA9DA',
          400: '#4A8FCB',
          500: '#1D6FB8',
          600: '#175C99',
          700: '#12497A',
          800: '#0E385E',
          900: '#0B2545',
          DEFAULT: '#1D6FB8',
        },
        // CTA / highlight only. Never a surface, never a large fill.
        accent: {
          50: '#FEF4E9',
          100: '#FDE3C6',
          400: '#F79B4A',
          500: '#F5821F',
          600: '#D96C0E',
          // 5.84:1 on white — the only accent that passes AA at label sizes.
          700: '#A8480A',
          DEFAULT: '#F5821F',
        },
        surface: {
          bg: '#F6F8FB',
          card: '#FFFFFF',
          line: '#E6ECF3',
          sunken: '#EEF3F9',
        },
        ink: {
          DEFAULT: '#0B2545',
          muted: '#64748B',
          faint: '#94A3B8',
          invert: '#FFFFFF',
        },
        status: {
          ok: '#16A34A',
          okBg: '#E8F7EE',
          warn: '#F59E0B',
          warnBg: '#FEF5E3',
          bad: '#DC2626',
          badBg: '#FDECEC',
          info: '#1D6FB8',
          infoBg: '#EAF3FB',
        },
      },
      fontFamily: {
        sans: ['Cairo', 'Tajawal', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,37,69,0.04), 0 10px 28px -14px rgba(11,37,69,0.16)',
        lift: '0 2px 4px rgba(11,37,69,0.06), 0 18px 40px -18px rgba(11,37,69,0.28)',
        tile: '0 1px 2px rgba(11,37,69,0.05), 0 12px 24px -16px rgba(11,37,69,0.35)',
        panel: '0 24px 60px -20px rgba(11,37,69,0.38)',
        inset: 'inset 0 1px 0 rgba(255,255,255,0.6)',
      },
      borderRadius: {
        xl2: '1.125rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        // Width rather than scaleX so the bar empties towards the reader's own
        // start edge in both directions without a per-direction origin.
        drain: {
          from: { width: '100%' },
          to: { width: '0%' },
        },
      },
      animation: {
        'fade-up': 'fade-up 260ms cubic-bezier(0.22,1,0.36,1) both',
        'pop-in': 'pop-in 200ms cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 1.6s infinite',
        // Matches AUTO_DISMISS_MS in IncomingNotificationPopup.
        drain: 'drain 9s linear forwards',
      },
    },
  },
  plugins: [],
};
