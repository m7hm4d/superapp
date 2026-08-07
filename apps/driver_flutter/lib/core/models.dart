/// منطق مشتقّ من النماذج المولَّدة.
///
/// النماذج نفسها في `generated_models.dart` وتُولَّد من مخططات Zod — لا
/// تُحرَّر. وما يلي سلوك يخصّ التطبيق لا شكل البيانات، فمكانه هنا.
library;

export 'generated_models.dart';

import 'generated_models.dart';

extension DriverBatchX on DriverBatch {
  /// الاستلام لم يُؤكَّد بعد — قبله لا تُعرض أزرار التسليم
  bool get awaitingPickup => status == 'CLAIMED';

  /// ثوانٍ متبقية على العرض؛ صفر يعني منتهياً.
  int get remainingSeconds {
    final e = offerExpiresAt;
    if (e == null) return 0;
    final t = DateTime.tryParse(e);
    if (t == null) return 0;
    final s = t.difference(DateTime.now()).inSeconds;
    return s > 0 ? s : 0;
  }
}

extension DriverBatchStopX on DriverBatchStop {
  bool get isDelivered => deliveredAt != null || status == 'DELIVERED';
}

/// أنواع الاستثناءات كما يقبلها الخادم — أي قيمة أخرى يرفضها Zod
const exceptionTypes = <String, String>{
  'customer_unavailable': 'العميل غير متاح',
  'address_unclear': 'العنوان غير واضح',
  'customer_refused': 'العميل رفض الاستلام',
  'cash_discrepancy': 'خلاف على المبلغ',
  'other': 'سبب آخر',
};
