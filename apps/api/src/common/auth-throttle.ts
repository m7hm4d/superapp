import { Throttle } from '@nestjs/throttler';

/**
 * حد محاولات مسارات المصادقة (دخول/تسجيل) لكل IP.
 *
 * الاسم 'default' إلزامي: التجاوز يُطابَق باسم المحدِّد المسجَّل في
 * ThrottlerModule — واسم غير مطابق يُهمَل بصمت فيبقى الحد العام وحده.
 * تُقرأ القيمة من البيئة هنا لا عبر ConfigService لأن المزخرِف يُقيَّم عند
 * تعريف الصنف قبل تهيئة الحقن.
 */
export const AuthThrottle = () =>
  Throttle({
    default: {
      limit: Number(process.env.AUTH_THROTTLE_LIMIT ?? 5),
      ttl: Number(process.env.AUTH_THROTTLE_TTL_MS ?? 60_000),
    },
  });
