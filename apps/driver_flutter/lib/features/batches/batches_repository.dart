import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../auth/auth_controller.dart';

/// كل نداءات السائق في مكان واحد — الشاشات لا تعرف مسارات الـAPI.
class BatchesRepository {
  const BatchesRepository(this._api);
  final ApiClient _api;

  Future<List<DriverBatch>> available() async {
    final res = await _api.get<dynamic>('driver/batches/available');
    return (res as List? ?? const []).cast<Map<String, dynamic>>().map(DriverBatch.fromJson).toList();
  }

  /// دفعة نشطة واحدة لكل سائق — الخادم يعيد null حين لا توجد
  Future<DriverBatch?> active() async {
    final res = await _api.get<dynamic>('driver/batches/active');
    if (res == null) return null;
    return DriverBatch.fromJson(res as Map<String, dynamic>);
  }

  /// المطالبة ذرّية على الخادم: سائقان يضغطان معاً، واحد ينجح والآخر
  /// يتلقى خطأً. لذلك لا نتفاءل بالنتيجة محلياً قبل ردّ الخادم.
  Future<DriverBatch> claim(String batchId) async {
    final res = await _api.post<Map<String, dynamic>>('driver/batches/$batchId/claim');
    return DriverBatch.fromJson(res);
  }

  Future<DriverBatch> confirmPickup(String batchId, String pin) async {
    final res = await _api.post<Map<String, dynamic>>(
      'driver/batches/$batchId/confirm-pickup',
      body: {'pin': pin},
    );
    return DriverBatch.fromJson(res);
  }

  /// التسليم يحمل المبلغ المحصَّل: الخادم يقارنه بالمستحق ويرفض التفاوت
  /// برمز CASH_MISMATCH — لا يُصحَّح محلياً.
  Future<void> deliver(String orderId, {required String pin, required int cashCollectedIqd}) =>
      _api.post<dynamic>(
        'driver/orders/$orderId/deliver',
        body: {'pin': pin, 'cashCollectedIqd': cashCollectedIqd},
      );

  Future<void> reportException(String orderId, {required String type, String? note}) =>
      _api.post<dynamic>(
        'driver/orders/$orderId/exception',
        body: {'type': type, if (note != null && note.isNotEmpty) 'note': note},
      );

  Future<DriverLedger> ledger() async {
    final res = await _api.get<Map<String, dynamic>>('driver/ledger');
    return DriverLedger.fromJson(res);
  }

  /// يعيد التسوية المنشأة **بما فيها `settlementPin`** — الرمز الذي يمليه
  /// السائق على المخبز ليؤكّد. إهماله يعطّل المسار: يفتح السائق تسوية ولا
  /// يملك ما يقوله للمخبز.
  ///
  /// المبلغ لا يُرسل: الخادم يحسب مجموع الطلبات المسلَّمة غير المسوّاة
  /// بنفسه (`zInitiateSettlement` يقبل `vendorId` وحده). إرساله كان يوهم
  /// بأن العميل يقرّره.
  Future<Settlement> openSettlement({required String vendorId}) async {
    final res = await _api.post<Map<String, dynamic>>(
      'driver/settlements',
      body: {'vendorId': vendorId},
    );
    return Settlement.fromJson(res);
  }

  Future<void> setAvailability(bool isAvailable) =>
      _api.patch<dynamic>('driver/availability', body: {'isAvailable': isAvailable});
}

final repoProvider = Provider<BatchesRepository>((ref) => BatchesRepository(ref.read(apiProvider)));

final availableBatchesProvider =
    FutureProvider.autoDispose<List<DriverBatch>>((ref) => ref.read(repoProvider).available());

final activeBatchProvider =
    FutureProvider.autoDispose<DriverBatch?>((ref) => ref.read(repoProvider).active());

final ledgerProvider =
    FutureProvider.autoDispose<DriverLedger>((ref) => ref.read(repoProvider).ledger());
