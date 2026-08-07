import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/errors.dart';
import '../../core/money.dart';
import '../../core/models.dart';
import '../batches/batches_repository.dart';
import 'settlement_pin_dialog.dart';

/// D-05 النقد: ما بعهدة السائق، وما يدين به لكل مخبز، وفتح تسوية.
class CashScreen extends ConsumerWidget {
  const CashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ledger = ref.watch(ledgerProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(ledgerProvider),
      child: ledger.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ListView(children: [
          Padding(
            padding: const EdgeInsets.all(32),
            child: Text(errorText(e, 'تعذّر جلب الدفتر'), textAlign: TextAlign.center),
          ),
        ]),
        data: (l) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('نقد بالعهدة', style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: 4),
                    Text(formatIqd(l.cashOnHandIqd),
                        style: Theme.of(context).textTheme.headlineSmall),
                    const Divider(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('تسليمات اليوم: ${l.todayDeliveredCount}'),
                        Text('أجور اليوم: ${formatIqd(l.todayFeesIqd)}'),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text('المستحق للمخابز', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (l.owed.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('لا مستحقات — عهدتك صفر', textAlign: TextAlign.center),
              )
            else
              ...l.owed.map((o) => _OwedCard(owed: o)),
            if (l.settlements.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('التسويات', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              ...l.settlements.map(_SettlementCard.new),
            ],
          ],
        ),
      ),
    );
  }

  static String settlementLabel(String? status) => switch (status) {
        'UNSETTLED' => 'غير مسوّاة',
        'AWAITING_CONFIRMATION' => 'بانتظار تأكيد المخبز',
        'SETTLED' => 'مسوّاة',
        'DISPUTED' => 'معترَض عليها',
        _ => status ?? '',
      };
}

class _OwedCard extends ConsumerStatefulWidget {
  const _OwedCard({required this.owed});
  final Map<String, dynamic> owed;
  @override
  ConsumerState<_OwedCard> createState() => _OwedCardState();
}

class _OwedCardState extends ConsumerState<_OwedCard> {
  bool _busy = false;

  Future<void> _settle() async {
    final vendorId = widget.owed['vendorId']?.toString();
    final amount = widget.owed['amountIqd'];
    if (vendorId == null || amount is! int) return;

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('فتح تسوية'),
        content: Text(
          'سلّم ${formatIqd(amount)} إلى ${widget.owed['vendorNameAr'] ?? 'المخبز'}، '
          'ثم يؤكّد المخبز الاستلام من تطبيقه.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('فتح')),
        ],
      ),
    );
    if (ok != true) return;

    setState(() => _busy = true);
    try {
      final settlement = await ref.read(repoProvider).openSettlement(vendorId: vendorId);
      ref.invalidate(ledgerProvider);
      // الرمز يُعرض فوراً: بدونه لا يملك السائق ما يقوله للمخبز
      if (mounted) await SettlementPinDialog.show(context, settlement);
      if (mounted) setState(() => _busy = false);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(errorText(e, 'تعذّر فتح التسوية'))));
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => Card(
        child: ListTile(
          title: Text(widget.owed['vendorNameAr']?.toString() ?? 'مخبز'),
          subtitle: Text(formatIqd(widget.owed['amountIqd'] ?? 0)),
          trailing: _busy
              ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton(onPressed: _settle, child: const Text('تسوية')),
        ),
      );
}

/// بطاقة تسوية. الرمز يبقى ظاهراً ما دامت بانتظار تأكيد المخبز — فلو أغلق
/// السائق التطبيق قبل أن يمليه، يستعيده من هنا بلا فتح تسوية ثانية.
class _SettlementCard extends StatelessWidget {
  const _SettlementCard(this.settlement);
  final Settlement settlement;

  @override
  Widget build(BuildContext context) {
    final pin = settlement.settlementPin;
    return Card(
      child: ListTile(
        title: Text(settlement.vendorNameAr),
        subtitle: Text(CashScreen.settlementLabel(settlement.status)),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(formatIqd(settlement.amountIqd)),
            if (pin != null && pin.isNotEmpty)
              Text(
                'الرمز $pin',
                textDirection: TextDirection.ltr,
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).colorScheme.primary,
                ),
              ),
          ],
        ),
        onTap: pin != null && pin.isNotEmpty
            ? () => SettlementPinDialog.show(context, settlement)
            : null,
      ),
    );
  }
}
