import { Module } from '@nestjs/common';
import { OrderDirectoryService } from './order-directory.service';

/**
 * وحدة خفيفة تحمل منفذ قراءة الطلبات وحده — لا تستورد شيئاً.
 * **المنافذ أوراق في شجرة الاعتماد**: يعتمد عليها الجميع بلا دورة.
 */
@Module({
  providers: [OrderDirectoryService],
  exports: [OrderDirectoryService],
})
export class OrderDirectoryModule {}
