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
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      // الحزمة e2e: تدخل عبر HTTP فتمرّ على الوحدات والحرّاس والاعتراضات.
      // ما دون ذلك ليس منطق تطبيق: التهيئة والمخططات لا يقيس مرورها شيئاً.
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/register-paths.ts',
        'src/**/*.module.ts',
        'src/db/schema/**',
        'src/db/migrations/**',
        'src/db/migrate.ts',
        'src/db/seed/**',
        'src/config/**',
      ],
      // القياس الفعلي وقت الضبط: أسطر 75.37% وفروع 73% ودوال 75.98%.
      // العتبة أدنى منه بثلاث نقاط: تمسك الانحدار الحقيقي ولا ترتجف حين
      // يُضاف ملف قبل اختباره. تُرفع كلما ارتفع الواقع، ولا تُخفَّض.
      thresholds: {
        lines: 72,
        statements: 72,
        functions: 72,
        branches: 70,
      },
    },
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
