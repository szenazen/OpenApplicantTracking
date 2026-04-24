import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
      },
      keyframes: {
        'kanban-card-blink': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(99 102 241 / 0)' },
          '50%': { boxShadow: '0 0 0 5px rgb(99 102 241 / 0.45)' },
        },
      },
      animation: {
        'kanban-card-blink': 'kanban-card-blink 0.65s ease-in-out 3',
      },
    },
  },
  plugins: [],
};
export default config;
