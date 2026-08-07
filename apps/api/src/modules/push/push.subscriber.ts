import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { driverProfiles } from '../../db/schema';
import { VendorDirectoryService } from '../vendors/vendor-directory.service';
import type {
  BatchOfferedDomainEvent,
  OrderCreatedDomainEvent,
} from '../../realtime/events.publisher';
import { PushService } from './push.service';

/**
 * النطاق الضيق المقرر في الخطة — حدثان فقط:
 * 1) طلب جديد → المخبز (لن يبقي التطبيق مفتوحاً)
 * 2) دفعة معروضة → السائقون المتاحون في المدينة
 */
@Injectable()
export class PushSubscriber {
  constructor(
    private readonly push: PushService,
    private readonly vendors: VendorDirectoryService,
    @Inject(DB) private readonly db: DbClient,
  ) {}

  @OnEvent('order.created')
  async onOrderCreated(e: OrderCreatedDomainEvent) {
    const vendor = await this.vendors.summaryFor(e.vendorProfileId);
    if (!vendor) return;
    await this.push.sendToUsers([vendor.userId], {
      title: 'طلب جديد! 🍞',
      body: `طلب ${e.code} — ${e.itemsCount} منتجات بقيمة ${e.totalIqd.toLocaleString('en')} د.ع`,
      data: { type: 'order:new', orderId: e.orderId },
    });
  }

  @OnEvent('batch.offered')
  async onBatchOffered(e: BatchOfferedDomainEvent) {
    const drivers = await this.db
      .select({ userId: driverProfiles.userId })
      .from(driverProfiles)
      .where(eq(driverProfiles.cityId, e.cityId));
    const available = drivers.map((d) => d.userId);
    await this.push.sendToUsers(available, {
      title: 'دفعة توصيل متاحة 🛵',
      body: `${e.ordersCount} طلبات من ${e.vendorName} — أجرتك ${e.totalFeeIqd.toLocaleString('en')} د.ع`,
      data: { type: 'batch:offered', batchId: e.batchId },
    });
  }
}
