import { z } from 'zod';

/**
 * مصدر واحد للأصول المسموحة: يقرأه `main.ts` عبر ConfigService، ويقرأه
 * `RealtimeGateway` من البيئة مباشرة لأن مزخرِف الصنف يُقيَّم قبل الحقن.
 */
export const DEFAULT_CORS_ORIGINS = 'http://localhost:3001';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().default(3000),
  APP_REVISION: z
    .string()
    .regex(/^(unknown|[0-9a-f]{40})$/)
    .default('unknown'),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: z.string().default('30d'),
  CORS_ORIGINS: z.string().default(DEFAULT_CORS_ORIGINS),
  /**
   * عدد الوكلاء العكسيين الموثوقين أمام الـAPI — 0 يعني اتصالاً مباشراً.
   * ‏Caddy وحده = 1. يُضبط أعلى فقط إن أُضيف وكيل آخر أمامه (‏Cloudflare مثلاً).
   * بدونه خلف وكيل: حدّ المحاولات وسجل الدخول يريان عنوان الوكيل لا العميل.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /**
   * WebAuthn: المفتاح مربوط بالنطاق تشفيرياً، ولا يقبل عنوان IP إطلاقاً.
   * RP_ID نطاق مجرّد (admin.example.com) وORIGIN أصل كامل بمنفذه.
   * الافتراضي localhost للتطوير — يُضبط بنطاق الإنتاج عند النشر.
   */
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_RP_NAME: z.string().default('SuperApp Admin'),
  WEBAUTHN_ORIGINS: z.string().default('http://localhost:3001'),
  /** حد محاولات مسارات المصادقة لكل IP في النافذة — يُرفع في الاختبارات فقط */
  AUTH_THROTTLE_LIMIT: z.coerce.number().int().min(1).default(5),
  AUTH_THROTTLE_TTL_MS: z.coerce.number().int().min(1000).default(60_000),
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
