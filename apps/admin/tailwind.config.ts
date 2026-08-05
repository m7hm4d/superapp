import type { Config } from 'tailwindcss';
import preset from '@superapp/config/tailwind-preset';

const config: Config = {
  presets: [preset],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // يفوز امتداد التطبيق على الـpreset لنفس المفتاح — الخط عبر next/font
        sans: [
          'var(--font-plex-arabic)',
          'IBM Plex Sans Arabic',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
};

export default config;
