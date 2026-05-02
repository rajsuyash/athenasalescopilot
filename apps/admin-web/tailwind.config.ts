import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0b0f17',
          800: '#0f1623',
          700: '#152031',
          600: '#1c2a3f',
        },
        accent: '#6ee7b7',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo'],
      },
    },
  },
  plugins: [],
};

export default config;
