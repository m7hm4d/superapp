import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BATCH_TRANSITIONS,
  BatchStatus,
  CancelledBy,
  ExceptionStatus,
  OrderStatus,
  Role,
  SettlementStatus,
  canTransition,
  zPagination,
  zResolveException,
  zUuid,
} from '@superapp/shared';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { DB, type DbClient } from '../../db/drizzle.module';
import {
  batchOrders,
  batches,
  driverProfiles,
  exceptions,
  ledgerEntries,
  orders,
  settlements,
  users,
  vendorProfiles,
} from '../../db/schema';
import { LedgerService } from '../ledger/ledger.service';
import { OrdersService } from '../orders/orders.service';
import type {
  BatchStatusDomainEvent,
  OrderStatusDomainEvent,
} from '../../realtime/events.publisher';

// ---------- مخططات الاستعلام المحلية (نمط zAdminUsersQuery في admin.service) ----------

export const zAdminBatchesQuery = z
  .object({ status: z.nativeEnum(BatchStatus).optional() })
  .merge(zPagination);
export type AdminBatchesQuery = z.infer<typeof zAdminBatchesQuery>;

export const zCancelBatch = z.object({ reason: z.string().min(2).max(500) });
export type CancelBatchInput = z.infer<typeof zCancelBatch>;

export const zAdminExceptionsQuery = z
  .object({ status: z.nativeEnum(ExceptionStatus).default(ExceptionStatus.OPEN) })
  .merge(zPagination);
export type AdminExceptionsQuery = z.infer<typeof zAdminExceptionsQuery>;

export type ResolveExceptionInput = z.infer<typeof zResolveException>;

export const zAdminFinanceQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AdminFinanceQuery = z.infer<typeof zAdminFinanceQuery>;

export const zAdminLedgerQuery = z
  .object({
    vendorId: zUuid.optional(),
    driverId: zUuid.optional(),
    orderId: zUuid.optional(),
  })
  .merge(zPagination);
export type AdminLedgerQuery = z.infer<typeof zAdminLedgerQuery>;

export const zReverseEntry = z.object({ reason: z.string().min(2).max(500) });
export type ReverseEntryInput = z.infer<typeof zReverseEntry>;

export const zAdminSettlementsQuery = z
  .object({ status: z.nativeEnum(SettlementStatus).optional() })
  .merge(zPagination);
export type AdminSettlementsQuery = z.infer<typeof zAdminSettlementsQuery>;

export const zResolveSettlement = z.object({ reason: z.string().min(2).max(500) });
export type ResolveSettlementInput = z.infer<typeof zResolveSettlement>;

/**
 * عمليات الإدارة على الدفعات/الاستثناءات/المال (M2):
 * قراءات مباشرة عبر drizzle، انتقالات الطلب عبر OrdersService (آلة 1)،
 * وقيود الدفتر عبر LedgerService — كل تغيير يُدقَّق في المتحكمات عبر AuditService.
 */
