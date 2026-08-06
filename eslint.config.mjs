import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * إعداد واحد للمستودع كله بدل إعداد لكل حزمة: تشغيل واحد أسرع من اثني عشر،
 * وكل تشغيل يبني برنامج TypeScript كاملاً.
 *
 * المبدأ: **صارم على ما يُسقط الإنتاج، صامت عمّا هو ذوق.** التنسيق كله متروك
 * لـPrettier — أي قاعدة تتحدث عن المسافات والفواصل معطّلة هنا.
 *
 * أثمن ما في هذا الملف قواعد الوعود المعتمدة على الأنواع
 * (`no-floating-promises` وأخواتها): قاعدة بيانات وطوابير ومؤقتات في كل مكان،
 * و`await` منسيّة تعني كتابة لا تحدث أو خطأً يُبتلع بصمت — ولا يراها المدقّق.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-export/**',
      '**/.next/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/*.d.ts',
      'eslint.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // يحلّ tsconfig المناسب لكل ملف وحده — لازم لتعدد الحزم
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // — ما يُسقط الإنتاج فعلاً —
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      // — نظافة تُقرأ لا تُزعج —
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // الشيفرة تحمل أصلاً تعطيلات `no-console` مقصودة في السكربتات — تفعيل
      // القاعدة يجعل تلك التعطيلات ذات معنى بدل أن تكون توجيهات ميتة.
      'no-console': 'warn',

      // — ضجيج القوالب النصية: `${obj}` ينتج [object Object] —
      '@typescript-eslint/restrict-template-expressions': [
        'warn',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],

      // — أُطفئت عمداً —
      // الشيفرة مليئة بحدود خارجية (استجابات HTTP، حمولات JSON، صفوف قاعدة)
      // تصل كـany، والتأكيد عليها موثّق بمخططات Zod لا بأنواع الوقت الحقيقي.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  // React: قواعد الخطّافات تكشف أخطاء حقيقية لا أسلوباً
  {
    files: ['apps/admin/**/*.{ts,tsx}', 'apps/{customer,vendor,driver}/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}', 'packages/map/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ملفات الإعداد (metro، babel، tailwind، postcss، drizzle، vitest) خارج أي
  // tsconfig، فمحلّل الأنواع لا يجد لها برنامجاً ويسقط عند التحليل. تُفحص بلا
  // معرفة أنواع — وهو كل ما تحتاجه أصلاً.
  {
    files: ['**/*.config.{js,mjs,cjs,ts,mts}', 'packages/config/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      // ‏CommonJS: module و require و __dirname ليست عالمية بلا هذا
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // سكربتات: الطباعة على الطرفية هي وظيفتها
  {
    files: ['**/scripts/**'],
    rules: { 'no-console': 'off' },
  },

  // محوّلات التخزين تحقّق واجهة `TokenStorage` غير المتزامنة، لأن إحدى
  // نسخها (expo-secure-store) غير متزامنة فعلاً. نسخة localStorage متزامنة
  // فلا `await` فيها — و`require-await` محقّ حرفياً ومخطئ في المقصد.
  {
    files: ['**/lib/storage.ts', 'packages/api-client/src/storage.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },

  // ‏zustand: `useStore((s) => s.action)` يختار دالة عادية من كائن الحالة لا
  // تابعاً مربوطاً بـ`this`. القاعدة لا تميّز الحالتين فتُبلّغ عن الجميع.
  // تبقى فعّالة في الـAPI حيث الأصناف حقيقية وربط `this` يهمّ.
  {
    files: ['apps/{customer,vendor,driver}/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },

  // الاختبارات: التأكيدات تُنتج تعابير تبدو زائدة، والانتظار المتعمّد شائع
  {
    files: ['**/test/**', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
