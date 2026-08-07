import 'package:flutter/material.dart';
import '../../core/models.dart';
import '../../core/money.dart';

/// رمز التسوية كما يراه السائق ليمليه على المخبز.
///
/// هذا الرمز هو الشيء الوحيد الذي يُتمّ التسوية: المخبز يُدخله في تطبيقه
/// فيؤكّد استلام النقد. إن لم يره السائق، فتح تسوية معلّقة لا يستطيع أحد
/// إغلاقها — والنقد يبقى في عهدته على الورق.
///
/// ولا ينتهي بإغلاق النافذة: يبقى ظاهراً على بطاقة التسوية في شاشة النقد
/// ما دامت بانتظار التأكيد.
class SettlementPinDialog extends StatelessWidget {
  const SettlementPinDialog({super.key, required this.settlement});

  final Settlement settlement;

  static Future<void> show(BuildContext context, Settlement s) => showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (_) => SettlementPinDialog(settlement: s),
      );

  @override
  Widget build(BuildContext context) {
    final pin = settlement.settlementPin;
    return AlertDialog(
      title: const Text('رمز التسوية'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('سلّم ${formatIqd(settlement.amountIqd)} إلى ${settlement.vendorNameAr}'),
          const SizedBox(height: 16),
          if (pin == null || pin.isEmpty)
            const Text(
              'لم يصل الرمز من الخادم — افتح شاشة النقد وراجع التسوية.',
              style: TextStyle(color: Colors.red),
            )
          else ...[
            Container(
              padding: const EdgeInsets.symmetric(vertical: 20),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                pin,
                textAlign: TextAlign.center,
                textDirection: TextDirection.ltr,
                style: const TextStyle(
                  fontSize: 40,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 14,
                ),
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'أملِ هذا الرمز على المخبز ليؤكّد الاستلام من تطبيقه.',
              style: TextStyle(fontSize: 12),
            ),
          ],
        ],
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('تم'),
        ),
      ],
    );
  }
}
