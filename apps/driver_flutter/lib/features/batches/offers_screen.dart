import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/errors.dart';
import '../../core/models.dart';
import '../../core/money.dart';
import 'batches_repository.dart';

/// D-02 شاشة العمل: العروض المتاحة بعدّاد مهلة حي.
class OffersScreen extends ConsumerWidget {
  const OffersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final offers = ref.watch(availableBatchesProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(availableBatchesProvider),
      child: offers.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ListView(children: [
          Padding(
            padding: const EdgeInsets.all(32),
            child: Text(errorText(e, 'تعذّر جلب العروض'), textAlign: TextAlign.center),
          ),
        ]),
        data: (items) => items.isEmpty
            ? ListView(children: const [
                Padding(
                  padding: EdgeInsets.symmetric(vertical: 64, horizontal: 24),
                  child: Text('لا عروض الآن — اسحب للتحديث', textAlign: TextAlign.center),
                ),
              ])
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: items.length,
                itemBuilder: (_, i) => _OfferCard(batch: items[i]),
              ),
      ),
    );
  }
}

class _OfferCard extends ConsumerStatefulWidget {
  const _OfferCard({required this.batch});
  final DriverBatch batch;
  @override
  ConsumerState<_OfferCard> createState() => _OfferCardState();
}

class _OfferCardState extends ConsumerState<_OfferCard> {
  Timer? _tick;
  late int _remaining = widget.batch.remainingSeconds;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // عدّاد يتوقف عند الصفر — لا يبقى مؤقت يعمل على بطاقة منتهية
    _tick = Timer.periodic(const Duration(seconds: 1), (t) {
      final left = widget.batch.remainingSeconds;
      if (!mounted) return;
      setState(() => _remaining = left);
      if (left <= 0) t.cancel();
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _claim() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await ref.read(repoProvider).claim(widget.batch.id);
      ref.invalidate(availableBatchesProvider);
      ref.invalidate(activeBatchProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('قُبلت الدفعة — اذهب إلى «الدفعة النشطة»')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(errorText(e, 'تعذّر قبول الدفعة'))));
        // سائق آخر سبقنا أو انتهى العرض — القائمة لم تعد صحيحة
        ref.invalidate(availableBatchesProvider);
      }
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final expired = _remaining <= 0;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(widget.batch.vendorNameAr,
                      style: Theme.of(context).textTheme.titleMedium),
                ),
                Text(
                  expired ? 'انتهت المهلة' : formatMmss(_remaining),
                  style: TextStyle(
                    color: expired ? Colors.red : Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text('${widget.batch.ordersCount} طلبات',
                style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _Stat(label: 'أجرتك', value: formatIqd(widget.batch.totalFeeIqd)),
                _Stat(label: 'النقد', value: formatIqd(widget.batch.totalCashIqd)),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              // عرض منتهٍ لا يُقبل: الزر يُعطَّل بدل أن يرسل طلباً يرفضه
              // الخادم فيرى السائق خطأً لا منعاً
              child: FilledButton(
                onPressed: expired || _busy ? null : _claim,
                child: Text(expired ? 'انتهت المهلة' : 'قبول الدفعة'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          Text(value, style: Theme.of(context).textTheme.titleSmall),
        ],
      );
}
