import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../account/account_screen.dart';
import '../auth/auth_controller.dart';
import '../batches/active_batch_screen.dart';
import '../batches/batches_repository.dart';
import '../batches/offers_screen.dart';
import '../cash/cash_screen.dart';

/// هيكل التبويبات. الترتيب يتبع يوم السائق: العروض ← الدفعة ← النقد ← الحساب.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});
  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _index = 0;

  static const _titles = ['العمل', 'الدفعة النشطة', 'النقد', 'الحساب'];

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);

    // حساب غير مفعّل لا يرى عروضاً — الخادم يرفضها، والشاشة تقول السبب
    if (auth.approvalStatus != null && auth.approvalStatus != 'approved') {
      return Scaffold(
        appBar: AppBar(title: const Text('الحساب')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.hourglass_empty, size: 48),
                const SizedBox(height: 16),
                Text('حسابك ${_label(auth.approvalStatus!)}', textAlign: TextAlign.center),
                const SizedBox(height: 8),
                const Text('لا تصل العروض قبل التفعيل من الإدارة.',
                    textAlign: TextAlign.center, style: TextStyle(fontSize: 12)),
                const SizedBox(height: 24),
                OutlinedButton(
                  onPressed: () => ref.read(authProvider.notifier).logout(),
                  child: const Text('تسجيل الخروج'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    // الدفعة النشطة لها شاشتها الكاملة بشريطها الخاص
    if (_index == 1) {
      return Scaffold(
        body: const ActiveBatchScreen(),
        bottomNavigationBar: _bar(),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_index]),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(availableBatchesProvider);
              ref.invalidate(ledgerProvider);
            },
          ),
        ],
      ),
      body: switch (_index) {
        0 => const OffersScreen(),
        2 => const CashScreen(),
        _ => const AccountScreen(),
      },
      bottomNavigationBar: _bar(),
    );
  }

  Widget _bar() => NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.list_alt), label: 'العمل'),
          NavigationDestination(icon: Icon(Icons.local_shipping), label: 'الدفعة'),
          NavigationDestination(icon: Icon(Icons.payments), label: 'النقد'),
          NavigationDestination(icon: Icon(Icons.person), label: 'الحساب'),
        ],
      );

  static String _label(String s) => switch (s) {
        'pending' => 'قيد المراجعة',
        'rejected' => 'مرفوض',
        'suspended' => 'موقوف',
        _ => s,
      };
}
