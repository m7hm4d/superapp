// مولَّد — لا تحرّره.
// المصدر: مخططات Zod في packages/shared، عبر openapi.json.
// أعد التوليد: pnpm --filter @superapp/api gen:contract

library;

String _str(dynamic v) => v is String ? v : '';
int _int(dynamic v) => v is num ? v.toInt() : 0;
double _dbl(dynamic v) => v is num ? v.toDouble() : 0;

class BatchStop {
  const BatchStop({
    required this.orderId,
    required this.orderCode,
    required this.sequence,
    required this.status,
    required this.addressText,
    this.landmark,
    required this.lat,
    required this.lng,
    required this.totalIqd,
    required this.contactPhoneMasked,
  });

  final String orderId;
  final String orderCode;
  final int sequence;
  final String status;
  final String addressText;
  final String? landmark;
  final double lat;
  final double lng;
  final int totalIqd;
  final String contactPhoneMasked;

  factory BatchStop.fromJson(Map<String, dynamic> j) => BatchStop(
        orderId: _str(j['orderId']),
        orderCode: _str(j['orderCode']),
        sequence: _int(j['sequence']),
        status: _str(j['status']),
        addressText: _str(j['addressText']),
        landmark: j['landmark'] as String?,
        lat: _dbl(j['lat']),
        lng: _dbl(j['lng']),
        totalIqd: _int(j['totalIqd']),
        contactPhoneMasked: _str(j['contactPhoneMasked']),
      );

  Map<String, dynamic> toJson() => {
        'orderId': orderId,
        'orderCode': orderCode,
        'sequence': sequence,
        'status': status,
        'addressText': addressText,
        'landmark': landmark,
        'lat': lat,
        'lng': lng,
        'totalIqd': totalIqd,
        'contactPhoneMasked': contactPhoneMasked,
      };
}

class DriverBatchStop {
  const DriverBatchStop({
    required this.orderId,
    required this.orderCode,
    required this.sequence,
    required this.status,
    required this.addressText,
    this.landmark,
    required this.lat,
    required this.lng,
    required this.totalIqd,
    required this.contactPhoneMasked,
    this.deliveredAt,
  });

  final String orderId;
  final String orderCode;
  final int sequence;
  final String status;
  final String addressText;
  final String? landmark;
  final double lat;
  final double lng;
  final int totalIqd;
  final String contactPhoneMasked;
  final String? deliveredAt;

  factory DriverBatchStop.fromJson(Map<String, dynamic> j) => DriverBatchStop(
        orderId: _str(j['orderId']),
        orderCode: _str(j['orderCode']),
        sequence: _int(j['sequence']),
        status: _str(j['status']),
        addressText: _str(j['addressText']),
        landmark: j['landmark'] as String?,
        lat: _dbl(j['lat']),
        lng: _dbl(j['lng']),
        totalIqd: _int(j['totalIqd']),
        contactPhoneMasked: _str(j['contactPhoneMasked']),
        deliveredAt: j['deliveredAt'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'orderId': orderId,
        'orderCode': orderCode,
        'sequence': sequence,
        'status': status,
        'addressText': addressText,
        'landmark': landmark,
        'lat': lat,
        'lng': lng,
        'totalIqd': totalIqd,
        'contactPhoneMasked': contactPhoneMasked,
        'deliveredAt': deliveredAt,
      };
}

class Batch {
  const Batch({
    required this.id,
    required this.status,
    required this.vendorNameAr,
    required this.vendorLat,
    required this.vendorLng,
    required this.vendorAddressText,
    required this.ordersCount,
    required this.totalFeeIqd,
    required this.totalCashIqd,
    this.offerExpiresAt,
    required this.stops,
  });

  final String id;
  final String status;
  final String vendorNameAr;
  final double vendorLat;
  final double vendorLng;
  final String vendorAddressText;
  final int ordersCount;
  final int totalFeeIqd;
  final int totalCashIqd;
  final String? offerExpiresAt;
  final List<BatchStop> stops;

  factory Batch.fromJson(Map<String, dynamic> j) => Batch(
        id: _str(j['id']),
        status: _str(j['status']),
        vendorNameAr: _str(j['vendorNameAr']),
        vendorLat: _dbl(j['vendorLat']),
        vendorLng: _dbl(j['vendorLng']),
        vendorAddressText: _str(j['vendorAddressText']),
        ordersCount: _int(j['ordersCount']),
        totalFeeIqd: _int(j['totalFeeIqd']),
        totalCashIqd: _int(j['totalCashIqd']),
        offerExpiresAt: j['offerExpiresAt'] as String?,
        stops: ((j['stops'] as List?) ?? const []).cast<Map<String, dynamic>>().map(BatchStop.fromJson).toList(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'status': status,
        'vendorNameAr': vendorNameAr,
        'vendorLat': vendorLat,
        'vendorLng': vendorLng,
        'vendorAddressText': vendorAddressText,
        'ordersCount': ordersCount,
        'totalFeeIqd': totalFeeIqd,
        'totalCashIqd': totalCashIqd,
        'offerExpiresAt': offerExpiresAt,
        'stops': stops.map((e) => e.toJson()).toList(),
      };
}

class DriverBatch {
  const DriverBatch({
    required this.id,
    required this.status,
    required this.vendorNameAr,
    required this.vendorLat,
    required this.vendorLng,
    required this.vendorAddressText,
    required this.ordersCount,
    required this.totalFeeIqd,
    required this.totalCashIqd,
    this.offerExpiresAt,
    required this.stops,
  });

