import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Layered ink palette — deep blacks for the OLED feel.
        ink: {
          950: '#05080d',
          900: '#0b0f17',
          800: '#0f1623',
          700: '#152031',
          600: '#1c2a3f',
        },
        // Accent ramp for hover/focus + glow gradients.
        accent: {
          DEFAULT: '#6ee7b7',
          50: '#ecfdf5',
          200: '#a7f3d0',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
        },
        electric: {
          400: '#7dd3fc',
          500: '#38bdf8',
          600: '#0ea5e9',
        },
        violet: {
          400: '#c084fc',
          500: '#a855f7',
        },
      },
      fontFamily: {
        // Plus Jakarta Sans loaded via next/font in layout.tsx and exposed
        // here as the default sans family. Mono is JetBrains Mono for code.
        sans: ['var(--font-jakarta)', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo'],
      },
      backgroundImage: {
        'grid-fade': 'radial-gradient(ellipse at top, rgba(110,231,183,0.08), transparent 60%)',
        'mesh-glow':
          'radial-gradient(at 20% 30%, rgba(110,231,183,0.18), transparent 50%), ' +
          'radial-gradient(at 80% 20%, rgba(125,211,252,0.14), transparent 55%), ' +
          'radial-gradient(at 50% 80%, rgba(168,85,247,0.12), transparent 55%)',
        'noise':
          "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.06 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
      },
      keyframes: {
        'orb-drift': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%':       { transform: 'translate3d(40px,-30px,0) scale(1.06)' },
          '66%':       { transform: 'translate3d(-30px,20px,0) scale(0.96)' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%':   { transform: 'scale(0.8)', opacity: '0.7' },
          '100%': { transform: 'scale(2.1)', opacity: '0' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'border-spin': {
          '0%':   { '--angle': '0deg' } as never,
          '100%': { '--angle': '360deg' } as never,
        },
      },
      animation: {
        'orb-drift': 'orb-drift 18s ease-in-out infinite',
        'orb-drift-slow': 'orb-drift 28s ease-in-out infinite',
        'fade-up': 'fade-up 600ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite',
        'shimmer': 'shimmer 3s linear infinite',
      },
      boxShadow: {
        'glow-mint': '0 0 0 1px rgba(110,231,183,0.18), 0 30px 80px -20px rgba(110,231,183,0.32), 0 8px 30px -10px rgba(110,231,183,0.18)',
        'glow-soft': '0 0 0 1px rgba(255,255,255,0.06), 0 30px 80px -30px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};

export default config;
