import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CancelledBy, OrderStatus } from '@superapp/shared';
import { and, eq, lt } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { orders } from '../../db/schema';
import { OrdersService } from './orders.service';

const VENDOR_ACCEPT_TIMEOUT_REASON = 'انتهاء مهلة قبول المخبز';

/** مؤقتات آلة 1: إلغاء الطلبات المعلقة بعد انقضاء مهلة قبول المخبز */
@Injectable()
export class OrdersTimersService {
  private readonly logger = new Logger(OrdersTimersService.name);
  private running = false;

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly ordersService: OrdersService,
  ) {}

  @Interval(30_000)
  async expirePendingOrders(): Promise<void> {
    if (this.running) return; // منع التداخل بين الدورات
    this.running = true;
    try {
      const expired = await this.db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.status, OrderStatus.PENDING_BAKERY),
            lt(orders.acceptTimeoutAt, new Date()),
          ),
        )
        .limit(200);

      for (const { id } of expired) {
        try {
          await this.ordersService.transitionOrder(
            id,
            OrderStatus.CANCELLED,
            { role: 'system' },
            { reason: VENDOR_ACCEPT_TIMEOUT_REASON, cancelledBy: CancelledBy.SYSTEM },
          );
        } catch (err) {
          // سباق مع قبول المخبز في اللحظة الأخيرة: الانتقال صار غير قانوني — نتجاهل
          if (err instanceof ConflictException) continue;
          this.logger.error(
            { orderId: id, err },
            'failed to expire pending order',
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
