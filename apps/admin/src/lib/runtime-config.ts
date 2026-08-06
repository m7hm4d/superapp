/**
 * عنوان الـAPI وقت التشغيل لا وقت البناء.
 *
 * ‏`NEXT_PUBLIC_*` يُخبَز في حزمة المتصفح لحظة `next build`، فالصورة المنشورة
 * تحمل عنواناً واحداً إلى الأبد. وهذا يجعل صورة واحدة عاجزة عن خدمة بيئتين:
 * نُشرت لوحة التجربة فحملت `https://api.4irq.com` — عنوان الإنتاج — فلا
 * تستطيع تسجيل دخول أصلاً.
 *
 * الحل: الخادم يحقن العنوان في HTML عند كل طلب من `API_URL`، والمتصفح يقرأه
 * من هناك. تبقى `NEXT_PUBLIC_API_URL` احتياطاً للتطوير المحلي.
 */

const RUNTIME_KEY = '__SUPERAPP_API_URL__';

declare global {
  interface Window {
    [RUNTIME_KEY]?: string;
  }
}

/** يُقرأ على الخادم من البيئة — يُستدعى في مكوّن خادم فقط */
export function serverApiUrl(): string {
  return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
}

/**
 * في المتصفح: من الحقن أولاً. السكربت المحقون في `<head>` ينفَّذ أثناء تحليل
 * HTML، أي **قبل** حزم التطبيق المؤجَّلة — فالقيمة جاهزة عند تحميل هذه الوحدة.
 * وعلى الخادم: من البيئة مباشرة.
 */
export function apiUrl(): string {
  if (typeof window === 'undefined') return serverApiUrl();
  const injected = window[RUNTIME_KEY];
  if (typeof injected === 'string' && injected.length > 0) return injected;
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
}

export { RUNTIME_KEY };
