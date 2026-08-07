import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DriverDirectoryService } from './driver-directory.service';

/**
 * وحدة خفيفة تحمل منفذ قراءة السائقين وحده.
 *
 * لماذا منفصلة عن `DeliveriesModule`: تلك تستورد `LedgerModule`، ولو طلب
 * الدفتر المنفذَ منها لانغلقت حلقة `deliveries ⇄ ledger`. و`forwardRef`
 * يُسكت المترجم ولا يُصلح الشكل.
 *
 * القاعدة التي تتبعها هذه الوحدة: **المنافذ أوراق في شجرة الاعتماد**. لا
 * تستورد إلا ما تحتاجه للقراءة، فيستطيع الجميع أن يعتمد عليها بلا دورة.
 */
@Module({
  imports: [AuthModule],
  providers: [DriverDirectoryService],
  exports: [DriverDirectoryService],
})
export class DriverDirectoryModule {}
