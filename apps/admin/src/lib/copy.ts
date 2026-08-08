/**
 * نسخ إلى الحافظة يعمل خارج السياق الآمن أيضاً.
 *
 * `navigator.clipboard` **غير معرّف** إلا في سياق آمن (HTTPS أو localhost).
 * واللوحة تُجرَّب على عنوان شبكة محلية بلا TLS، فكان زرّ النسخ يسكت بلا
 * أثر — لا نجاح ولا خطأ. والصمت أسوأ من الفشل: من ضغط ظنّ أن الرموز في
 * حافظته فأغلق الصفحة.
 *
 * فالبديل `execCommand('copy')` القديم — مهجور لكنه يعمل حيث لا يعمل
 * الحديث. ويعيد صراحةً هل نجح، كي تقول الواجهة الحقيقة.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // يسقط إلى البديل أدناه — قد يرفض المستخدم الإذن
    }
  }

  const area = document.createElement('textarea');
  area.value = text;
  // خارج الشاشة لا `display:none`: الأخير يمنع التحديد فيفشل النسخ
  area.style.cssText = 'position:fixed;top:-9999px;opacity:0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
