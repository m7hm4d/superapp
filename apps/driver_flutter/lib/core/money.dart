import 'package:intl/intl.dart';

final _iqd = NumberFormat.decimalPattern('en');

/// المبالغ بأرقام لاتينية وفواصل آلاف — كما في نسخة React Native تماماً،
/// فالسائق يقرأ الرقم نفسه على الجهازين ولا يختلف الشكل بين التطبيقين.
String formatIqd(num amount) => '${_iqd.format(amount)} د.ع';

/// 03:25 — عدّاد مهلة العرض
String formatMmss(int totalSeconds) {
  final s = totalSeconds < 0 ? 0 : totalSeconds;
  final m = (s ~/ 60).toString().padLeft(2, '0');
  final r = (s % 60).toString().padLeft(2, '0');
  return '$m:$r';
}
