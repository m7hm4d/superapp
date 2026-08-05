import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // e2e ضد قاعدة حقيقية — ملف واحد في كل مرة لتجنب تداخل الحالة
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@superapp/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  plugins: [
    // decorator metadata لأجل حقن التبعيات في Nest
    swc.vite({ module: { type: 'es6' } }),
  ],
});
