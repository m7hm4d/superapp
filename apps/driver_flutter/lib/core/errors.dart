import 'api_client.dart';

/// رسائل مشتقّة من `code` لا من نص الخادم — الترجمة تبقى في التطبيق.
const _messages = <String, String>{
  'INVALID_CREDENTIALS': 'رقم الهاتف أو كلمة المرور غير صحيحة',
  'BLOCKED': 'هذا الحساب محظور — راجع الإدارة',
  'PENDING_APPROVAL': 'حسابك قيد المراجعة',
  'PIN_INVALID': 'الرمز غير صحيح',
  'BATCH_TAKEN': 'سبقك سائق آخر إلى هذه الدفعة',
  'OFFER_EXPIRED': 'انتهت مهلة العرض',
  'ALREADY_HAS_ACTIVE_BATCH': 'لديك دفعة نشطة — أنهِها أولاً',
  'CASH_MISMATCH': 'المبلغ لا يطابق المستحق',
  'NOT_PICKED_UP': 'أكّد الاستلام من المخبز أولاً',
  'ORDER_NOT_IN_BATCH': 'هذا الطلب ليس ضمن دفعتك',
};

String errorText(Object e, [String fallback = 'حدث خطأ غير متوقع']) {
  if (e is ApiError) return _messages[e.code] ?? '$fallback (${e.code})';
  return 'تعذّر الاتصال بالخادم';
}

/// `CASH_MISMATCH` يحمل المبلغ المتوقَّع في جسم الخطأ — يُعرض للسائق
/// ليصحّح بدل أن يخمّن.
int? expectedIqd(Object e) {
  if (e is! ApiError) return null;
  final body = e.body;
  if (body is Map && body['expected'] is int) return body['expected'] as int;
  return null;
}
