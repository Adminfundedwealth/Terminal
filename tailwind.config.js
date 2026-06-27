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
        'xxs': '10px',
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
