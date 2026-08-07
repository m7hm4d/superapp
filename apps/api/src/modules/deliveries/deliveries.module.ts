import { Module } from '@nestjs/common';
import { PinGuardService } from '../../common/pin-guard.service';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersModule } from '../orders/orders.module';
import { BatchingService } from './batching.service';
import { DriverBatchesController } from './driver-batches.controller';
import { DriverDeliveriesController } from './driver-deliveries.controller';
import { DriverProfileController } from './driver-profile.controller';
import { DriversService } from './drivers.service';
import { VendorBatchesController } from './vendor-batches.controller';

/**
 * آلة 2 — محرك الدفعات: الخادم يقترح دفعات من 1–3 طلبات READY
 * من المخبز نفسه، مطالبة ذرية بدفعة حية واحدة لكل سائق،
 * واستلام/تسليم بـ PIN مع قيود الدفتر في المعاملة نفسها.
 */
@Module({
  imports: [OrdersModule, LedgerModule],
  controllers: [
    DriverProfileController,
    DriverBatchesController,
    DriverDeliveriesController,
    VendorBatchesController,
  ],
  providers: [BatchingService, DriversService, PinGuardService],
})
export class DeliveriesModule {}
