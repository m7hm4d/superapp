import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { BatchStatus, FeatureFlagKey, OrderStatus } from '@superapp/shared';
import { and, asc, eq, inArray, lt, notExists, sql } from 'drizzle-orm';
import { generatePin } from '../../common/codes';
import { DB, DbClient } from '../../db/drizzle.module';
import {
  batchOrders,
  batches,
  cities,
  featureFlags,
  orders,
  vendorProfiles,
} from '../../db/schema';
import type {
  BatchOfferedDomainEvent,
  BatchStatusDomainEvent,
} from '../../realtime/events.publisher';
import type { DbTx, OrderReadyDomainEvent } from '../orders/orders.service';

/** الحالات التي تعتبر فيها الدفعة "حية" وتحجز طلباتها */
const LIVE_BATCH_STATUSES = [
  BatchStatus.OFFERED,
  BatchStatus.CLAIMED,
  BatchStatus.PICKUP_CONFIRMED,
  BatchStatus.ACTIVE,
] as const;

const DEFAULT_MAX_BATCH_SIZE = 3;
const DEFAULT_BATCH_WINDOW_SEC = 75;

/**
 * محرك الدفعات (آلة 2): الخادم يجمع 1–3 طلبات READY من المخبز نفسه
 * في دفعة واحدة تُعرض على سائقي المدينة، مع نافذة تجميع لكل بائع.
 */
