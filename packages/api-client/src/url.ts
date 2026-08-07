/**
 * تشذيب الشرطات بمسح خطي بدل التعبير النمطي.
 *
 * ‏`/\/+$/` غير مثبَّت من اليسار، فيحاول المحرّك المطابقة من كل موضع في النص:
 * عند كل موضع يلتهم سلسلة الشرطات ثم يفشل في `$`، فتصير الكلفة تربيعية.
 * ‏`"https://x" + "/".repeat(200_000) + "a"` استغرق **29 ثانية** فعلياً،
 * والمسح الخطي أدناه ينهيه في **0.19 ملّي ثانية**.
 *
 * ‏baseUrl يأتي من الإعدادات عادةً، لكنه في تطبيقات الهاتف قد يأتي من شاشة
 * إعداد أو رابط عميق — ولا داعي للمخاطرة أصلاً ما دام البديل أبسط وأسرع.
 */

const SLASH = 47; // '/'

/** يحذف كل الشرطات في آخر النص. `O(n)` بلا تراجع. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === SLASH) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

/** يحذف كل الشرطات في أول النص. `O(n)` بلا تراجع. */
export function stripLeadingSlashes(value: string): string {
  let start = 0;
  while (start < value.length && value.charCodeAt(start) === SLASH) start += 1;
  return start === 0 ? value : value.slice(start);
}

/** يُرمى حين يُبنى عميل إصدار بعنوان غير مشفَّر. */
export class InsecureApiUrlError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(
      `عنوان API غير مشفَّر في نسخة إصدار: ${url}\n` +
        'كلمة المرور ورمزا الوصول والتجديد تُرسل عبر هذا العنوان. ' +
        'استعمل https:// — أو ابنِ نسخة تطوير إن كنت تختبر محلياً.',
    );
    this.name = 'InsecureApiUrlError';
    this.url = url;
  }
}

/**
 * يتحقق من العنوان **قبل أول طلب**.
 *
 * ‏`EXPO_PUBLIC_API_URL` يُمرَّر وقت البناء وقيمته الافتراضية
 * `http://localhost:3000`. نسخة إنتاج تُبنى بعنوان HTTP بخطأ في أمر بناء
 * ترسل كلمة المرور ورمز التجديد ذا الثلاثين يوماً على الشبكة بلا تشفير،
 * ولا شيء في التطبيق يُظهر ذلك.
 *
 * الفشل عند الإقلاع مقصود: نسخة تعمل بعنوان غير آمن أسوأ من نسخة لا تعمل
 * — الأولى تُسرِّب بصمت، والثانية تُصلَح قبل أن تصل إلى أحد.
 *
 * `allowInsecureHttp` يمرّره التطبيق من إشارة التطوير عنده (`__DEV__` في
 * إكسبو، `NODE_ENV` في اللوحة). افتراضه `false` كي يفشل مغلقاً: من ينسى
 * تمريره يحصل على عطل ظاهر في التطوير لا ثغرة صامتة في الإنتاج.
 *
 * والتطوير يقبل HTTP على أي مضيف عمداً: الاختبار على جهاز حقيقي يمرّ
 * بعنوان الشبكة المحلية، وحظره يدفع إلى تعطيل الفحص كلّه.
 */
export function assertUsableApiUrl(baseUrl: string, allowInsecureHttp: boolean): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new InsecureApiUrlError(baseUrl);
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && allowInsecureHttp) return;
  throw new InsecureApiUrlError(baseUrl);
}