  final String id;
  final String status;
  final String vendorNameAr;
  final double vendorLat;
  final double vendorLng;
  final String vendorAddressText;
  final int ordersCount;
  final int totalFeeIqd;
  final int totalCashIqd;
  final String? offerExpiresAt;
  final List<DriverBatchStop> stops;

  factory DriverBatch.fromJson(Map<String, dynamic> j) => DriverBatch(
        id: _str(j['id']),
        status: _str(j['status']),
        vendorNameAr: _str(j['vendorNameAr']),
        vendorLat: _dbl(j['vendorLat']),
        vendorLng: _dbl(j['vendorLng']),
        vendorAddressText: _str(j['vendorAddressText']),
        ordersCount: _int(j['ordersCount']),
        totalFeeIqd: _int(j['totalFeeIqd']),
        totalCashIqd: _int(j['totalCashIqd']),
        offerExpiresAt: j['offerExpiresAt'] as String?,
        stops: ((j['stops'] as List?) ?? const []).cast<Map<String, dynamic>>().map(DriverBatchStop.fromJson).toList(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'status': status,
        'vendorNameAr': vendorNameAr,
        'vendorLat': vendorLat,
        'vendorLng': vendorLng,
        'vendorAddressText': vendorAddressText,
        'ordersCount': ordersCount,
        'totalFeeIqd': totalFeeIqd,
        'totalCashIqd': totalCashIqd,
        'offerExpiresAt': offerExpiresAt,
        'stops': stops.map((e) => e.toJson()).toList(),
      };
}

class DriverLedger {
  const DriverLedger({
    required this.todayDeliveredCount,
    required this.todayFeesIqd,
    required this.cashOnHandIqd,
    required this.owed,
    required this.settlements,
  });

  final int todayDeliveredCount;
  final int todayFeesIqd;
  final int cashOnHandIqd;
  final List<Map<String, dynamic>> owed;
  final List<Map<String, dynamic>> settlements;

  factory DriverLedger.fromJson(Map<String, dynamic> j) => DriverLedger(
        todayDeliveredCount: _int(j['todayDeliveredCount']),
        todayFeesIqd: _int(j['todayFeesIqd']),
        cashOnHandIqd: _int(j['cashOnHandIqd']),
        owed: ((j['owed'] as List?) ?? const []).cast<Map<String, dynamic>>().toList(),
        settlements: ((j['settlements'] as List?) ?? const []).cast<Map<String, dynamic>>().toList(),
      );

  Map<String, dynamic> toJson() => {
        'todayDeliveredCount': todayDeliveredCount,
        'todayFeesIqd': todayFeesIqd,
        'cashOnHandIqd': cashOnHandIqd,
        'owed': owed,
        'settlements': settlements,
      };
}

class ConfirmPickupRequest {
  const ConfirmPickupRequest({
    required this.pin,
  });

  final String pin;

  factory ConfirmPickupRequest.fromJson(Map<String, dynamic> j) => ConfirmPickupRequest(
        pin: _str(j['pin']),
      );

  Map<String, dynamic> toJson() => {
        'pin': pin,
      };
}

class ConfirmDeliveryRequest {
  const ConfirmDeliveryRequest({
    required this.pin,
    required this.cashCollectedIqd,
  });

  final String pin;
  final int cashCollectedIqd;

  factory ConfirmDeliveryRequest.fromJson(Map<String, dynamic> j) => ConfirmDeliveryRequest(
        pin: _str(j['pin']),
        cashCollectedIqd: _int(j['cashCollectedIqd']),
      );

  Map<String, dynamic> toJson() => {
        'pin': pin,
        'cashCollectedIqd': cashCollectedIqd,
      };
}

class ReportExceptionRequest {
  const ReportExceptionRequest({
    required this.type,
    this.note,
  });

  final String type;
  final String? note;

  factory ReportExceptionRequest.fromJson(Map<String, dynamic> j) => ReportExceptionRequest(
        type: _str(j['type']),
        note: j['note'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'type': type,
        'note': note,
      };
}

class SetAvailabilityRequest {
  const SetAvailabilityRequest({
    required this.isAvailable,
  });

  final bool isAvailable;

  factory SetAvailabilityRequest.fromJson(Map<String, dynamic> j) => SetAvailabilityRequest(
        isAvailable: j['isAvailable'] == true,
      );

  Map<String, dynamic> toJson() => {
        'isAvailable': isAvailable,
      };
}

