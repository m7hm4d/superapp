import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: z.string().default('30d'),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),
  DEFAULT_DELIVERY_FEE_IQD: z.coerce.number().int().default(2000),
  VENDOR_ACCEPT_TIMEOUT_MIN: z.coerce.number().int().default(10),
  BATCH_WINDOW_SEC: z.coerce.number().int().default(75),
  BATCH_OFFER_TTL_SEC: z.coerce.number().int().default(60),
  SENTRY_DSN: z.string().optional().or(z.literal('')),
});

export type Env = z.infer<typeof envSchema>;

/** يفشل الإقلاع بصوت عالٍ عند غياب متغير — لا تشغيل بإعدادات ناقصة */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
