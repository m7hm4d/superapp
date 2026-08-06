import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  /**
   * ناتج مستقل: صورة تشغيل بلا pnpm install ولا node_modules كاملة —
   * ‏Next يتتبّع ما يستورده فعلاً ويحزمه وحده.
   */
  output: 'standalone',
  /**
   * التتبّع يبدأ من جذر المستودع لا من مجلد التطبيق، وإلا سقطت حزم
   * مساحة العمل (‏shared / api-client / i18n) من الناتج المستقل.
   */
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@superapp/shared', '@superapp/api-client', '@superapp/i18n'],
  webpack: (config) => {
    // api-client يستدعي expo-secure-store كسولاً للتطبيقات فقط؛
    // اللوحة لا تستخدمه — نمنع webpack من محاولة حزمه.
    config.resolve.alias = {
      ...config.resolve.alias,
      'expo-secure-store': false,
    };
    return config;
  },
};

export default nextConfig;
