import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:superapp_driver/core/api_client.dart';
import 'package:superapp_driver/features/auth/auth_controller.dart';

/// انحدار أمني: الخروج يجب أن يُبطل الجلسة على الخادم.
///
/// كان الخروج يحذف الرموز محلياً فقط، فيوهم بانتهاء الجلسة ولا يُنهيها:
/// رمز التجديد يعيش ثلاثين يوماً، ومن نسخه قبل الخروج يظل يصنع جلسات
/// جديدة طوال المدة.
///
/// الاختبار يشغّل خادماً حقيقياً على مقبس محلي بدل محاكاة العميل — فيثبت
/// أن الطلب **يُرسَل فعلاً** بالرمز الصحيح، لا أن دالةً استُدعيت.
class _FakeStore implements TokenStorage {
  _FakeStore({this.accessValue, this.refreshValue});
  String? accessValue;
  String? refreshValue;
  bool cleared = false;

  @override
  Future<String?> get access async => accessValue;

  @override
  Future<String?> get refresh async => refreshValue;

  @override
  Future<void> save({required String access, required String refresh}) async {
    accessValue = access;
    refreshValue = refresh;
  }

  @override
  Future<void> clear() async {
    cleared = true;
    accessValue = null;
    refreshValue = null;
  }
}

void main() {
  late HttpServer server;
  final received = <Map<String, dynamic>>[];
  var status = 200;

  setUp(() async {
    received.clear();
    status = 200;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((req) async {
      final body = await req.cast<List<int>>().transform(const SystemEncoding().decoder).join();
      received.add({'path': req.uri.path, 'body': body});
      req.response.statusCode = status;
      req.response.headers.contentType = ContentType.json;
      req.response.write('{"ok":true}');
      await req.response.close();
    });
  });

  tearDown(() async => server.close(force: true));

  ApiClient clientFor(_FakeStore store) => ApiClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        storage: store,
      );

  test('يرسل رمز التجديد إلى auth/logout ثم يمسح التخزين', () async {
    final store = _FakeStore(accessValue: 'a-token', refreshValue: 'r-token');
    final container = ProviderContainer(
      overrides: [apiProvider.overrideWithValue(clientFor(store))],
    );
    addTearDown(container.dispose);

    await container.read(authProvider.notifier).logout();

    final logout = received.where((r) => r['path'] == '/api/v1/auth/logout').toList();
    expect(logout, hasLength(1), reason: 'يجب أن يُستدعى المسار مرة واحدة');
    expect(logout.single['body'], contains('r-token'),
        reason: 'رمز التجديد هو ما يُبطل العائلة — إرسال غيره لا يُبطل شيئاً');
    expect(store.cleared, isTrue);
    expect(container.read(authProvider).status, AuthStatus.guest);
  });

  /// انقطاع الشبكة يجب ألّا يحبس المستخدم داخل التطبيق
  test('يمسح التخزين ويخرج حتى حين يفشل الطلب', () async {
    status = 500;
    final store = _FakeStore(accessValue: 'a-token', refreshValue: 'r-token');
    final container = ProviderContainer(
      overrides: [apiProvider.overrideWithValue(clientFor(store))],
    );
    addTearDown(container.dispose);

    await container.read(authProvider.notifier).logout();

    expect(store.cleared, isTrue);
    expect(container.read(authProvider).status, AuthStatus.guest);
  });

  test('بلا رمز تجديد: يخرج محلياً بلا نداء', () async {
    final store = _FakeStore();
    final container = ProviderContainer(
      overrides: [apiProvider.overrideWithValue(clientFor(store))],
    );
    addTearDown(container.dispose);

    await container.read(authProvider.notifier).logout();

    expect(received.where((r) => r['path'] == '/api/v1/auth/logout'), isEmpty);
    expect(store.cleared, isTrue);
  });
}
