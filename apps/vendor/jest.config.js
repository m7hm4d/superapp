const expoPreset = require('jest-expo/jest-preset');

/**
 * ‏jest-expo يحمل تحويل Babel وخرائط الوحدات التي يحتاجها React Native،
 * وهو ما لا يوفّره vitest المستعمل في الـAPI: حزم RN تُشحن ESM غير مصرَّفة.
 *
 * لكنه يترجم `paths` من tsconfig إلى moduleNameMapper. وtsconfig هنا يوجّه
 * `react` إلى `./node_modules/@types/react` — حيلة تُرضي المصرّف في تخطيط
 * pnpm حيث لا تُسطَّح الاعتماديات في الجذر. النتيجة أن jest يحاول تحميل
 * **ملفات الأنواع** كوحدة تشغيل فيسقط عند أول JSX.
 *
 * يُصحَّح بالهدف لا بالمفتاح: مفاتيح الـpreset تعابير نمطية بمحارف مهرَّبة
 * (`^react/jsx\-runtime$`)، فكتابة المفتاح يدوياً تُنشئ مدخلاً ثانياً بدل أن
 * تستبدل الأول — ويبقى الخطأ قائماً بصمت.
 */
const unescapePattern = (pattern) =>
  pattern.replace(/^\^/, '').replace(/\$$/, '').replace(/\\/g, '');

const moduleNameMapper = Object.fromEntries(
  Object.entries(expoPreset.moduleNameMapper ?? {}).map(([pattern, target]) => {
    if (typeof target === 'string' && target.includes('/@types/')) {
      return [pattern, require.resolve(unescapePattern(pattern))];
    }
    return [pattern, target];
  }),
);

module.exports = {
  ...expoPreset,
  rootDir: __dirname,
  moduleNameMapper,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/test/**/*.spec.{ts,tsx}'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', 'app/**/*.tsx'],
};
