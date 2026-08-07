import 'package:flutter_test/flutter_test.dart';
import 'package:superapp_driver/core/models.dart';
import 'package:superapp_driver/core/money.dart';

void main() {
  group('formatMmss', () {
    test('يبني mm:ss بصفر بادئ', () {
      expect(formatMmss(0), '00:00');
      expect(formatMmss(5), '00:05');
      expect(formatMmss(65), '01:05');
      expect(formatMmss(600), '10:00');
    });
    test('السالب يُعامل صفراً — عرض منتهٍ لا يعدّ إلى الوراء', () {
      expect(formatMmss(-5), '00:00');
    });
  });

  group('formatIqd', () {
    test('أرقام لاتينية وفواصل آلاف', () {
      expect(formatIqd(4000), '4,000 د.ع');
      expect(formatIqd(0), '0 د.ع');
      expect(formatIqd(26000), '26,000 د.ع');
    });
  });

  group('DriverBatch (نموذج مولَّد + امتدادات)', () {
    Map<String, dynamic> json({String? expires, String status = 'OFFERED'}) => {
          'id': 'b1',
          'status': status,
          'vendorNameAr': 'مخبز الكرادة',
          'vendorLat': 33.3,
          'vendorLng': 44.4,
          'vendorAddressText': 'الكرادة',
          'ordersCount': 2,
          'totalFeeIqd': 4000,
          'totalCashIqd': 26000,
          'offerExpiresAt': expires,
          'stops': [
            {
              'orderId': 'o1',
              'orderCode': 'A-1',
              'sequence': 1,
              'status': 'OUT_FOR_DELIVERY',
              'addressText': 'شارع 1',
              'lat': 33.3,
              'lng': 44.4,
              'totalIqd': 13000,
              'contactPhoneMasked': '0770****567',
              'deliveredAt': null,
            }
          ],
        };

    test('يقرأ الحقول والوقفات', () {
      final b = DriverBatch.fromJson(json());
      expect(b.vendorNameAr, 'مخبز الكرادة');
      expect(b.stops, hasLength(1));
      expect(b.stops.first.totalIqd, 13000);
      expect(b.stops.first.isDelivered, isFalse);
    });

    test('عرض منتهٍ يعطي صفر ثانية', () {
      final past = DateTime.now().subtract(const Duration(seconds: 30)).toIso8601String();
      expect(DriverBatch.fromJson(json(expires: past)).remainingSeconds, 0);
    });

    test('عرض قائم يعطي ثوانيَ موجبة', () {
      final future = DateTime.now().add(const Duration(seconds: 90)).toIso8601String();
      final left = DriverBatch.fromJson(json(expires: future)).remainingSeconds;
      expect(left, greaterThan(80));
      expect(left, lessThanOrEqualTo(90));
    });

    test('بلا مهلة يعطي صفراً لا استثناء', () {
      expect(DriverBatch.fromJson(json(expires: null)).remainingSeconds, 0);
    });

    /// الترتيب مفروض من الخادم: لا تسليم قبل تأكيد الاستلام
    test('CLAIMED يعني بانتظار تأكيد الاستلام', () {
      expect(DriverBatch.fromJson(json(status: 'CLAIMED')).awaitingPickup, isTrue);
      expect(DriverBatch.fromJson(json(status: 'PICKED_UP')).awaitingPickup, isFalse);
    });

    test('حقل ناقص لا يُسقط التحليل', () {
      final b = DriverBatch.fromJson({'id': 'x'});
      expect(b.ordersCount, 0);
      expect(b.stops, isEmpty);
    });
  });
}
