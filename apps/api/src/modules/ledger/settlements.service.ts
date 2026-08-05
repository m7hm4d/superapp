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
  Role,
  SETTLEMENT_TRANSITIONS,
  SettlementStatus,
  canTransition,
} from '@superapp/shared';
import type { LedgerSummaryView, SettlementView } from '@superapp/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { generatePin } from '../../common/codes';
import { DB, DbClient } from '../../db/drizzle.module';
import { driverProfiles, settlements, users, vendorProfiles } from '../../db/schema';
import type { SettlementUpdatedDomainEvent } from '../../realtime/events.publisher';
import { LedgerService, parseOrderIds } from './ledger.service';
import type { DbTx, DriverOwedByVendorRow, VendorOutstandingByDriverRow } from './ledger.service';

type SettlementRow = typeof settlements.$inferSelect;

export interface DriverLedgerView {
  todayDeliveredCount: number;
  todayFeesIqd: number;
  cashOnHandIqd: number;
  owed: DriverOwedByVendorRow[];
  settlements: SettlementView[];
}

export interface VendorLedgerView {
  days: LedgerSummaryView[];
  outstanding: VendorOutstandingByDriverRow[];
  settlements: SettlementView[];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * آلة 3 — التسوية النقدية سائق↔مخبز (الملف §8.3):
 * السائق يبدأها فتصبح AWAITING_CONFIRMATION مباشرةً، والمخبز يؤكد بPIN
 * أو يعترض؛ الإدارة تحسم الاعتراض. قيود الدفتر تُكتب في نفس معاملة SETTLED.
 */
@Injectable()
export class SettlementsService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly ledger: LedgerService,
    private readonly emitter: EventEmitter2,
  ) {}

  // ─────────────────────────────── مسار السائق ───────────────────────────────

  async initiate(driverUserId: string, vendorId: string): Promise<SettlementView> {
    const driver = await this.requireDriverProfile(driverUserId);
    const [vendor] = await this.db
      .select({ id: vendorProfiles.id, storeNameAr: vendorProfiles.storeNameAr })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.id, vendorId))
      .limit(1);
    if (!vendor) {
      throw new NotFoundException({ code: 'VENDOR_NOT_FOUND' });
    }

    // المستحق الحالي لهذا المخبز (المسوّى SETTLED مستبعد داخل الحساب)
    const owed = await this.ledger.driverOwedByVendor(driver.id);
    const outstanding = owed.find((o) => o.vendorId === vendorId);
    if (!outstanding || outstanding.amountIqd <= 0) {
      throw new ConflictException({ code: 'NOTHING_TO_SETTLE' });
    }

    const created = await this.db.transaction(async (tx) => {
      // قفل صف السائق يسلسل بدء التسويات ويمنع سباق إنشاء مزدوج لنفس الثنائي
      await tx.execute(sql`SELECT id FROM driver_profiles WHERE id = ${driver.id} FOR UPDATE`);
      const [inProgress] = await tx
        .select({ id: settlements.id })
        .from(settlements)
        .where(
          and(
            eq(settlements.driverId, driver.id),
            eq(settlements.vendorId, vendorId),
            inArray(settlements.status, [
              SettlementStatus.UNSETTLED,
              SettlementStatus.AWAITING_CONFIRMATION,
            ]),
          ),
        )
        .limit(1);
      if (inProgress) {
        throw new ConflictException({ code: 'SETTLEMENT_IN_PROGRESS' });
      }

      // البدء هو فعل السائق نفسه — ننشئ مباشرةً بحالة AWAITING_CONFIRMATION
      const [row] = await tx
        .insert(settlements)
        .values({
          vendorId,
          driverId: driver.id,
          status: SettlementStatus.AWAITING_CONFIRMATION,
          amountIqd: outstanding.amountIqd,
          settlementPin: generatePin(),
          orderIds: JSON.stringify(outstanding.orderIds),
        })
        .returning();
      if (!row) {
        throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
      }
      return row;
    });

    // البث بعد التزام المعاملة — الغرف تُحل في الناشر
    const event: SettlementUpdatedDomainEvent = {
      settlementId: created.id,
      status: created.status,
      amountIqd: created.amountIqd,
      vendorProfileId: vendorId,
      driverUserId,
    };
    this.emitter.emit('settlement.updated', event);

    // السائق يعرض الPIN للمخبز — يُعاد له حصراً
    return this.toView(created, vendor.storeNameAr, driver.fullName, { includePin: true });
  }

  async listForDriver(driverUserId: string): Promise<SettlementView[]> {
    const driver = await this.requireDriverProfile(driverUserId);
    return this.listByDriverProfile(driver.id);
  }

  /** GET driver/ledger — اليوم + النقد بيد السائق + المستحقات + آخر التسويات */
  async driverOverview(driverUserId: string): Promise<DriverLedgerView> {
    const driver = await this.requireDriverProfile(driverUserId);
    const [today, cashOnHandIqd, owed, recent] = await Promise.all([
      this.ledger.driverTodayStats(driver.id),
      this.ledger.driverCashOnHand(driver.id),
      this.ledger.driverOwedByVendor(driver.id),
      this.listByDriverProfile(driver.id),
    ]);
    return {
      todayDeliveredCount: today.deliveredCount,
      todayFeesIqd: today.feesIqd,
      cashOnHandIqd,
      owed,
      settlements: recent,
    };
  }

  // ─────────────────────────────── مسار المخبز ───────────────────────────────

  async confirm(vendorUserId: string, settlementId: string, pin: string): Promise<SettlementView> {
    const vendor = await this.requireVendorProfile(vendorUserId);
    const settled = await this.db.transaction(async (tx) => {
      const row = await this.lockSettlement(tx, settlementId);
      if (row.vendorId !== vendor.id) {
        throw new ForbiddenException({ code: 'FORBIDDEN' });
      }
      const from = row.status as SettlementStatus;
      if (!canTransition(SETTLEMENT_TRANSITIONS, from, SettlementStatus.SETTLED, Role.VENDOR)) {
        throw new ConflictException({
          code: 'ILLEGAL_TRANSITION',
          from,
          to: SettlementStatus.SETTLED,
        });
      }
      if (row.settlementPin !== pin) {
        throw new ForbiddenException({ code: 'WRONG_PIN' });
      }
      await tx
        .update(settlements)
        .set({ status: SettlementStatus.SETTLED, settledAt: new Date() })
        .where(eq(settlements.id, settlementId));
      await this.ledger.recordSettlementEntries(tx, {
        settlementId: row.id,
        vendorId: row.vendorId,
        driverId: row.driverId,
        amountIqd: row.amountIqd,
      });
      return row;
    });
    await this.emitSettlementUpdated(settled, SettlementStatus.SETTLED);
    return this.loadView(settlementId, { includePin: false });
  }

  async dispute(
    vendorUserId: string,
    settlementId: string,
    reason: string,
  ): Promise<SettlementView> {
    const vendor = await this.requireVendorProfile(vendorUserId);
    const disputed = await this.db.transaction(async (tx) => {
      const row = await this.lockSettlement(tx, settlementId);
      if (row.vendorId !== vendor.id) {
        throw new ForbiddenException({ code: 'FORBIDDEN' });
      }
      const from = row.status as SettlementStatus;
      if (!canTransition(SETTLEMENT_TRANSITIONS, from, SettlementStatus.DISPUTED, Role.VENDOR)) {
        throw new ConflictException({
          code: 'ILLEGAL_TRANSITION',
          from,
          to: SettlementStatus.DISPUTED,
        });
      }
      await tx
        .update(settlements)
        .set({ status: SettlementStatus.DISPUTED, disputeReason: reason })
        .where(eq(settlements.id, settlementId));
      return row;
    });
    await this.emitSettlementUpdated(disputed, SettlementStatus.DISPUTED);
    return this.loadView(settlementId, { includePin: false });
  }

  async listForVendor(vendorUserId: string): Promise<SettlementView[]> {
    const vendor = await this.requireVendorProfile(vendorUserId);
    return this.listByVendorProfile(vendor.id);
  }

  /** GET vendor/ledger — صفوف يومية + مستحقات لدى السائقين + التسويات */
  async vendorOverview(
    vendorUserId: string,
    range: { from?: Date; to?: Date },
  ): Promise<VendorLedgerView> {
    const vendor = await this.requireVendorProfile(vendorUserId);
    const to = range.to ? endOfDay(range.to) : new Date();
    const from = range.from
      ? startOfDay(range.from)
      : startOfDay(new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000));
    const [days, outstanding, recent] = await Promise.all([
      this.ledger.vendorDailySummaries(vendor.id, from, to),
      this.ledger.vendorOutstandingByDriver(vendor.id),
      this.listByVendorProfile(vendor.id),
    ]);
    return { days, outstanding, settlements: recent };
  }

  // ─────────────────────────────── مسار الإدارة ───────────────────────────────

  /** حسم الاعتراض: DISPUTED → SETTLED بفاعل admin مع كتابة قيود الدفتر ذرّياً */
  async adminResolve(
    settlementId: string,
    adminUserId: string,
    reason: string,
  ): Promise<SettlementView> {
    const resolved = await this.db.transaction(async (tx) => {
      const row = await this.lockSettlement(tx, settlementId);
      const from = row.status as SettlementStatus;
      if (!canTransition(SETTLEMENT_TRANSITIONS, from, SettlementStatus.SETTLED, Role.ADMIN)) {
        throw new ConflictException({
          code: 'ILLEGAL_TRANSITION',
          from,
          to: SettlementStatus.SETTLED,
        });
      }
      const resolutionNote = `[admin:${adminUserId}] ${reason}`;
      await tx
        .update(settlements)
        .set({
          status: SettlementStatus.SETTLED,
          settledAt: new Date(),
          disputeReason: row.disputeReason
            ? `${row.disputeReason}\n${resolutionNote}`
            : resolutionNote,
        })
        .where(eq(settlements.id, settlementId));
      await this.ledger.recordSettlementEntries(tx, {
        settlementId: row.id,
        vendorId: row.vendorId,
        driverId: row.driverId,
        amountIqd: row.amountIqd,
      });
      return row;
    });
    await this.emitSettlementUpdated(resolved, SettlementStatus.SETTLED);
    return this.loadView(settlementId, { includePin: false });
  }

  // ─────────────────────────────── مساعدات داخلية ───────────────────────────────

  /**
   * يبث settlement.updated بعد التزام المعاملة. الصف الممرر لقطة ما قبل
   * التحديث، لذا تُمرر الحالة الهدف صراحةً. driverUserId يُحل من ملف السائق.
   */
  private async emitSettlementUpdated(row: SettlementRow, status: SettlementStatus): Promise<void> {
    const [driver] = await this.db
      .select({ userId: driverProfiles.userId })
      .from(driverProfiles)
      .where(eq(driverProfiles.id, row.driverId))
      .limit(1);
    if (!driver) return; // FK يضمن الوجود عملياً؛ حماية فقط — البث تلميح لا حقيقة
    const event: SettlementUpdatedDomainEvent = {
      settlementId: row.id,
      status,
      amountIqd: row.amountIqd,
      vendorProfileId: row.vendorId,
      driverUserId: driver.userId,
    };
    this.emitter.emit('settlement.updated', event);
  }

  private async lockSettlement(tx: DbTx, settlementId: string): Promise<SettlementRow> {
    await tx.execute(sql`SELECT id FROM settlements WHERE id = ${settlementId} FOR UPDATE`);
    const [row] = await tx
      .select()
      .from(settlements)
      .where(eq(settlements.id, settlementId))
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'SETTLEMENT_NOT_FOUND' });
    }
    return row;
  }

  private async requireDriverProfile(
    userId: string,
  ): Promise<{ id: string; fullName: string }> {
    const [row] = await this.db
      .select({ id: driverProfiles.id, fullName: users.fullName })
      .from(driverProfiles)
      .innerJoin(users, eq(users.id, driverProfiles.userId))
      .where(eq(driverProfiles.userId, userId))
      .limit(1);
    if (!row) {
      // ApprovedGuard يمنع الوصول قبل هذا عادةً؛ حماية إضافية فقط
      throw new ForbiddenException({
        code: 'PENDING_APPROVAL',
        approvalStatus: 'missing',
        reason: null,
      });
    }
    return row;
  }

  private async requireVendorProfile(
    userId: string,
  ): Promise<{ id: string; storeNameAr: string }> {
    const [row] = await this.db
      .select({ id: vendorProfiles.id, storeNameAr: vendorProfiles.storeNameAr })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, userId))
      .limit(1);
    if (!row) {
      throw new ForbiddenException({
        code: 'PENDING_APPROVAL',
        approvalStatus: 'missing',
        reason: null,
      });
    }
    return row;
  }

  private async listByDriverProfile(driverProfileId: string): Promise<SettlementView[]> {
    const rows = await this.selectViews(eq(settlements.driverId, driverProfileId));
    return rows.map((r) =>
      this.toView(r.settlement, r.vendorNameAr, r.driverName, {
        // السائق يحتاج الPIN طالما التسوية بانتظار تأكيد المخبز
        includePin: r.settlement.status === SettlementStatus.AWAITING_CONFIRMATION,
      }),
    );
  }

  private async listByVendorProfile(vendorProfileId: string): Promise<SettlementView[]> {
    const rows = await this.selectViews(eq(settlements.vendorId, vendorProfileId));
    return rows.map((r) =>
      this.toView(r.settlement, r.vendorNameAr, r.driverName, { includePin: false }),
    );
  }

  private selectViews(condition: SQL) {
    return this.db
      .select({
        settlement: settlements,
        vendorNameAr: vendorProfiles.storeNameAr,
        driverName: users.fullName,
      })
      .from(settlements)
      .innerJoin(vendorProfiles, eq(vendorProfiles.id, settlements.vendorId))
      .innerJoin(driverProfiles, eq(driverProfiles.id, settlements.driverId))
      .innerJoin(users, eq(users.id, driverProfiles.userId))
      .where(condition)
      .orderBy(desc(settlements.createdAt))
      .limit(50);
  }

  private async loadView(
    settlementId: string,
    opts: { includePin: boolean },
  ): Promise<SettlementView> {
    const [row] = await this.selectViews(eq(settlements.id, settlementId));
    if (!row) {
      throw new NotFoundException({ code: 'SETTLEMENT_NOT_FOUND' });
    }
    return this.toView(row.settlement, row.vendorNameAr, row.driverName, opts);
  }

  private toView(
    row: SettlementRow,
    vendorNameAr: string,
    driverName: string,
    opts: { includePin: boolean },
  ): SettlementView {
    return {
      id: row.id,
      vendorId: row.vendorId,
      vendorNameAr,
      driverId: row.driverId,
      driverName,
      status: row.status,
      amountIqd: row.amountIqd,
      orderIds: parseOrderIds(row.orderIds),
      ...(opts.includePin ? { settlementPin: row.settlementPin } : {}),
      createdAt: row.createdAt.toISOString(),
      settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    };
  }
}
