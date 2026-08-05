import { authenticator } from 'otplib';

/**
 * إعداد TOTP الموحّد للإدارة.
 *
 * window: 1 — يقبل الخطوة السابقة والتالية (±30 ثانية) لتحمّل انحراف ساعة
 * الهاتف عن الخادم؛ الافتراضي 0 يرفض رموزاً صحيحة عند أدنى انحراف.
 * التسامح لا يُضعف الأمان لأن كل رمز مستهلَك يُرفض بعدها (منع إعادة الاستخدام).
 */
export const TOTP_STEP_SEC = 30;
export const totp = authenticator.clone({ window: 1 });

/** خطوة الزمن الحالية — وحدة عدّاد TOTP */
export function currentTotpStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SEC);
}

/**
 * يتحقق من الرمز ويعيد الخطوة الزمنية التي طابقها (لا مجرد صح/خطأ)،
 * إذ يلزم تخزينها لرفض إعادة استخدام الرمز نفسه داخل نافذته.
 * يعيد null إذا كان الرمز غير صالح.
 */
export function verifyTotpStep(
  token: string,
  secret: string,
  now: number = Date.now(),
): number | null {
  let delta: number | null;
  try {
    delta = totp.checkDelta(token, secret);
  } catch {
    // سر تالف أو رمز بصيغة غير متوقعة
    return null;
  }
  if (delta === null || delta === undefined) return null;
  return currentTotpStep(now) + delta;
}
