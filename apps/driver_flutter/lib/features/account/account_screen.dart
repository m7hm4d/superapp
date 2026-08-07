import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/errors.dart';
import '../auth/auth_controller.dart';
import '../batches/batches_repository.dart';

/// D-06 الحساب: الحالة، والاتصال للعمل، والخروج.
class AccountScreen extends ConsumerStatefulWidget {
  const AccountScreen({super.key});
  @override
  ConsumerState<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends ConsumerState<AccountScreen> {
  bool? _available;
  bool _busy = false;

  Future<void> _toggle(bool value) async {
    setState(() {
      _available = value;
      _busy = true;
    });
    try {
      await ref.read(repoProvider).setAvailability(value);
      ref.invalidate(availableBatchesProvider);
    } catch (e) {
      if (mounted) {
        // الحالة المحلية تعود إلى ما كانت: لا نُظهر «متصل» والخادم يرى خلافه
        setState(() => _available = !value);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(errorText(e, 'تعذّر تغيير الحالة'))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(auth.user?.fullName ?? '', style: Theme.of(context).textTheme.titleMedium),
                if (auth.user?.phone != null)
                  Text(auth.user!.phone!, textDirection: TextDirection.ltr),
                const SizedBox(height: 8),
                Text('حالة الحساب: ${_approval(auth.approvalStatus)}'),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: SwitchListTile(
            title: const Text('متصل للعمل'),
            subtitle: const Text('العروض تصل فقط حين تكون متصلاً'),
            value: _available ?? false,
            onChanged: _busy ? null : _toggle,
          ),
        ),
        const SizedBox(height: 24),
        OutlinedButton.icon(
          onPressed: () => ref.read(authProvider.notifier).logout(),
          icon: const Icon(Icons.logout),
          label: const Text('تسجيل الخروج'),
        ),
      ],
    );
  }

  static String _approval(String? s) => switch (s) {
        'pending' => 'قيد المراجعة',
        'approved' => 'مفعّل',
        'rejected' => 'مرفوض',
        'suspended' => 'موقوف',
        _ => s ?? '—',
      };
}
