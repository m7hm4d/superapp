import 'package:flutter_test/flutter_test.dart';
import 'package:superapp_driver/core/config.dart';

/// انحدار أمني: فرض HTTPS في نسخ الإصدار.
///
/// التطبيق يرسل كلمة المرور ورمز التجديد ذا الثلاثين يوماً عبر `API_URL`.
/// بناء إصدار بعنوان `http://` — بخطأ في أمر البناء أو في متغيّر المستودع —
/// يكشفهما على الشبكة، ولا شيء في التطبيق كان يمنع ذلك.
void main() {
  group('validateApiUrl في نسخة الإصدار', () {
    test('يقبل https', () {
      expect(
        validateApiUrl('https://api-stage.4irq.com', isRelease: true),
        'https://api-stage.4irq.com',
      );
    });

    test('يرفض http ولو كان محلياً', () {
      expect(
        () => validateApiUrl('http://localhost:3000', isRelease: true),
        throwsA(isA<InsecureApiUrlError>()),
      );
      expect(
        () => validateApiUrl('http://10.0.2.2:3000', isRelease: true),
        throwsA(isA<InsecureApiUrlError>()),
      );
    });

    test('يرفض عنوان إنتاج غير مشفَّر', () {
      expect(
        () => validateApiUrl('http://api.4irq.com', isRelease: true),
        throwsA(isA<InsecureApiUrlError>()),
      );
    });

    test('يرفض ما ليس عنواناً صالحاً', () {
      for (final bad in ['', 'api.4irq.com', 'not a url', 'https://']) {
        expect(
          () => validateApiUrl(bad, isRelease: true),
          throwsA(isA<InsecureApiUrlError>()),
          reason: bad,
        );
      }
    });
  });

  group('validateApiUrl في التطوير', () {
    test('يسمح بـhttp للعناوين المحلية وحدها', () {
      expect(validateApiUrl('http://localhost:3000', isRelease: false),
          'http://localhost:3000');
      expect(validateApiUrl('http://127.0.0.1:3000', isRelease: false),
          'http://127.0.0.1:3000');
      // محاكي Android يصل إلى مضيفه عبر هذا العنوان
      expect(validateApiUrl('http://10.0.2.2:3000', isRelease: false),
          'http://10.0.2.2:3000');
    });

    /// حتى في التطوير: عنوان بعيد بلا تشفير خطأ لا راحة
    test('يرفض http لمضيف بعيد', () {
      expect(
        () => validateApiUrl('http://api-stage.4irq.com', isRelease: false),
        throwsA(isA<InsecureApiUrlError>()),
      );
      expect(
        () => validateApiUrl('http://192.168.1.5:3000', isRelease: false),
        throwsA(isA<InsecureApiUrlError>()),
      );
    });

    test('https مقبول دائماً', () {
      expect(validateApiUrl('https://api.4irq.com', isRelease: false),
          'https://api.4irq.com');
    });
  });
}
