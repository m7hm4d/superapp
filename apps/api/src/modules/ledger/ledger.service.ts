import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { LedgerEntryType, OrderStatus, SettlementStatus } from '@superapp/shared';
import type { LedgerSummaryView } from '@superapp/shared';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { driverProfiles, ledgerEntries, orders, settlements, users, vendorProfiles } from '../../db/schema';

/** نوع معاملة Drizzle — مطابق بنيوياً لنوع orders.service (استخراج من DbClient نفسه) */
export type DbTx = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;

export interface RecordDeliveryEntriesArgs {
  orderId: string;
  vendorId: string;
  driverId: string;
  subtotalIqd: number;
  deliveryFeeIqd: number;
  commissionIqd: number;
  totalIqd: number;
}

export interface RecordSettlementEntriesArgs {
  settlementId: string;
  vendorId: string;
  driverId: string;
  amountIqd: number;
}

export interface DriverOwedByVendorRow {
  vendorId: string;
  storeNameAr: string;
  amountIqd: number;
  orderIds: string[];
}

export interface VendorOutstandingByDriverRow {
  driverId: string;
  driverName: string;
  amountIqd: number;
  orderIds: string[];
}

/** يفكّ order_ids المخزنة كسلسلة JSON؛ يعيد [] عند أي تلف */
export function parseOrderIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * الدفتر append-only: لا حذف ولا تعديل — التصحيح بحركة عكسية فقط (الملف §9).
 * قيود التسليم تُكتب في نفس معاملة انتقال الطلب إلى DELIVERED.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // ─────────────────────────── الكتابة داخل معاملات المستدعي ───────────────────────────

  /** 4 قيود ذرّية عند DELIVERED: بيع، أجرة توصيل، عمولة منصة، نقد محصَّل */
  async recordDeliveryEntries(tx: DbTx, args: RecordDeliveryEntriesArgs): Promise<void> {
    await tx.insert(ledgerEntries).values([
      {
        entryType: LedgerEntryType.ORDER_SALE,
        orderId: args.orderId,
        vendorId: args.vendorId,
        amountIqd: args.subtotalIqd,
      },
      {
        entryType: LedgerEntryType.DELIVERY_FEE,
        orderId: args.orderId,
        driverId: args.driverId,
        amountIqd: args.deliveryFeeIqd,
      },
      {
        // العمولة قد تكون صفراً في الطيار — تُسجل دائماً لثبات الشكل المحاسبي
        entryType: LedgerEntryType.PLATFORM_COMMISSION,
        orderId: args.orderId,
        amountIqd: args.commissionIqd,
      },
      {
        entryType: LedgerEntryType.CASH_COLLECTED,
        orderId: args.orderId,
        driverId: args.driverId,
        amountIqd: args.totalIqd,
      },
    ]);
  }

  /** قيدا تسوية متقابلان: نقد يغادر ذمة السائق ويدخل ذمة المخبز */
  async recordSettlementEntries(tx: DbTx, args: RecordSettlementEntriesArgs): Promise<void> {
    await tx.insert(ledgerEntries).values([
      {
        entryType: LedgerEntryType.SETTLEMENT,
        settlementId: args.settlementId,
        driverId: args.driverId,
        amountIqd: -args.amountIqd,
      },
      {
        entryType: LedgerEntryType.SETTLEMENT,
        settlementId: args.settlementId,
        vendorId: args.vendorId,
        amountIqd: args.amountIqd,
      },
    ]);
  }

  // ─────────────────────────────── أرصدة واستحقاقات ───────────────────────────────

  /**
   * النقد بيد السائق = مجموع cash_collected − ما سُوّي.
   * قيود settlement للسائق مخزنة بإشارة سالبة، فالجمع الموقّع يعطي الناتج مباشرة.
   */
  async driverCashOnHand(driverId: string): Promise<number> {
    const [row] = await this.db
      .select({
        total: sql`coalesce(sum(${ledgerEntries.amountIqd}), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.driverId, driverId),
          inArray(ledgerEntries.entryType, [
            LedgerEntryType.CASH_COLLECTED,
            LedgerEntryType.SETTLEMENT,
          ]),
        ),
      );
    return row?.total ?? 0;
  }

  /**
   * ما بذمة السائق لكل مخبز: مجاميع subtotal للطلبات المسلّمة غير المسوّاة.
   * الطلب يُستبعد إذا ظهر معرفه في order_ids لتسوية SETTLED لهذا السائق.
   */
  async driverOwedByVendor(driverId: string): Promise<DriverOwedByVendorRow[]> {
    const rows = await this.db
      .select({
        orderId: orders.id,
        vendorId: orders.vendorId,
        storeNameAr: vendorProfiles.storeNameAr,
        subtotalIqd: orders.subtotalIqd,
      })
      .from(ledgerEntries)
      .innerJoin(orders, eq(orders.id, ledgerEntries.orderId))
      .innerJoin(vendorProfiles, eq(vendorProfiles.id, orders.vendorId))
      .where(
        and(
          eq(ledgerEntries.driverId, driverId),
          eq(ledgerEntries.entryType, LedgerEntryType.CASH_COLLECTED),
        ),
      );

    const settledOrderIds = await this.settledOrderIdsFor({ driverId });

    const byVendor = new Map<string, DriverOwedByVendorRow>();
    const seenOrders = new Set<string>();
    for (const row of rows) {
      if (seenOrders.has(row.orderId) || settledOrderIds.has(row.orderId)) continue;
      seenOrders.add(row.orderId);
      const existing = byVendor.get(row.vendorId);
      if (existing) {
        existing.amountIqd += row.subtotalIqd;
        existing.orderIds.push(row.orderId);
      } else {
        byVendor.set(row.vendorId, {
          vendorId: row.vendorId,
          storeNameAr: row.storeNameAr,
          amountIqd: row.subtotalIqd,
          orderIds: [row.orderId],
        });
      }
    }
    return [...byVendor.values()]
      .filter((v) => v.amountIqd > 0)
      .sort((a, b) => b.amountIqd - a.amountIqd);
  }

  /** المقلوب لشاشة المخبز: مستحقاته لدى كل سائق من طلبات مسلّمة غير مسوّاة */
  async vendorOutstandingByDriver(vendorId: string): Promise<VendorOutstandingByDriverRow[]> {
    const rows = await this.db
      .select({
        orderId: orders.id,
        driverId: driverProfiles.id,
        driverName: users.fullName,
        subtotalIqd: orders.subtotalIqd,
      })
      .from(ledgerEntries)
      .innerJoin(orders, eq(orders.id, ledgerEntries.orderId))
      .innerJoin(driverProfiles, eq(driverProfiles.id, ledgerEntries.driverId))
      .innerJoin(users, eq(users.id, driverProfiles.userId))
      .where(
        and(
          eq(orders.vendorId, vendorId),
          eq(ledgerEntries.entryType, LedgerEntryType.CASH_COLLECTED),
        ),
      );

    const settledOrderIds = await this.settledOrderIdsFor({ vendorId });

    const byDriver = new Map<string, VendorOutstandingByDriverRow>();
    const seenOrders = new Set<string>();
    for (const row of rows) {
      if (seenOrders.has(row.orderId) || settledOrderIds.has(row.orderId)) continue;
      seenOrders.add(row.orderId);
      const existing = byDriver.get(row.driverId);
      if (existing) {
        existing.amountIqd += row.subtotalIqd;
        existing.orderIds.push(row.orderId);
      } else {
        byDriver.set(row.driverId, {
          driverId: row.driverId,
          driverName: row.driverName,
          amountIqd: row.subtotalIqd,
          orderIds: [row.orderId],
        });
      }
    }
    return [...byDriver.values()]
      .filter((v) => v.amountIqd > 0)
      .sort((a, b) => b.amountIqd - a.amountIqd);
  }

  /** إحصاءات يوم السائق من قيود delivery_fee (قيد واحد لكل طلب مسلّم) */
  async driverTodayStats(
    driverId: string,
  ): Promise<{ deliveredCount: number; feesIqd: number }> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [row] = await this.db
      .select({
        deliveredCount: sql`count(*)`.mapWith(Number),
        feesIqd: sql`coalesce(sum(${ledgerEntries.amountIqd}), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.driverId, driverId),
          eq(ledgerEntries.entryType, LedgerEntryType.DELIVERY_FEE),
          gte(ledgerEntries.createdAt, startOfDay),
        ),
      );
    return { deliveredCount: row?.deliveredCount ?? 0, feesIqd: row?.feesIqd ?? 0 };
  }

  /** صفوف يومية لشاشة دفتر المخبز: تسليم/مبيعات/أجور/إلغاءات من جدول الطلبات */
  async vendorDailySummaries(
    vendorId: string,
    from: Date,
    to: Date,
  ): Promise<LedgerSummaryView[]> {
    const deliveredDate = sql<string>`to_char(${orders.deliveredAt}, 'YYYY-MM-DD')`;
    const deliveredRows = await this.db
      .select({
        date: deliveredDate,
        deliveredCount: sql`count(*)`.mapWith(Number),
        grossSalesIqd: sql`coalesce(sum(${orders.subtotalIqd}), 0)`.mapWith(Number),
        feesIqd: sql`coalesce(sum(${orders.deliveryFeeIqd}), 0)`.mapWith(Number),
      })
      .from(orders)
      .where(
        and(
          eq(orders.vendorId, vendorId),
          eq(orders.status, OrderStatus.DELIVERED),
          gte(orders.deliveredAt, from),
          lte(orders.deliveredAt, to),
        ),
      )
      .groupBy(deliveredDate);

    const cancelledDate = sql<string>`to_char(${orders.cancelledAt}, 'YYYY-MM-DD')`;
    const cancelledRows = await this.db
      .select({
        date: cancelledDate,
        cancelledCount: sql`count(*)`.mapWith(Number),
      })
      .from(orders)
      .where(
        and(
          eq(orders.vendorId, vendorId),
          eq(orders.status, OrderStatus.CANCELLED),
          gte(orders.cancelledAt, from),
          lte(orders.cancelledAt, to),
        ),
      )
      .groupBy(cancelledDate);

    const byDate = new Map<string, LedgerSummaryView>();
    const dayFor = (date: string): LedgerSummaryView => {
      let day = byDate.get(date);
      if (!day) {
        day = { date, deliveredCount: 0, grossSalesIqd: 0, feesIqd: 0, cancelledCount: 0 };
        byDate.set(date, day);
      }
      return day;
    };
    for (const row of deliveredRows) {
      const day = dayFor(row.date);
      day.deliveredCount = row.deliveredCount;
      day.grossSalesIqd = row.grossSalesIqd;
      day.feesIqd = row.feesIqd;
    }
    for (const row of cancelledRows) {
      dayFor(row.date).cancelledCount = row.cancelledCount;
    }
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  // ─────────────────────────────── التصحيح الإداري ───────────────────────────────

  /** حركة عكسية مرتبطة بالأصل — الطريقة الوحيدة لتصحيح قيد (append-only) */
  async reverseEntry(
    entryId: string,
    adminUserId: string,
    note: string,
  ): Promise<LedgerEntryRow> {
    return this.db.transaction(async (tx) => {
      // قفل صف الأصل لمنع سباق عكسَين متزامنين
      await tx.execute(sql`SELECT id FROM ledger_entries WHERE id = ${entryId} FOR UPDATE`);
      const [original] = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, entryId))
        .limit(1);
      if (!original) {
        throw new NotFoundException({ code: 'ENTRY_NOT_FOUND' });
      }
      const [existingReversal] = await tx
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.reversalOfId, entryId))
        .limit(1);
      if (existingReversal) {
        throw new ConflictException({ code: 'ALREADY_REVERSED' });
      }
      const [reversal] = await tx
        .insert(ledgerEntries)
        .values({
          entryType: LedgerEntryType.REVERSAL,
          orderId: original.orderId,
          vendorId: original.vendorId,
          driverId: original.driverId,
          amountIqd: -original.amountIqd,
          note: `[admin:${adminUserId}] ${note}`,
          reversalOfId: original.id,
        })
        .returning();
      if (!reversal) {
        throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
      }
      return reversal;
    });
  }

  // ─────────────────────────────── مساعدات داخلية ───────────────────────────────

  /** معرفات الطلبات المشمولة بتسويات SETTLED لطرفٍ ما (مسح order_ids JSON) */
  private async settledOrderIdsFor(scope: {
    driverId?: string;
    vendorId?: string;
  }): Promise<Set<string>> {
    const conditions = [eq(settlements.status, SettlementStatus.SETTLED)];
    if (scope.driverId !== undefined) conditions.push(eq(settlements.driverId, scope.driverId));
    if (scope.vendorId !== undefined) conditions.push(eq(settlements.vendorId, scope.vendorId));
    const rows = await this.db
      .select({ orderIds: settlements.orderIds })
      .from(settlements)
      .where(and(...conditions));
    const set = new Set<string>();
    for (const row of rows) {
      for (const id of parseOrderIds(row.orderIds)) set.add(id);
    }
    return set;
  }
}
