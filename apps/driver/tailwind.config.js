/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@superapp/config/tailwind-preset'), require('nativewind/preset')],
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
