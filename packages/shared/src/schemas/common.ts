import { z } from 'zod';
import { isValidIraqiPhone, normalizeIraqiPhone } from '../phone';

export const zUuid = z.string().uuid();

export const zIraqiPhone = z
  .string()
  .min(7)
  .max(20)
  .refine(isValidIraqiPhone, { message: 'رقم هاتف عراقي غير صالح' })
  .transform((v) => normalizeIraqiPhone(v));

export const zPassword = z.string().min(8, 'كلمة المرور 8 أحرف على الأقل').max(128);

/** مبالغ الدينار: أعداد صحيحة غير سالبة، بلا كسور */
export const zIqd = z.number().int().nonnegative();

export const zLatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof zLatLng>;

export const zPagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const zPin = z.string().regex(/^\d{4}$/, 'رمز PIN من 4 أرقام');

/** كل كتابة من التطبيقات تحمل هذا الرأس؛ التحقق في interceptor مخصص */
export const IDEMPOTENCY_HEADER = 'x-idempotency-key';
export const REQUEST_ID_HEADER = 'x-request-id';
