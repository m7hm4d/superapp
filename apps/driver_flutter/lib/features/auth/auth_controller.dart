import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';

enum AuthStatus { loading, guest, authed }

class AuthUser {
  const AuthUser({required this.id, required this.fullName, required this.role, this.phone});
  final String id;
  final String fullName;
  final String role;
  final String? phone;

  factory AuthUser.fromJson(Map<String, dynamic> j) => AuthUser(
        id: j['id'] as String,
        fullName: (j['fullName'] ?? '') as String,
        role: (j['role'] ?? '') as String,
        phone: j['phone'] as String?,
      );
}

class AuthState {
  const AuthState({required this.status, this.user, this.approvalStatus});
  final AuthStatus status;
  final AuthUser? user;
  final String? approvalStatus;

  AuthState copyWith({AuthStatus? status, AuthUser? user, String? approvalStatus}) =>
      AuthState(
        status: status ?? this.status,
        user: user ?? this.user,
        approvalStatus: approvalStatus ?? this.approvalStatus,
      );
}

final apiProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    baseUrl: apiUrl,
    storage: const TokenStorage(FlutterSecureStorage()),
    onUnauthorized: () => ref.read(authProvider.notifier).signedOut(),
  );
  return client;
});

final authProvider = StateNotifierProvider<AuthController, AuthState>(
  (ref) => AuthController(ref)..hydrate(),
);

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(const AuthState(status: AuthStatus.loading));
  final Ref _ref;

  ApiClient get _api => _ref.read(apiProvider);

  /// يُستدعى عند الإقلاع: توكن محفوظ لا يعني جلسة صالحة — الخادم هو الحكم.
  Future<void> hydrate() async {
    try {
      final access = await _api.storage.access;
      if (access == null) {
        state = const AuthState(status: AuthStatus.guest);
        return;
      }
      final me = await _api.get<Map<String, dynamic>>('auth/me');
      final profile = me['profile'] as Map<String, dynamic>?;
      state = AuthState(
        status: AuthStatus.authed,
        user: AuthUser.fromJson(me['user'] as Map<String, dynamic>),
        approvalStatus: profile?['approvalStatus'] as String?,
      );
    } catch (_) {
      state = const AuthState(status: AuthStatus.guest);
    }
  }

  Future<void> login(String phone, String password) async {
    final res = await _api.post<Map<String, dynamic>>(
      'auth/login',
      body: {'phone': phone, 'password': password},
    );
    final tokens = res['tokens'] as Map<String, dynamic>;
    await _api.storage.save(
      access: tokens['accessToken'] as String,
      refresh: tokens['refreshToken'] as String,
    );
    await hydrate();
  }

  Future<void> logout() async {
    await _api.storage.clear();
    state = const AuthState(status: AuthStatus.guest);
  }

  void signedOut() => state = const AuthState(status: AuthStatus.guest);
}
