import 'package:flutter_test/flutter_test.dart';
import 'package:superapp_driver/core/models.dart';

/// انحدار: رمز التسوية يجب أن يصل من الخادم إلى السائق.
///
/// كان المستودع يهمل استجابة `POST driver/settlements` ويعيد `void`،
/// فيفتح السائق تسوية ولا يملك ما يمليه على المخبز — والمخبز لا يستطيع
/// التأكيد. الرمز موجود في الاستجابة وفي قائمة الدفتر ما دامت التسوية
/// بانتظار التأكيد؛ كلا المصدرين مُختبَر هنا.
void main() {
  Map<String, dynamic> settlementJson({String? pin, String status = 'AWAITING_CONFIRMATION'}) => {
        'id': '11111111-2222-4333-8444-555555555555',
        'vendorId': '99999999-8888-4777-8666-555555555555',
        'vendorNameAr': 'مخبز الكرادة',
        'driverId': '22222222-3333-4444-8555-666666666666',
        'driverName': 'سائق',
        'status': status,
        'amountIqd': 26000,
        'orderIds': <String>[],
        if (pin != null) 'settlementPin': pin,
        'createdAt': '2026-08-07T10:00:00.000Z',
      };

  group('Settlement', () {
    test('يقرأ الرمز من استجابة الإنشاء', () {
      final s = Settlement.fromJson(settlementJson(pin: '4821'));
      expect(s.settlementPin, '4821');
      expect(s.amountIqd, 26000);
      expect(s.vendorNameAr, 'مخبز الكرادة');
    });

    /// المخبز لا يرى الرمز — يُدخله ليؤكّد. غيابه ليس خطأً في التحليل.
    test('غياب الرمز لا يُسقط التحليل', () {
      final s = Settlement.fromJson(settlementJson());
      expect(s.settlementPin, isNull);
      expect(s.status, 'AWAITING_CONFIRMATION');
    });

    test('يقرأ التسويات من الدفتر مطبوعةً لا كخرائط', () {
      final ledger = DriverLedger.fromJson({
        'todayDeliveredCount': 2,
        'todayFeesIqd': 4000,
        'cashOnHandIqd': 26000,
        'owed': <dynamic>[],
        'settlements': [settlementJson(pin: '7391')],
      });
      expect(ledger.settlements, hasLength(1));
      // النوع مطبوع: لولا ذلك لعاد Map ولما ظهر الرمز في الواجهة
      final Settlement s = ledger.settlements.first;
      expect(s.settlementPin, '7391');
      expect(s.vendorNameAr, 'مخبز الكرادة');
    });

    test('دفتر بلا تسويات يعطي قائمة فارغة لا استثناء', () {
      final ledger = DriverLedger.fromJson({
        'todayDeliveredCount': 0,
        'todayFeesIqd': 0,
        'cashOnHandIqd': 0,
        'owed': <dynamic>[],
        'settlements': <dynamic>[],
      });
      expect(ledger.settlements, isEmpty);
      expect(ledger.cashOnHandIqd, 0);
    });
  });
}
