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
