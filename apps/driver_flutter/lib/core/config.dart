import 'package:flutter/foundation.dart';

/// عنوان الـAPI يُمرَّر وقت البناء لا يُخبَز في الشيفرة:
///   flutter run --dart-define=API_URL=https://api-stage.4irq.com
/// فتخدم نسخة واحدة بيئتَي التجربة والإنتاج.
const apiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://localhost:3000',
);

/// يُرمى حين تُبنى نسخة إصدار بعنوان غير مشفَّر.
class InsecureApiUrlError extends Error {
  InsecureApiUrlError(this.url);
  final String url;

  @override
  String toString() =>
      'API_URL غير مشفَّر في نسخة إصدار: $url\n'
      'كلمة المرور ورمزا الوصول والتجديد تُرسل عبر هذا العنوان. '
      'استعمل https:// — أو ابنِ نسخة تصحيح إن كنت تختبر محلياً.';
}

/// عنوان محلي: الاستثناء الوحيد المسموح بـHTTP.
bool _isLoopback(Uri u) =>
    u.host == 'localhost' ||
    u.host == '127.0.0.1' ||
    u.host == '::1' ||
    // محاكي Android يصل إلى مضيفه عبر هذا العنوان
    u.host == '10.0.2.2';

/// يتحقق من العنوان قبل أي طلب.
///
/// نسخة الإصدار **ترفض** أي عنوان غير `https`. المخاطرة ليست نظرية:
/// التطبيق يرسل كلمة المرور ورمز التجديد ذا الثلاثين يوماً عبر هذا
/// العنوان، وسقوطه إلى HTTP بخطأ في أمر بناء يكشفهما على الشبكة.
///
/// والفشل عند الإقلاع مقصود: نسخة تعمل بعنوان غير آمن أسوأ من نسخة لا
/// تعمل — الأولى تُسرِّب بصمت، والثانية تُصلَح قبل أن تصل إلى أحد.
String validateApiUrl(String url, {bool isRelease = kReleaseMode}) {
  final u = Uri.tryParse(url);
  if (u == null || !u.hasScheme || u.host.isEmpty) {
    throw InsecureApiUrlError(url);
  }
  if (u.scheme == 'https') return url;
  if (!isRelease && u.scheme == 'http' && _isLoopback(u)) return url;
  throw InsecureApiUrlError(url);
}
