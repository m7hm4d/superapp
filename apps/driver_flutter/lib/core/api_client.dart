import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// خطأ API موحّد — يقابل `ApiError` في نسخة TypeScript: الخادم يردّ
/// `{code, message?, requestId}` والشاشات تفرّع على `code` لا على النص.
class ApiError implements Exception {
  ApiError({required this.status, required this.code, this.message, this.body});

  final int status;
  final String code;
  final String? message;
  final dynamic body;

  @override
  String toString() => 'ApiError($status, $code)';
}

const _accessKey = 'sa.driver.access';
const _refreshKey = 'sa.driver.refresh';

/// تخزين التوكنات في Keystore/Keychain لا في تخزين عادي — التوكن الإداري
/// يعيش ثلاثين يوماً، وسرقته من نسخة احتياطية غير مشفّرة تكفي لانتحال سائق.
class TokenStorage {
  const TokenStorage(this._store);
  final FlutterSecureStorage _store;

  Future<String?> get access => _store.read(key: _accessKey);
  Future<String?> get refresh => _store.read(key: _refreshKey);

  Future<void> save({required String access, required String refresh}) async {
    await _store.write(key: _accessKey, value: access);
    await _store.write(key: _refreshKey, value: refresh);
  }

  Future<void> clear() async {
    await _store.delete(key: _accessKey);
    await _store.delete(key: _refreshKey);
  }
}

/// عميل API وحيد للتطبيق.
///
/// يضيف `/api/v1` وترويسة التفويض، ويجدّد التوكن **مرة واحدة** عند 401 ثم
/// يعيد الطلب. التجديد المتزامن يُجمَّع في وعد واحد: بلا ذلك تُطلق عشر
/// شاشات عشرة تجديدات متوازية، فتُدوَّر العائلة عشر مرات ويُبطِل بعضها بعضاً.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required this.storage,
    this.onUnauthorized,
  }) : _dio = Dio(BaseOptions(
          baseUrl: '${baseUrl.replaceAll(RegExp(r'/+$'), '')}/api/v1',
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 20),
          // نتولّى رفع الأخطاء بأنفسنا لنحوّلها إلى ApiError
          validateStatus: (_) => true,
        ));

  final Dio _dio;
  final TokenStorage storage;
  final void Function()? onUnauthorized;

  Future<bool>? _refreshing;

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) =>
      _request<T>('GET', path, query: query);

  Future<T> post<T>(String path, {Object? body}) => _request<T>('POST', path, body: body);

  Future<T> patch<T>(String path, {Object? body}) => _request<T>('PATCH', path, body: body);

  Future<T> delete<T>(String path, {Object? body}) => _request<T>('DELETE', path, body: body);

  Future<T> _request<T>(
    String method,
    String path, {
    Map<String, dynamic>? query,
    Object? body,
  }) async {
    var res = await _send(method, path, query: query, body: body);

    // مسارات المصادقة لا تُجدَّد: 401 منها يعني بيانات خاطئة لا توكناً منتهياً
    if (res.statusCode == 401 && !_isAuthPath(path)) {
      final refreshed = await _refreshOnce();
      if (refreshed) {
        res = await _send(method, path, query: query, body: body);
      } else {
        await storage.clear();
        onUnauthorized?.call();
        throw _toError(res);
      }
    }

    if (res.statusCode == null || res.statusCode! >= 400) {
      if (res.statusCode == 401 && !_isAuthPath(path)) {
        await storage.clear();
        onUnauthorized?.call();
      }
      throw _toError(res);
    }
    return res.data as T;
  }

  Future<Response<dynamic>> _send(
    String method,
    String path, {
    Map<String, dynamic>? query,
    Object? body,
  }) async {
    final access = await storage.access;
    return _dio.request<dynamic>(
      _normalise(path),
      data: body,
      queryParameters: query,
      options: Options(
        method: method,
        headers: {
          if (access != null) 'Authorization': 'Bearer $access',
          if (body != null) 'Content-Type': 'application/json',
        },
      ),
    );
  }

  /// وعد تجديد واحد مشترك بين كل الطلبات المتزامنة التي رأت 401
  Future<bool> _refreshOnce() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final token = await storage.refresh;
    if (token == null) return false;
    final res = await _dio.post<dynamic>(
      '/auth/refresh',
      data: {'refreshToken': token},
      options: Options(headers: {'Content-Type': 'application/json'}),
    );
    if (res.statusCode != 200 && res.statusCode != 201) return false;
    final tokens = (res.data as Map?)?['tokens'] as Map?;
    final a = tokens?['accessToken'], r = tokens?['refreshToken'];
    if (a is! String || r is! String) return false;
    await storage.save(access: a, refresh: r);
    return true;
  }

  String _normalise(String path) {
    var p = path.replaceAll(RegExp(r'^/+'), '');
    if (p.startsWith('api/v1/')) p = p.substring('api/v1/'.length);
    return '/$p';
  }

  bool _isAuthPath(String path) {
    final p = _normalise(path).substring(1);
    return p == 'auth/login' || p == 'auth/register' || p == 'auth/refresh';
  }

  ApiError _toError(Response<dynamic> res) {
    final body = res.data;
    final map = body is Map ? body : const {};
    final code = map['code'];
    return ApiError(
      status: res.statusCode ?? 0,
      code: code is String && code.isNotEmpty ? code : 'HTTP_${res.statusCode}',
      message: map['message'] is String ? map['message'] as String : null,
      body: body,
    );
  }
}