@Injectable()
export class OpsService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly ordersService: OrdersService,
    private readonly ledgerService: LedgerService,
    private readonly emitter: EventEmitter2,
  ) {}

  // ---------- الدفعات ----------

  async listBatches(q: AdminBatchesQuery) {
    const where = q.status !== undefined ? eq(batches.status, q.status) : undefined;

    const [items, countRows] = await Promise.all([
      this.db
        .select({
          id: batches.id,
          cityId: batches.cityId,
          status: batches.status,
          vendorId: batches.vendorId,
          vendorStoreNameAr: vendorProfiles.storeNameAr,
          driverId: batches.driverId,
          driverName: users.fullName,
          totalFeeIqd: batches.totalFeeIqd,
          totalCashIqd: batches.totalCashIqd,
          ordersCount: sql<number>`(select count(*)::int from ${batchOrders} bo where bo.batch_id = ${batches.id})`,
          deliveredCount: sql<number>`(select count(*)::int from ${batchOrders} bo where bo.batch_id = ${batches.id} and bo.delivered_at is not null)`,
          offerExpiresAt: batches.offerExpiresAt,
          claimedAt: batches.claimedAt,
          pickupConfirmedAt: batches.pickupConfirmedAt,
          completedAt: batches.completedAt,
          cancelledReason: batches.cancelledReason,
          createdAt: batches.createdAt,
        })
        .from(batches)
        .innerJoin(vendorProfiles, eq(vendorProfiles.id, batches.vendorId))
        .leftJoin(driverProfiles, eq(driverProfiles.id, batches.driverId))
        .leftJoin(users, eq(users.id, driverProfiles.userId))
        .where(where)
        .orderBy(desc(batches.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(batches).where(where),
    ]);

    return { items, total: countRows[0]?.count ?? 0, limit: q.limit, offset: q.offset };
  }

  /**
   * إلغاء إداري للدفعة: مسموح لـ OFFERED/CLAIMED فقط (آلة 2 بفاعل admin).
   * تُحذف صفوف batch_orders لتحرير الطلبات — ما زالت READY وسيعيد
   * محرك الدفعات التقاطها في الكنس الاحتياطي. البث بعد الالتزام.
   */
  async cancelBatch(batchId: string, adminUserId: string, reason: string) {
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM batches WHERE id = ${batchId} FOR UPDATE`);
      const [batch] = await tx.select().from(batches).where(eq(batches.id, batchId)).limit(1);
      if (!batch) {
        throw new NotFoundException({ code: 'BATCH_NOT_FOUND' });
      }

      const from = batch.status;
      const cancellable = from === BatchStatus.OFFERED || from === BatchStatus.CLAIMED;
      if (
        !cancellable ||
        !canTransition(BATCH_TRANSITIONS, from, BatchStatus.CANCELLED, Role.ADMIN)
      ) {
        throw new ConflictException({
          code: 'ILLEGAL_TRANSITION',
          from,
          to: BatchStatus.CANCELLED,
        });
      }

      const released = await tx
        .delete(batchOrders)
        .where(eq(batchOrders.batchId, batchId))
        .returning({ orderId: batchOrders.orderId });

      const [updated] = await tx
        .update(batches)
        .set({ status: BatchStatus.CANCELLED, cancelledReason: reason })
        .where(eq(batches.id, batchId))
        .returning();
      if (!updated) {
        throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
      }

      let driverUserId: string | undefined;
      if (batch.driverId) {
        const [driver] = await tx
          .select({ userId: driverProfiles.userId })
          .from(driverProfiles)
          .where(eq(driverProfiles.id, batch.driverId))
          .limit(1);
        driverUserId = driver?.userId;
      }

      return {
        batch: updated,
        releasedOrderIds: released.map((r) => r.orderId),
        driverUserId,
      };
    });

    const event: BatchStatusDomainEvent = {
      batchId: result.batch.id,
      cityId: result.batch.cityId,
      status: BatchStatus.CANCELLED,
      vendorProfileId: result.batch.vendorId,
      ...(result.driverUserId !== undefined ? { driverUserId: result.driverUserId } : {}),
    };
    this.emitter.emit('batch.status', event);

    return { batch: result.batch, releasedOrderIds: result.releasedOrderIds };
  }

  // ---------- الاستثناءات ----------

  async listExceptions(q: AdminExceptionsQuery) {
    const where = eq(exceptions.status, q.status);

    const [items, countRows] = await Promise.all([
      this.db
        .select({
          id: exceptions.id,
          type: exceptions.type,
          status: exceptions.status,
          note: exceptions.note,
          orderId: exceptions.orderId,
          orderCode: orders.code,
          orderStatus: orders.status,
          vendorId: orders.vendorId,
          vendorStoreNameAr: vendorProfiles.storeNameAr,
          batchId: exceptions.batchId,
          reportedByUserId: exceptions.reportedByUserId,
          reporterName: users.fullName,
          ownerAdminId: exceptions.ownerAdminId,
          decision: exceptions.decision,
          decisionReason: exceptions.decisionReason,
          createdAt: exceptions.createdAt,
          resolvedAt: exceptions.resolvedAt,
        })
        .from(exceptions)
        .leftJoin(orders, eq(orders.id, exceptions.orderId))
        .leftJoin(vendorProfiles, eq(vendorProfiles.id, orders.vendorId))
        .leftJoin(users, eq(users.id, exceptions.reportedByUserId))
        .where(where)
        .orderBy(desc(exceptions.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(exceptions).where(where),
    ]);

    return { items, total: countRows[0]?.count ?? 0, limit: q.limit, offset: q.offset };
  }

  /**
   * قرار إداري على استثناء مفتوح — كل شيء في معاملة واحدة:
   * - retry_delivery / noted: إغلاق السجل فقط (الطلب يبقى كما هو).
   * - cancel_order: إغلاق + إلغاء الطلب عبر آلة الحالة بفاعل admin.
   * - mark_delivered: إغلاق + DELIVERED عبر آلة الحالة + قيود الدفتر الأربعة
   *   في المعاملة نفسها (السائق من batch_orders ⨝ batches).
   * بث order.status بعد الالتزام عند تغيّر الطلب.
   */
  async resolveException(
    exceptionId: string,
    adminUserId: string,
    input: ResolveExceptionInput,
  ) {
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM exceptions WHERE id = ${exceptionId} FOR UPDATE`);
      const [exception] = await tx
        .select()
        .from(exceptions)
        .where(eq(exceptions.id, exceptionId))
        .limit(1);
      if (!exception) {
        throw new NotFoundException({ code: 'EXCEPTION_NOT_FOUND' });
      }
      if (exception.status !== ExceptionStatus.OPEN) {
        throw new ConflictException({ code: 'EXCEPTION_ALREADY_RESOLVED' });
      }

      const now = new Date();
      let orderEvent: OrderStatusDomainEvent | undefined;

      if (input.decision === 'cancel_order' || input.decision === 'mark_delivered') {
        if (!exception.orderId) {
          throw new ConflictException({ code: 'EXCEPTION_HAS_NO_ORDER' });
        }
      }

      if (input.decision === 'cancel_order' && exception.orderId) {
        // لا قيود دفتر لطلب فاشل — لم تُكتب أصلاً قبل DELIVERED
        const { event } = await this.ordersService.transition(
          tx,
          exception.orderId,
          OrderStatus.CANCELLED,
          { userId: adminUserId, role: Role.ADMIN },
          { reason: input.reason, cancelledBy: CancelledBy.ADMIN },
        );
        orderEvent = event;
      } else if (input.decision === 'mark_delivered' && exception.orderId) {
        const { order, event } = await this.ordersService.transition(
          tx,
          exception.orderId,
          OrderStatus.DELIVERED,
          { userId: adminUserId, role: Role.ADMIN },
          { reason: input.reason },
        );
        orderEvent = event;

        const [assignment] = await tx
          .select({ driverId: batches.driverId })
          .from(batchOrders)
          .innerJoin(batches, eq(batches.id, batchOrders.batchId))
          .where(eq(batchOrders.orderId, exception.orderId))
          .limit(1);
        if (!assignment || !assignment.driverId) {
          throw new ConflictException({ code: 'NO_DRIVER_FOR_ORDER' });
        }

        await this.ledgerService.recordDeliveryEntries(tx, {
          orderId: order.id,
          vendorId: order.vendorId,
          driverId: assignment.driverId,
          subtotalIqd: order.subtotalIqd,
          deliveryFeeIqd: order.deliveryFeeIqd,
          commissionIqd: order.commissionIqd,
          totalIqd: order.totalIqd,
        });

        await tx
          .update(batchOrders)
          .set({ deliveredAt: now })
          .where(eq(batchOrders.orderId, exception.orderId));
      }
      // retry_delivery: الطلب يبقى IN_DELIVERY لمحاولة أخرى. noted: إغلاق فقط.

      const [updated] = await tx
        .update(exceptions)
        .set({
          status: ExceptionStatus.RESOLVED,
          decision: input.decision,
          decisionReason: input.reason,
          ownerAdminId: adminUserId,
          resolvedAt: now,
        })
        .where(eq(exceptions.id, exceptionId))
        .returning();
      if (!updated) {
        throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
      }

      return { exception: updated, orderEvent };
    });

    if (result.orderEvent) {
      this.emitter.emit('order.status', result.orderEvent);
    }
    return { exception: result.exception };
  }

  // ---------- المال ----------

  async financeSummary(q: AdminFinanceQuery) {
    const deliveredConds: SQL[] = [eq(orders.status, OrderStatus.DELIVERED)];
    if (q.from !== undefined) deliveredConds.push(gte(orders.deliveredAt, q.from));
    if (q.to !== undefined) deliveredConds.push(lte(orders.deliveredAt, q.to));

    const cancelledConds: SQL[] = [eq(orders.status, OrderStatus.CANCELLED)];
    if (q.from !== undefined) cancelledConds.push(gte(orders.cancelledAt, q.from));
    if (q.to !== undefined) cancelledConds.push(lte(orders.cancelledAt, q.to));

    const [deliveredAggRows, cancelledAggRows, driverRows] = await Promise.all([
      this.db
        .select({
          gmvIqd: sql`coalesce(sum(${orders.subtotalIqd}), 0)`.mapWith(Number),
          feesIqd: sql`coalesce(sum(${orders.deliveryFeeIqd}), 0)`.mapWith(Number),
          commissionIqd: sql`coalesce(sum(${orders.commissionIqd}), 0)`.mapWith(Number),
          deliveredCount: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(and(...deliveredConds)),
      this.db
        .select({ cancelledCount: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(...cancelledConds)),
      // النقد بذمة كل سائق: cash_collected موجبة + settlement سالبة (عقد الدفتر)،
      // وأقدم قيد تحصيل لم يظهر طلبه في order_ids لأي تسوية SETTLED لهذا السائق
      this.db
        .select({
          driverId: driverProfiles.id,
          driverName: users.fullName,
          cashOnHandIqd:
            sql`coalesce(sum(case when ${ledgerEntries.entryType} in ('cash_collected', 'settlement') then ${ledgerEntries.amountIqd} else 0 end), 0)`.mapWith(
              Number,
            ),
          oldestUnsettledAt: sql<Date | null>`min(${ledgerEntries.createdAt}) filter (where ${ledgerEntries.entryType} = 'cash_collected' and ${ledgerEntries.orderId} is not null and not exists (select 1 from ${settlements} s where s.driver_id = ${driverProfiles.id} and s.status = 'SETTLED' and s.order_ids::jsonb ? ${ledgerEntries.orderId}::text))`,
        })
        .from(ledgerEntries)
        .innerJoin(driverProfiles, eq(driverProfiles.id, ledgerEntries.driverId))
        .innerJoin(users, eq(users.id, driverProfiles.userId))
        .groupBy(driverProfiles.id, users.fullName),
    ]);

    const deliveredAgg = deliveredAggRows[0];
    const outstandingByDriver = driverRows
      .filter((d) => d.cashOnHandIqd > 0)
      .sort((a, b) => b.cashOnHandIqd - a.cashOnHandIqd)
      .map((d) => ({
        driverId: d.driverId,
        driverName: d.driverName,
        cashOnHandIqd: d.cashOnHandIqd,
        oldestUnsettledAt: d.oldestUnsettledAt,
      }));

    return {
      gmvIqd: deliveredAgg?.gmvIqd ?? 0,
      feesIqd: deliveredAgg?.feesIqd ?? 0,
      commissionIqd: deliveredAgg?.commissionIqd ?? 0,
      deliveredCount: deliveredAgg?.deliveredCount ?? 0,
      cancelledCount: cancelledAggRows[0]?.cancelledCount ?? 0,
      outstandingByDriver,
    };
  }

  async listLedger(q: AdminLedgerQuery) {
    const conditions: SQL[] = [];
    if (q.vendorId !== undefined) conditions.push(eq(ledgerEntries.vendorId, q.vendorId));
    if (q.driverId !== undefined) conditions.push(eq(ledgerEntries.driverId, q.driverId));
    if (q.orderId !== undefined) conditions.push(eq(ledgerEntries.orderId, q.orderId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countRows] = await Promise.all([
      this.db
        .select()
        .from(ledgerEntries)
        .where(where)
        .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(ledgerEntries).where(where),
    ]);

    return { items, total: countRows[0]?.count ?? 0, limit: q.limit, offset: q.offset };
  }

  /** عكس قيد دفتر — الحركة العكسية عبر LedgerService (append-only، لا حذف) */
  async reverseLedgerEntry(entryId: string, adminUserId: string, note: string) {
    return this.ledgerService.reverseEntry(entryId, adminUserId, note);
  }

  // ---------- التسويات ----------

  async listSettlements(q: AdminSettlementsQuery) {
    const where = q.status !== undefined ? eq(settlements.status, q.status) : undefined;

    const [rows, countRows] = await Promise.all([
      this.db
        .select({
          id: settlements.id,
          status: settlements.status,
          vendorId: settlements.vendorId,
          vendorStoreNameAr: vendorProfiles.storeNameAr,
          driverId: settlements.driverId,
          driverName: users.fullName,
          amountIqd: settlements.amountIqd,
          orderIds: settlements.orderIds,
          disputeReason: settlements.disputeReason,
          createdAt: settlements.createdAt,
          settledAt: settlements.settledAt,
        })
        .from(settlements)
        .innerJoin(vendorProfiles, eq(vendorProfiles.id, settlements.vendorId))
        .innerJoin(driverProfiles, eq(driverProfiles.id, settlements.driverId))
        .innerJoin(users, eq(users.id, driverProfiles.userId))
        .where(where)
        .orderBy(desc(settlements.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(settlements).where(where),
    ]);

    const items = rows.map((r) => ({ ...r, orderIds: this.parseOrderIds(r.orderIds) }));
    return { items, total: countRows[0]?.count ?? 0, limit: q.limit, offset: q.offset };
  }

  private parseOrderIds(raw: string): string[] {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === 'string')
        : [];
    } catch {
      return [];
    }
  }
}
