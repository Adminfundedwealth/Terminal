/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        fw: {
          bg: 'var(--fw-bg)',
          surface: 'var(--fw-surface)',
          'surface-2': 'var(--fw-surface-2)',
          border: 'var(--fw-border)',
          'border-light': 'var(--fw-border-light)',
          text: 'var(--fw-text)',
          'text-secondary': 'var(--fw-text-secondary)',
          'text-muted': 'var(--fw-text-muted)',
          accent: 'var(--fw-accent)',
          'accent-hover': 'var(--fw-accent-hover)',
          green: 'var(--fw-green)',
          'green-dim': 'var(--fw-green-dim)',
          red: 'var(--fw-red)',
          'red-dim': 'var(--fw-red-dim)',
          panel: 'var(--fw-panel)',
          hover: 'var(--fw-hover)',
          selected: 'var(--fw-selected)',
          yellow: 'var(--fw-yellow)',
          cyan: 'var(--fw-cyan)',
          purple: 'var(--fw-purple)',
          orange: 'var(--fw-orange)',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        // Legacy
        'xxs': '11px',
        // ── Institutional Typography Scale ──────────────────────────────
        // L1 — Primary Trading Values (price, P&L, equity)
        'tv-l1':   ['22px', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.3px' }],
        'tv-l1-lg':['24px', { lineHeight: '1.0', fontWeight: '700', letterSpacing: '-0.4px' }],
        // L2 — Secondary Trading Values (bid/ask, qty, avg price)
        'tv-l2':   ['15px', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.1px' }],
        'tv-l2-lg':['17px', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.2px' }],
        // L3 — Section Headings (WATCHLIST, POSITIONS, DEPTH)
        'tv-l3':   ['13px', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '0.4px' }],
        'tv-l3-sm':['12px', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '0.4px' }],
        // L4 — Labels (muted, below values)
        'tv-l4':   ['11px', { lineHeight: '1.3', fontWeight: '500', letterSpacing: '0.1px' }],
        'tv-l4-sm':['10px', { lineHeight: '1.3', fontWeight: '500', letterSpacing: '0.1px' }],
        // L5 — Supporting (exchange, timestamp, latency)
        'tv-l5':   ['10px', { lineHeight: '1.2', fontWeight: '400' }],
        'tv-l5-sm':['11px', { lineHeight: '1.2', fontWeight: '400' }],
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
