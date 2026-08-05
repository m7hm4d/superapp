import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
