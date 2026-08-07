import { Module } from '@nestjs/common';
import { VendorsModule } from '../vendors/vendors.module';
import { OrdersCustomerController } from './orders-customer.controller';
import { OrdersTimersService } from './orders-timers.service';
import { OrdersVendorController } from './orders-vendor.controller';
import { OrdersService } from './orders.service';

/** آلة 1 — دورة حياة الطلب: الإنشاء، الانتقالات، مؤقت انتهاء القبول */
@Module({
  imports: [VendorsModule],
  controllers: [OrdersCustomerController, OrdersVendorController],
  providers: [OrdersService, OrdersTimersService],
  exports: [OrdersService],
})
export class OrdersModule {}
