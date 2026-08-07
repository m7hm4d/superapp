import { Throttle } from '@nestjs/throttler';

/**
 * حدّ خاص بمسار تحديث الرموز.
 *
 * كان المسار بلا حدّ مخصص أصلاً، بينما يحمله `login` و`register`. تخمين رمز
 * تجديد غير وارد — هو JWT موقَّع — لكن غياب الحدّ يجعل المسار مضخّة عمل
 * تشفيري مجانية: كل طلب فكُّ توقيع واستعلام قاعدة.
 *
 * وهو **أوسع** من حدّ الدخول عمداً: التحديث عملية مشروعة متكررة، وكثير من
 * المستخدمين في العراق خلف NAT يتقاسمون عنواناً واحداً. حدٌّ ضيق هنا يقطع
 * جلسات حقيقية بلا أن يمنع شيئاً — فالسقف على الطول هو ما يكبح الكلفة.
 */
export const RefreshThrottle = () =>
  Throttle({
    default: {
      limit: Number(process.env.REFRESH_THROTTLE_LIMIT ?? 30),
      ttl: Number(process.env.REFRESH_THROTTLE_TTL_MS ?? 60_000),
    },
  });