@Injectable()
export class BatchingService implements OnModuleDestroy {
  private readonly logger = new Logger(BatchingService.name);
  /** مؤقت اقتراح واحد لكل بائع: طلبات READY المتعددة داخل النافذة تنهار لاقتراح واحد */
  private readonly windowTimers = new Map<string, NodeJS.Timeout>();
  private fallbackRunning = false;
  private expiryRunning = false;

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly emitter: EventEmitter2,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.windowTimers.values()) clearTimeout(timer);
    this.windowTimers.clear();
  }

  // ─────────────────────────── نافذة التجميع لكل بائع ───────────────────────────

  @OnEvent('order.ready')
  async onOrderReady(e: OrderReadyDomainEvent): Promise<void> {
    if (this.windowTimers.has(e.vendorProfileId)) return;
    try {
      const [city] = await this.db
        .select({ batchWindowSec: cities.batchWindowSec })
        .from(cities)
        .where(eq(cities.id, e.cityId))
        .limit(1);
      const windowSec = city?.batchWindowSec ?? DEFAULT_BATCH_WINDOW_SEC;
      // سباق محتمل أثناء قراءة المدينة: مؤقت آخر سُجل لهذا البائع
      if (this.windowTimers.has(e.vendorProfileId)) return;
      const timer = setTimeout(() => {
        this.windowTimers.delete(e.vendorProfileId);
        void this.proposeBatches(e.vendorProfileId).catch((err) =>
          this.logger.error({ vendorId: e.vendorProfileId, err }, 'proposeBatches failed'),
        );
      }, windowSec * 1000);
      this.windowTimers.set(e.vendorProfileId, timer);
    } catch (err) {
      this.logger.error(
        { vendorId: e.vendorProfileId, err },
        'failed to schedule batch proposal',
      );
    }
  }

  // ─────────────────────────────── اقتراح الدفعات ───────────────────────────────

  /**
   * يجمع طلبات READY غير المحجوزة في دفعة حية لهذا البائع، الأقدم أولاً،
   * ويقسمها إلى دفعات OFFERED (حتى batch.max_size) مع ترتيب توقفات
   * "الأقرب من موقع البائع أولاً" عبر ST_Distance. البث بعد الالتزام.
   */
  async proposeBatches(vendorId: string): Promise<void> {
    const offered = await this.db.transaction(async (tx) => {
      const [vendor] = await tx
        .select({
          id: vendorProfiles.id,
          cityId: vendorProfiles.cityId,
          storeNameAr: vendorProfiles.storeNameAr,
          location: vendorProfiles.location,
          batchOfferTtlSec: cities.batchOfferTtlSec,
        })
        .from(vendorProfiles)
        .innerJoin(cities, eq(cities.id, vendorProfiles.cityId))
        .where(eq(vendorProfiles.id, vendorId))
        .limit(1);
      if (!vendor) return [] as BatchOfferedDomainEvent[];

      const vendorPoint = sql`ST_SetSRID(ST_MakePoint(${vendor.location.lng}, ${vendor.location.lat}), 4326)::geography`;
      // الدفعات المنتهية/الملغاة تحرر طلباتها بحذف صفوف batch_orders،
      // لذا يكفي NOT EXISTS على الصفوف المرتبطة بدفعة حية.
      const liveBatchForOrder = tx
        .select({ one: sql`1` })
        .from(batchOrders)
        .innerJoin(batches, eq(batches.id, batchOrders.batchId))
        .where(
          and(
            eq(batchOrders.orderId, orders.id),
            inArray(batches.status, [...LIVE_BATCH_STATUSES]),
          ),
        );

      const ready = await tx
        .select({
          id: orders.id,
          deliveryFeeIqd: orders.deliveryFeeIqd,
          totalIqd: orders.totalIqd,
          distanceM: sql`ST_Distance(${vendorPoint}, ${orders.deliveryLocation})`.mapWith(Number),
        })
        .from(orders)
        .where(
          and(
            eq(orders.vendorId, vendorId),
            eq(orders.status, OrderStatus.READY),
            notExists(liveBatchForOrder),
          ),
        )
        .orderBy(asc(orders.createdAt))
        .for('update');
      if (ready.length === 0) return [] as BatchOfferedDomainEvent[];

      const maxSize = await this.readMaxBatchSize(tx);
      const offerExpiresAt = new Date(Date.now() + vendor.batchOfferTtlSec * 1000);
      const events: BatchOfferedDomainEvent[] = [];

      for (let i = 0; i < ready.length; i += maxSize) {
        const chunk = ready.slice(i, i + maxSize);
        const totalFeeIqd = chunk.reduce((sum, o) => sum + o.deliveryFeeIqd, 0);
        const totalCashIqd = chunk.reduce((sum, o) => sum + o.totalIqd, 0);
        const [batch] = await tx
          .insert(batches)
          .values({
            cityId: vendor.cityId,
            vendorId: vendor.id,
            status: BatchStatus.OFFERED,
            pickupPin: generatePin(),
            totalFeeIqd,
            totalCashIqd,
            offerExpiresAt,
          })
          .returning({ id: batches.id });
        if (!batch) {
          throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
        }
        // ترتيب التوقفات: الأقرب لموقع البائع أولاً
        const bySequence = [...chunk].sort((a, b) => a.distanceM - b.distanceM);
        await tx.insert(batchOrders).values(
          bySequence.map((o, idx) => ({
            batchId: batch.id,
            orderId: o.id,
            sequence: idx + 1,
          })),
        );
        events.push({
          batchId: batch.id,
          cityId: vendor.cityId,
          vendorName: vendor.storeNameAr,
          vendorLat: vendor.location.lat,
          vendorLng: vendor.location.lng,
          ordersCount: chunk.length,
          totalFeeIqd,
          offerExpiresAt: offerExpiresAt.toISOString(),
        });
      }
      return events;
    });

    for (const event of offered) this.emitter.emit('batch.offered', event);
  }

  /** علم batch.max_size بقيمة JSON مثل {"max":3} — قراءة مباشرة لتفادي دورة استيراد */
  private async readMaxBatchSize(tx: DbTx): Promise<number> {
    const [flag] = await tx
      .select({ enabled: featureFlags.enabled, value: featureFlags.value })
      .from(featureFlags)
      .where(eq(featureFlags.key, FeatureFlagKey.BATCH_MAX_SIZE))
      .limit(1);
    if (!flag || !flag.enabled || !flag.value) return DEFAULT_MAX_BATCH_SIZE;
    try {
      const parsed = JSON.parse(flag.value) as { max?: unknown };
      if (typeof parsed.max === 'number' && Number.isInteger(parsed.max) && parsed.max >= 1) {
        return parsed.max;
      }
    } catch {
      // قيمة غير صالحة → الافتراضي
    }
    return DEFAULT_MAX_BATCH_SIZE;
  }

  // ─────────────────────────────── مكانس دورية ───────────────────────────────

  /** شبكة أمان: طلبات READY فاتتها الأحداث (إعادة تشغيل مثلاً) تُدفّع بعد ضعف النافذة */
  @Interval(60_000)
  async sweepUnbatchedReadyOrders(): Promise<void> {
    if (this.fallbackRunning) return;
    this.fallbackRunning = true;
    try {
      const result = await this.db.execute(sql`
        SELECT DISTINCT o.vendor_id AS vendor_id
        FROM orders o
        JOIN vendor_profiles vp ON vp.id = o.vendor_id
        JOIN cities c ON c.id = vp.city_id
        WHERE o.status = 'READY'
          AND coalesce(o.ready_at, o.created_at) < now() - make_interval(secs => c.batch_window_sec * 2)
          AND NOT EXISTS (
            SELECT 1
            FROM batch_orders bo
            JOIN batches b ON b.id = bo.batch_id
            WHERE bo.order_id = o.id
              AND b.status IN ('OFFERED', 'CLAIMED', 'PICKUP_CONFIRMED', 'ACTIVE')
          )
      `);
      const rows = result.rows as { vendor_id: string }[];
      for (const row of rows) {
        try {
          await this.proposeBatches(row.vendor_id);
        } catch (err) {
          this.logger.error({ vendorId: row.vendor_id, err }, 'fallback proposeBatches failed');
        }
      }
    } finally {
      this.fallbackRunning = false;
    }
  }

  /** انتهاء العروض: OFFERED بعد offerExpiresAt → EXPIRED، تحرير الطلبات، ثم إعادة العرض فوراً */
  @Interval(15_000)
  async sweepExpiredOffers(): Promise<void> {
    if (this.expiryRunning) return;
    this.expiryRunning = true;
    try {
      const expired = await this.db.transaction(async (tx) => {
        const rows = await tx
          .update(batches)
          .set({ status: BatchStatus.EXPIRED })
          .where(
            and(eq(batches.status, BatchStatus.OFFERED), lt(batches.offerExpiresAt, new Date())),
          )
          .returning({ id: batches.id, cityId: batches.cityId, vendorId: batches.vendorId });
        if (rows.length > 0) {
          await tx.delete(batchOrders).where(
            inArray(
              batchOrders.batchId,
              rows.map((r) => r.id),
            ),
          );
        }
        return rows;
      });
      if (expired.length === 0) return;

      for (const b of expired) {
        const event: BatchStatusDomainEvent = {
          batchId: b.id,
          cityId: b.cityId,
          status: BatchStatus.EXPIRED,
        };
        this.emitter.emit('batch.status', event);
      }
      // إعادة عرض فورية بلا backoff في الـ MVP
      for (const vendorId of new Set(expired.map((b) => b.vendorId))) {
        try {
          await this.proposeBatches(vendorId);
        } catch (err) {
          this.logger.error({ vendorId, err }, 're-offer after expiry failed');
        }
      }
    } finally {
      this.expiryRunning = false;
    }
  }
}
