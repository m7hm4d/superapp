import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApprovalStatus,
  BATCH_ACTIVE_STATUSES,
  BatchStatus,
  OrderStatus,
  Role,
} from '@superapp/shared';
import type { BatchStopView, BatchView, LatLng } from '@superapp/shared';
import { and, asc, eq, gt, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import {
  batchOrders,
  batches,
  driverProfiles,
  exceptions,
  orders,
  vendorProfiles,
} from '../../db/schema';
import type {
  BatchStatusDomainEvent,
  OrderStatusDomainEvent,
} from '../../realtime/events.publisher';
import { LedgerService } from '../ledger/ledger.service';
import { OrdersService } from '../orders/orders.service';
import { maskPhone } from './phone-mask';

/** توقف الدفعة كما يراه السائق: BatchStopView + وقت التسليم */
export interface DriverBatchStop extends BatchStopView {
  deliveredAt: string | null;
}

export interface DriverBatchView extends BatchView {
  stops: DriverBatchStop[];
}

export interface ReportExceptionInput {
  type:
    | 'customer_unavailable'
    | 'address_unclear'
    | 'customer_refused'
    | 'cash_discrepancy'
    | 'other';
  note?: string;
}

interface DriverProfileRef {
  id: string;
  cityId: string;
  isAvailable: boolean;
  approvalStatus: string;
}

/**
 * مسارات السائق: التوفر والموقع، عرض الدفعات والمطالبة الذرية بها،
 * تأكيد الاستلام والتسليم بـ PIN، والاستثناءات — دفعة حية واحدة لكل سائق.
 */
@Injectable()
export class DriversService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly ordersService: OrdersService,
    private readonly ledgerService: LedgerService,
    private readonly emitter: EventEmitter2,
  ) {}

  // ─────────────────────────────── الملف الشخصي ───────────────────────────────

  async setAvailability(userId: string, isAvailable: boolean): Promise<{ isAvailable: boolean }> {
    const driver = await this.requireDriverProfile(userId);
    const [updated] = await this.db
      .update(driverProfiles)
      .set({ isAvailable })
      .where(eq(driverProfiles.id, driver.id))
      .returning({ isAvailable: driverProfiles.isAvailable });
    if (!updated) {
      throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
    }
    return updated;
  }

  async pingLocation(userId: string, location: LatLng): Promise<{ ok: true }> {
    const driver = await this.requireDriverProfile(userId);
    await this.db
      .update(driverProfiles)
      .set({
        lastLocation: { lat: location.lat, lng: location.lng },
        locationUpdatedAt: new Date(),
      })
      .where(eq(driverProfiles.id, driver.id));
    return { ok: true };
  }

  // ─────────────────────────────── عرض الدفعات ───────────────────────────────

  /** عروض OFFERED في مدينة السائق — بلا توقفات قبل المطالبة */
  async listAvailableBatches(userId: string): Promise<DriverBatchView[]> {
    const driver = await this.requireDriverProfile(userId);
    const rows = await this.db
      .select({
        id: batches.id,
        status: batches.status,
        totalFeeIqd: batches.totalFeeIqd,
        totalCashIqd: batches.totalCashIqd,
        offerExpiresAt: batches.offerExpiresAt,
        vendorNameAr: vendorProfiles.storeNameAr,
        vendorAddressText: vendorProfiles.addressText,
        vendorLat: sql`ST_Y(${vendorProfiles.location}::geometry)`.mapWith(Number),
        vendorLng: sql`ST_X(${vendorProfiles.location}::geometry)`.mapWith(Number),
        ordersCount: sql`(SELECT count(*) FROM batch_orders bo WHERE bo.batch_id = ${batches.id})`.mapWith(Number),
      })
      .from(batches)
      .innerJoin(vendorProfiles, eq(vendorProfiles.id, batches.vendorId))
      .where(
        and(
          eq(batches.cityId, driver.cityId),
          eq(batches.status, BatchStatus.OFFERED),
          gt(batches.offerExpiresAt, new Date()),
        ),
      )
      .orderBy(asc(batches.offerExpiresAt));
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      vendorNameAr: r.vendorNameAr,
      vendorLat: r.vendorLat,
      vendorLng: r.vendorLng,
      vendorAddressText: r.vendorAddressText,
      ordersCount: r.ordersCount,
      totalFeeIqd: r.totalFeeIqd,
      totalCashIqd: r.totalCashIqd,
      offerExpiresAt: r.offerExpiresAt ? r.offerExpiresAt.toISOString() : null,
      stops: [],
    }));
  }

  async getActiveBatch(userId: string): Promise<DriverBatchView | null> {
    const driver = await this.requireDriverProfile(userId);
    const [batch] = await this.db
      .select({ id: batches.id })
      .from(batches)
      .where(
        and(eq(batches.driverId, driver.id), inArray(batches.status, [...BATCH_ACTIVE_STATUSES])),
      )
      .limit(1);
    if (!batch) return null;
    return this.loadBatchView(batch.id);
  }

  // ─────────────────────────────── المطالبة الذرية ───────────────────────────────

  /**
   * UPDATE واحد شرطي: العرض ما زال قائماً + لا دفعة حية أخرى لهذا السائق.
   * صفر صفوف → التشخيص: العرض ذهب (BATCH_TAKEN) أم السائق مشغول (BATCH_LIMIT).
   */
  async claimBatch(userId: string, batchId: string): Promise<DriverBatchView> {
    const driver = await this.requireDriverProfile(userId);
    if (driver.approvalStatus !== ApprovalStatus.APPROVED || !driver.isAvailable) {
      throw new ForbiddenException({ code: 'NOT_AVAILABLE' });
    }

    const result = await this.db.execute(sql`
      UPDATE batches
      SET status = 'CLAIMED', driver_id = ${driver.id}, claimed_at = now()
      WHERE id = ${batchId}
        AND status = 'OFFERED'
        AND offer_expires_at > now()
        AND NOT EXISTS (
          SELECT 1 FROM batches b2
          WHERE b2.driver_id = ${driver.id}
            AND b2.status IN ('CLAIMED', 'PICKUP_CONFIRMED', 'ACTIVE')
        )
      RETURNING id, city_id
    `);
    const rows = result.rows as { id: string; city_id: string }[];
    const claimed = rows[0];
    if (!claimed) {
      const [batch] = await this.db
        .select({ status: batches.status, offerExpiresAt: batches.offerExpiresAt })
        .from(batches)
        .where(eq(batches.id, batchId))
        .limit(1);
      const stillOffered =
        batch !== undefined &&
        batch.status === BatchStatus.OFFERED &&
        batch.offerExpiresAt !== null &&
        batch.offerExpiresAt.getTime() > Date.now();
      if (!stillOffered) {
        throw new ConflictException({ code: 'BATCH_TAKEN' });
      }
      // العرض قائم لكن UPDATE فشل → السائق لديه دفعة حية
      throw new ConflictException({ code: 'BATCH_LIMIT' });
    }

    const event: BatchStatusDomainEvent = {
      batchId: claimed.id,
      cityId: claimed.city_id,
      status: BatchStatus.CLAIMED,
      driverUserId: userId,
    };
    this.emitter.emit('batch.status', event);
    return this.loadBatchView(batchId);
  }

  // ─────────────────────────────── تأكيد الاستلام ───────────────────────────────

  /**
   * PIN الاستلام يعرضه تطبيق المخبز. في معاملة واحدة:
   * CLAIMED → PICKUP_CONFIRMED (سائق) ثم فوراً → ACTIVE (نظام)،
   * وكل طلبات الدفعة READY → IN_DELIVERY. البث بعد الالتزام.
   */
  async confirmPickup(userId: string, batchId: string, pin: string): Promise<DriverBatchView> {
    const driver = await this.requireDriverProfile(userId);

    const { cityId, orderEvents } = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM batches WHERE id = ${batchId} FOR UPDATE`);
      const [batch] = await tx.select().from(batches).where(eq(batches.id, batchId)).limit(1);
      if (!batch) {
        throw new NotFoundException({ code: 'BATCH_NOT_FOUND' });
      }
      if (batch.driverId !== driver.id) {
        throw new ForbiddenException({ code: 'FORBIDDEN' });
      }
      if (batch.status !== BatchStatus.CLAIMED) {
        throw new ConflictException({
          code: 'ILLEGAL_TRANSITION',
          from: batch.status,
          to: BatchStatus.PICKUP_CONFIRMED,
        });
      }
      if (batch.pickupPin !== pin) {
        throw new ForbiddenException({ code: 'WRONG_PIN' });
      }

      await tx
        .update(batches)
        .set({ status: BatchStatus.ACTIVE, pickupConfirmedAt: new Date() })
        .where(eq(batches.id, batchId));

      const stops = await tx
        .select({ orderId: batchOrders.orderId })
        .from(batchOrders)
        .where(eq(batchOrders.batchId, batchId))
        .orderBy(asc(batchOrders.sequence));
      const events: OrderStatusDomainEvent[] = [];
      for (const stop of stops) {
        const { event } = await this.ordersService.transition(
          tx,
          stop.orderId,
          OrderStatus.IN_DELIVERY,
          { role: 'system' },
          { reason: 'استلمها السائق' },
        );
        events.push(event);
      }
      return { cityId: batch.cityId, orderEvents: events };
    });

    for (const e of orderEvents) this.emitter.emit('order.status', e);
    const batchEvent: BatchStatusDomainEvent = {
      batchId,
      cityId,
      status: BatchStatus.ACTIVE,
      driverUserId: userId,
    };
    this.emitter.emit('batch.status', batchEvent);
    return this.loadBatchView(batchId);
  }

  // ─────────────────────────────── التسليم ───────────────────────────────

  /**
   * تسليم بـ PIN العميل مع تحصيل المبلغ الكامل بالضبط (قاعدة MVP):
   * الطلب → DELIVERED + وقت التسليم على التوقف + قيود الدفتر — كله في معاملة واحدة.
   */
  async deliverOrder(
    userId: string,
    orderId: string,
    input: { pin: string; cashCollectedIqd: number },
  ): Promise<DriverBatchView> {
    const driver = await this.requireDriverProfile(userId);
    const row = await this.findActiveBatchOrder(driver.id, orderId);
    if (row.order.status !== OrderStatus.IN_DELIVERY) {
      throw new ConflictException({
        code: 'ILLEGAL_TRANSITION',
        from: row.order.status,
        to: OrderStatus.DELIVERED,
      });
    }
    if (input.pin !== row.order.deliveryPin) {
      throw new ForbiddenException({ code: 'WRONG_PIN' });
    }
    if (input.cashCollectedIqd !== row.order.totalIqd) {
      throw new ConflictException({ code: 'CASH_MISMATCH', expected: row.order.totalIqd });
    }

    const statusEvent = await this.db.transaction(async (tx) => {
      const { event } = await this.ordersService.transition(tx, orderId, OrderStatus.DELIVERED, {
        userId,
        role: Role.DRIVER,
      });
      await tx
        .update(batchOrders)
        .set({ deliveredAt: new Date() })
        .where(eq(batchOrders.id, row.batchOrder.id));
      await this.ledgerService.recordDeliveryEntries(tx, {
        orderId,
        vendorId: row.order.vendorId,
        driverId: driver.id,
        subtotalIqd: row.order.subtotalIqd,
        deliveryFeeIqd: row.order.deliveryFeeIqd,
        commissionIqd: row.order.commissionIqd,
        totalIqd: row.order.totalIqd,
      });
      return event;
    });

    this.emitter.emit('order.status', statusEvent);
    await this.completeBatchIfDone(row.batch.id, userId);
    return this.loadBatchView(row.batch.id);
  }

  // ─────────────────────────────── الاستثناءات ───────────────────────────────

  /**
   * الاستثناء سجل وليس حالة (الملف §8.1): الطلب يبقى IN_DELIVERY،
   * لا مال يتحرك ولا أجرة — القرار للإدارة لاحقاً.
   */
  async reportException(
    userId: string,
    orderId: string,
    input: ReportExceptionInput,
  ): Promise<{ exceptionId: string; batch: DriverBatchView }> {
    const driver = await this.requireDriverProfile(userId);
    const row = await this.findActiveBatchOrder(driver.id, orderId);
    if (row.order.status !== OrderStatus.IN_DELIVERY) {
      throw new ConflictException({ code: 'ORDER_NOT_IN_DELIVERY', status: row.order.status });
    }

    const [created] = await this.db
      .insert(exceptions)
      .values({
        orderId,
        batchId: row.batch.id,
        type: input.type,
        note: input.note ?? null,
        reportedByUserId: userId,
      })
      .returning({ id: exceptions.id });
    if (!created) {
      throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
    }

    await this.completeBatchIfDone(row.batch.id, userId);
    return { exceptionId: created.id, batch: await this.loadBatchView(row.batch.id) };
  }

  // ─────────────────────────────── إتمام الدفعة ───────────────────────────────

  /** الدفعة تكتمل عندما يكون لكل توقف تسليم أو استثناء مسجل */
  async completeBatchIfDone(batchId: string, driverUserId?: string): Promise<void> {
    const exceptionForStop = this.db
      .select({ one: sql`1` })
      .from(exceptions)
      .where(and(eq(exceptions.orderId, batchOrders.orderId), eq(exceptions.batchId, batchId)));
    const [pending] = await this.db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(batchOrders)
      .where(
        and(
          eq(batchOrders.batchId, batchId),
          isNull(batchOrders.deliveredAt),
          notExists(exceptionForStop),
        ),
      );
    if (!pending || pending.count > 0) return;

    // انتقال ذري ACTIVE → COMPLETED (نظام)؛ صفر صفوف = سباق أو حالة أخرى
    const [completed] = await this.db
      .update(batches)
      .set({ status: BatchStatus.COMPLETED, completedAt: new Date() })
      .where(and(eq(batches.id, batchId), eq(batches.status, BatchStatus.ACTIVE)))
      .returning({ id: batches.id, cityId: batches.cityId });
    if (!completed) return;

    const event: BatchStatusDomainEvent = {
      batchId: completed.id,
      cityId: completed.cityId,
      status: BatchStatus.COMPLETED,
      ...(driverUserId !== undefined ? { driverUserId } : {}),
    };
    this.emitter.emit('batch.status', event);
  }

  // ─────────────────────────────── مساعدات داخلية ───────────────────────────────

  private async requireDriverProfile(userId: string): Promise<DriverProfileRef> {
    const [driver] = await this.db
      .select({
        id: driverProfiles.id,
        cityId: driverProfiles.cityId,
        isAvailable: driverProfiles.isAvailable,
        approvalStatus: driverProfiles.approvalStatus,
      })
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, userId))
      .limit(1);
    if (!driver) {
      // ApprovedGuard يمنع الوصول قبل هذا عادةً؛ حماية إضافية فقط
      throw new ForbiddenException({
        code: 'PENDING_APPROVAL',
        approvalStatus: 'missing',
        reason: null,
      });
    }
    return driver;
  }

  /** الطلب داخل الدفعة النشطة (ACTIVE) لهذا السائق تحديداً */
  private async findActiveBatchOrder(driverProfileId: string, orderId: string) {
    const [row] = await this.db
      .select({ batch: batches, batchOrder: batchOrders, order: orders })
      .from(batchOrders)
      .innerJoin(batches, eq(batches.id, batchOrders.batchId))
      .innerJoin(orders, eq(orders.id, batchOrders.orderId))
      .where(
        and(
          eq(batchOrders.orderId, orderId),
          eq(batches.driverId, driverProfileId),
          eq(batches.status, BatchStatus.ACTIVE),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    }
    return row;
  }

  private async loadBatchView(batchId: string): Promise<DriverBatchView> {
    const [row] = await this.db
      .select({
        batch: batches,
        vendorNameAr: vendorProfiles.storeNameAr,
        vendorAddressText: vendorProfiles.addressText,
        vendorLat: sql`ST_Y(${vendorProfiles.location}::geometry)`.mapWith(Number),
        vendorLng: sql`ST_X(${vendorProfiles.location}::geometry)`.mapWith(Number),
      })
      .from(batches)
      .innerJoin(vendorProfiles, eq(vendorProfiles.id, batches.vendorId))
      .where(eq(batches.id, batchId))
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'BATCH_NOT_FOUND' });
    }

    const stops = await this.db
      .select({
        orderId: orders.id,
        orderCode: orders.code,
        sequence: batchOrders.sequence,
        status: orders.status,
        addressText: orders.deliveryAddressText,
        landmark: orders.deliveryLandmark,
        lat: sql`ST_Y(${orders.deliveryLocation}::geometry)`.mapWith(Number),
        lng: sql`ST_X(${orders.deliveryLocation}::geometry)`.mapWith(Number),
        totalIqd: orders.totalIqd,
        contactPhone: orders.contactPhone,
        deliveredAt: batchOrders.deliveredAt,
      })
      .from(batchOrders)
      .innerJoin(orders, eq(orders.id, batchOrders.orderId))
      .where(eq(batchOrders.batchId, batchId))
      .orderBy(asc(batchOrders.sequence));

    return {
      id: row.batch.id,
      status: row.batch.status,
      vendorNameAr: row.vendorNameAr,
      vendorLat: row.vendorLat,
      vendorLng: row.vendorLng,
      vendorAddressText: row.vendorAddressText,
      ordersCount: stops.length,
      totalFeeIqd: row.batch.totalFeeIqd,
      totalCashIqd: row.batch.totalCashIqd,
      offerExpiresAt: row.batch.offerExpiresAt ? row.batch.offerExpiresAt.toISOString() : null,
      stops: stops.map((s) => ({
        orderId: s.orderId,
        orderCode: s.orderCode,
        sequence: s.sequence,
        status: s.status,
        addressText: s.addressText,
        landmark: s.landmark,
        lat: s.lat,
        lng: s.lng,
        totalIqd: s.totalIqd,
        contactPhoneMasked: maskPhone(s.contactPhone),
        deliveredAt: s.deliveredAt ? s.deliveredAt.toISOString() : null,
      })),
    };
  }
}
