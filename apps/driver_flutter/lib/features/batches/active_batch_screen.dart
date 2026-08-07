import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/errors.dart';
import '../../core/models.dart';
import '../../core/money.dart';
import '../../widgets/pin_field.dart';
import 'batches_repository.dart';

/// D-03 الدفعة النشطة: تأكيد الاستلام من المخبز، ثم تسليم كل وقفة.
///
/// الترتيب مقصود ومفروض من الخادم: لا تسليم قبل تأكيد الاستلام. الشاشة
/// تعكس ذلك بصرياً بدل أن تعرض أزراراً يرفضها الخادم.
class ActiveBatchScreen extends ConsumerWidget {
  const ActiveBatchScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final active = ref.watch(activeBatchProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('الدفعة النشطة')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(activeBatchProvider),
        child: active.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => _Message(text: errorText(e, 'تعذّر جلب الدفعة')),
          data: (batch) => batch == null
              ? const _Message(text: 'لا دفعة نشطة — اذهب إلى «العمل» لقبول عرض')
              : _BatchBody(batch: batch),
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => ListView(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 64, horizontal: 24),
            child: Text(text, textAlign: TextAlign.center),
          ),
        ],
      );
}

class _BatchBody extends ConsumerWidget {
  const _BatchBody({required this.batch});
  final DriverBatch batch;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final remaining = batch.stops.where((s) => !s.isDelivered).length;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(batch.vendorNameAr, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(batch.vendorAddressText,
                    style: Theme.of(context).textTheme.bodySmall),
                const Divider(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('أجرتك: ${formatIqd(batch.totalFeeIqd)}'),
                    Text('نقد الدفعة: ${formatIqd(batch.totalCashIqd)}'),
                  ],
                ),
                const SizedBox(height: 8),
                Text('$remaining من ${batch.ordersCount} لم تُسلَّم بعد',
                    style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        if (batch.awaitingPickup)
          _PickupCard(batch: batch)
        else
          ...batch.stops.map((s) => _StopCard(batch: batch, stop: s)),
      ],
    );
  }
}

/// الخطوة الأولى: رمز يعرضه تطبيق المخبز — إثبات أن السائق وقف عنده فعلاً
class _PickupCard extends ConsumerStatefulWidget {
  const _PickupCard({required this.batch});
  final DriverBatch batch;
  @override
  ConsumerState<_PickupCard> createState() => _PickupCardState();
}

class _PickupCardState extends ConsumerState<_PickupCard> {
  final _pin = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(repoProvider).confirmPickup(widget.batch.id, _pin.text);
      ref.invalidate(activeBatchProvider);
    } catch (e) {
      setState(() {
        _error = errorText(e, 'تعذّر تأكيد الاستلام');
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('تأكيد الاستلام', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              const Text('اطلب رمز الاستلام من المخبز', style: TextStyle(fontSize: 12)),
              const SizedBox(height: 16),
              PinField(controller: _pin, label: 'رمز الاستلام', autofocus: true),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: const TextStyle(color: Colors.red)),
              ],
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _busy ? null : _confirm,
                child: _busy
                    ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('تأكيد الاستلام'),
              ),
            ],
          ),
        ),
      );
}

class _StopCard extends ConsumerWidget {
  const _StopCard({required this.batch, required this.stop});
  final DriverBatch batch;
  final DriverBatchStop stop;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final done = stop.isDelivered;
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: done ? Colors.green.shade100 : null,
          child: done ? const Icon(Icons.check, color: Colors.green) : Text('${stop.sequence}'),
        ),
        title: Text(stop.orderCode),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(stop.addressText),
            if (stop.landmark != null && stop.landmark!.isNotEmpty)
              Text('قرب ${stop.landmark}', style: const TextStyle(fontSize: 12)),
            Text('التحصيل: ${formatIqd(stop.totalIqd)}',
                style: const TextStyle(fontSize: 12)),
          ],
        ),
        isThreeLine: true,
        trailing: done
            ? const Text('سُلِّم', style: TextStyle(color: Colors.green))
            : TextButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => _DeliverSheet(stop: stop),
                ),
                child: const Text('تسليم'),
              ),
      ),
    );
  }
}

/// ورقة التسليم: رمز العميل + المبلغ المحصَّل، أو تسجيل استثناء.
class _DeliverSheet extends ConsumerStatefulWidget {
  const _DeliverSheet({required this.stop});
  final DriverBatchStop stop;
  @override
  ConsumerState<_DeliverSheet> createState() => _DeliverSheetState();
}

class _DeliverSheetState extends ConsumerState<_DeliverSheet> {
  late final _cash = TextEditingController(text: '${widget.stop.totalIqd}');
  final _pin = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _cash.dispose();
    _pin.dispose();
    super.dispose();
  }

  Future<void> _deliver() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(repoProvider).deliver(
            widget.stop.orderId,
            pin: _pin.text,
            cashCollectedIqd: int.tryParse(_cash.text) ?? -1,
          );
      ref.invalidate(activeBatchProvider);
      ref.invalidate(ledgerProvider);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      final expected = expectedIqd(e);
      setState(() {
        _error = expected != null
            ? '${errorText(e)} — المستحق ${formatIqd(expected)}'
            : errorText(e, 'تعذّر التسليم');
        _busy = false;
      });
    }
  }

  Future<void> _reportException() async {
    final type = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('سبب تعذّر التسليم'),
        children: [
          for (final e in exceptionTypes.entries)
            SimpleDialogOption(
              onPressed: () => Navigator.of(ctx).pop(e.key),
              child: Text(e.value),
            ),
        ],
      ),
    );
    if (type == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(repoProvider).reportException(widget.stop.orderId, type: type);
      ref.invalidate(activeBatchProvider);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() {
        _error = errorText(e, 'تعذّر تسجيل الاستثناء');
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('تسليم ${widget.stop.orderCode}',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text('المستحق: ${formatIqd(widget.stop.totalIqd)}',
              style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 16),
          PinField(controller: _pin, label: 'رمز التسليم من العميل', autofocus: true),
          const SizedBox(height: 12),
          TextField(
            controller: _cash,
            keyboardType: TextInputType.number,
            textDirection: TextDirection.ltr,
            decoration: const InputDecoration(
              labelText: 'المبلغ المحصَّل (د.ع)',
              border: OutlineInputBorder(),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _deliver,
            child: _busy
                ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('تأكيد التسليم'),
          ),
          TextButton(
            onPressed: _busy ? null : _reportException,
            child: const Text('تعذّر التسليم'),
          ),
        ],
      ),
    );
  }
}
