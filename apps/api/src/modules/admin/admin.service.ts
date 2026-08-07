import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApprovalStatus,
  CancelledBy,
  OrderStatus,
  Role,
  UserStatus,
  zAdminOrdersQuery,
  zApprovalsQuery,
  zPagination,
  zUpdateCity,
} from '@superapp/shared';
import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { DB, type DbClient } from '../../db/drizzle.module';
import {
  batchOrders,
  batches,
  cities,
  driverProfiles,
  orders,
  users,
  vendorProfiles,
} from '../../db/schema';
import { OrdersService } from '../orders/orders.service';

export type ApprovalsQuery = z.infer<typeof zApprovalsQuery>;
export type AdminOrdersQuery = z.infer<typeof zAdminOrdersQuery>;
export type UpdateCityInput = z.infer<typeof zUpdateCity>;
export type ApprovalType = Extract<Role, 'vendor' | 'driver'>;
export type ApprovalDecisionStatus =
  | typeof ApprovalStatus.APPROVED
  | typeof ApprovalStatus.REJECTED;

/** استعلام قائمة المستخدمين — لا مخطط مشترك له، محلي هنا */
export const zAdminUsersQuery = z
  .object({
    role: z.nativeEnum(Role).optional(),
    status: z.nativeEnum(UserStatus).optional(),
  })
  .merge(zPagination);
export type AdminUsersQuery = z.infer<typeof zAdminUsersQuery>;

const USER_SAFE_COLUMNS = {
  id: users.id,
  phone: users.phone,
  fullName: users.fullName,
  role: users.role,
  status: users.status,
  locale: users.locale,
  createdAt: users.createdAt,
};

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly ordersService: OrdersService,
    private readonly emitter: EventEmitter2,
  ) {}

  // ---------- الموافقات ----------

  async listApprovals(q: ApprovalsQuery) {
    if (q.type === Role.VENDOR) {
      const where = eq(vendorProfiles.approvalStatus, q.status);
      const [items, countRows] = await Promise.all([
        this.db
          .select({
            type: sql<string>`'vendor'`,
            profileId: vendorProfiles.id,
            userId: users.id,
            phone: users.phone,
            fullName: users.fullName,
            storeNameAr: vendorProfiles.storeNameAr,
            category: vendorProfiles.category,
            addressText: vendorProfiles.addressText,
            cityId: vendorProfiles.cityId,
            approvalStatus: vendorProfiles.approvalStatus,
            rejectionReason: vendorProfiles.rejectionReason,
            createdAt: vendorProfiles.createdAt,
          })
          .from(vendorProfiles)
          .innerJoin(users, eq(users.id, vendorProfiles.userId))
          .where(where)
          .orderBy(asc(vendorProfiles.createdAt))
          .limit(q.limit)
          .offset(q.offset),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(vendorProfiles)
          .where(where),
      ]);
      return { items, total: countRows[0]?.count ?? 0, limit: q.limit, offset: q.offset };
    }

    const where = eq(driverProfiles.approvalStatus, q.status);
    const [items, countRows] = await Promise.all([
      this.db
        .select({
          type: sql<string>`'driver'`,
          profileId: driverProfiles.id,
          userId: users.id,
          phone: users.phone,
          fullName: users.fullName,
          vehicleType: driverProfiles.vehicleType,
          cityId: driverProfiles.cityId,
          approvalStatus: driverProfiles.approvalStatus,
          rejectionReason: driverProfiles.rejectionReason,
          createdAt: driverProfiles.createdAt,
        })
        .from(driverProfiles)
        .innerJoin(users, eq(users.id, driverProfiles.userId))
        .where(where)
        .orderBy(asc(driverProfiles.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(driverProfiles)
        .where(where),
    ]);
    return { items, total: countRows[0]?.count ?? 0, limit: q.limit, offset: q.offset };
  }

  async decideApproval(
    type: ApprovalType,
    profileId: string,
    decision: ApprovalDecisionStatus,
    reason?: string,
  ) {
    const rejectionReason = decision === ApprovalStatus.REJECTED ? (reason ?? null) : null;

    if (type === Role.VENDOR) {
      const rows = await this.db
        .update(vendorProfiles)
        .set({ approvalStatus: decision, rejectionReason })
        .where(eq(vendorProfiles.id, profileId))
        .returning();
      const row = rows[0];
      if (!row) throw new NotFoundException({ code: 'PROFILE_NOT_FOUND' });
      // عضوية الغرف تُحسم عند المصافحة: تعليق بائع لا يُخرجه من غرفة متجره
      // ما لم يُقطع اتصاله فيعيد المصافحة بحالته الجديدة.
      this.emitter.emit('approval.decided', { userId: row.userId });
      return row;
    }

    const rows = await this.db
      .update(driverProfiles)
      .set({ approvalStatus: decision, rejectionReason })
      .where(eq(driverProfiles.id, profileId))
      .returning();
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: 'PROFILE_NOT_FOUND' });
    this.emitter.emit('approval.decided', { userId: row.userId });
    return row;
  }

  // ---------- الطلبات ----------

  async listOrders(q: AdminOrdersQuery) {
    const conditions: SQL[] = [];

    if (q.status !== undefined) {
      const valid = Object.values(OrderStatus) as string[];
      if (!valid.includes(q.status)) {
        throw new BadRequestException({ code: 'INVALID_STATUS' });
      }
      conditions.push(eq(orders.status, q.status as OrderStatus));
    }
    if (q.vendorId !== undefined) conditions.push(eq(orders.vendorId, q.vendorId));
    if (q.driverId !== undefined) {
      const driverOrders = this.db
        .select({ orderId: batchOrders.orderId })
        .from(batchOrders)
        .innerJoin(batches, eq(batches.id, batchOrders.batchId))
        .where(eq(batches.driverId, q.driverId));
      conditions.push(inArray(orders.id, driverOrders));
    }
    if (q.from !== undefined) conditions.push(gte(orders.createdAt, q.from));
    if (q.to !== undefined) conditions.push(lte(orders.createdAt, q.to));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countRows] = await Promise.all([
      this.db
        .select({
          id: orders.id,
          code: orders.code,
          status: orders.status,
          vendorId: orders.vendorId,
          vendorStoreNameAr: vendorProfiles.storeNameAr,
          customerId: orders.customerId,
          customerName: users.fullName,
          subtotalIqd: orders.subtotalIqd,
          deliveryFeeIqd: orders.deliveryFeeIqd,
          totalIqd: orders.totalIqd,
          cancelledBy: orders.cancelledBy,
          cancelledReason: orders.cancelledReason,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .innerJoin(vendorProfiles, eq(vendorProfiles.id, orders.vendorId))
        .innerJoin(users, eq(users.id, orders.customerId))
        .where(where)
        .orderBy(desc(orders.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where),
    ]);

    return { items, total: countRows[0]?.count ?? 0, limit: q.limit, offset: q.offset };
  }

  /** إلغاء قسري عبر آلة الحالة نفسها — الفاعل admin (الملف §8.1) */
  async cancelOrder(orderId: string, actorUserId: string, reason: string) {
    return this.ordersService.transitionOrder(
      orderId,
      OrderStatus.CANCELLED,
      { userId: actorUserId, role: Role.ADMIN },
      { reason, cancelledBy: CancelledBy.ADMIN },
    );
  }

  /** الطلبات العالقة حسب عتبات الملف: مهلة القبول، 30د تحضير/جاهز، 45د توصيل */
  async stuckOrders() {
    return this.db
      .select({
        id: orders.id,
        code: orders.code,
        status: orders.status,
        vendorId: orders.vendorId,
        vendorStoreNameAr: vendorProfiles.storeNameAr,
        customerId: orders.customerId,
        totalIqd: orders.totalIqd,
        acceptTimeoutAt: orders.acceptTimeoutAt,
        acceptedAt: orders.acceptedAt,
        readyAt: orders.readyAt,
        pickedUpAt: orders.pickedUpAt,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(vendorProfiles, eq(vendorProfiles.id, orders.vendorId))
      .where(
        or(
          and(
            eq(orders.status, OrderStatus.PENDING_BAKERY),
            sql`${orders.acceptTimeoutAt} < now()`,
          ),
          and(
            eq(orders.status, OrderStatus.PREPARING),
            sql`${orders.acceptedAt} < now() - interval '30 minutes'`,
          ),
          and(
            eq(orders.status, OrderStatus.READY),
            sql`${orders.readyAt} < now() - interval '30 minutes'`,
          ),
          and(
            eq(orders.status, OrderStatus.IN_DELIVERY),
            sql`${orders.pickedUpAt} < now() - interval '45 minutes'`,
          ),
        ),
      )
      .orderBy(asc(orders.createdAt));
  }

  // ---------- المستخدمون ----------

  async listUsers(q: AdminUsersQuery) {
    const conditions: SQL[] = [];
    if (q.role !== undefined) conditions.push(eq(users.role, q.role));
    if (q.status !== undefined) conditions.push(eq(users.status, q.status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countRows] = await Promise.all([
      this.db
        .select(USER_SAFE_COLUMNS)
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(users).where(where),
    ]);

    return { items, total: countRows[0]?.count ?? 0, limit: q.limit, offset: q.offset };
  }

  async setUserStatus(userId: string, status: UserStatus) {
    const rows = await this.db
      .update(users)
      .set({ status })
      .where(eq(users.id, userId))
      .returning(USER_SAFE_COLUMNS);
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    // الحظر كان يمنع الطلبات الجديدة ويترك الاتصال القائم يبثّ إلى صاحبه
    if (status === UserStatus.BLOCKED) this.emitter.emit('user.blocked', { userId });
    return row;
  }

  // ---------- المدن ----------

  private mapCity(c: typeof cities.$inferSelect) {
    return {
      id: c.id,
      nameAr: c.nameAr,
      centerLat: c.center.lat,
      centerLng: c.center.lng,
      serviceRadiusKm: c.serviceRadiusKm,
      visibilityRadiusKm: c.visibilityRadiusKm,
      deliveryFeeIqd: c.deliveryFeeIqd,
      vendorAcceptTimeoutMin: c.vendorAcceptTimeoutMin,
      batchWindowSec: c.batchWindowSec,
      batchOfferTtlSec: c.batchOfferTtlSec,
      isActive: c.isActive,
      createdAt: c.createdAt,
    };
  }

  async listCities() {
    const rows = await this.db.select().from(cities).orderBy(asc(cities.createdAt));
    return rows.map((c) => this.mapCity(c));
  }

  async updateCity(cityId: string, patch: UpdateCityInput) {
    const set: Partial<typeof cities.$inferInsert> = {};
    if (patch.nameAr !== undefined) set.nameAr = patch.nameAr;
    if (patch.serviceRadiusKm !== undefined) set.serviceRadiusKm = Math.round(patch.serviceRadiusKm);
    if (patch.visibilityRadiusKm !== undefined) {
      set.visibilityRadiusKm = Math.round(patch.visibilityRadiusKm);
    }
    if (patch.deliveryFeeIqd !== undefined) set.deliveryFeeIqd = patch.deliveryFeeIqd;
    if (patch.vendorAcceptTimeoutMin !== undefined) {
      set.vendorAcceptTimeoutMin = patch.vendorAcceptTimeoutMin;
    }
    if (patch.batchWindowSec !== undefined) set.batchWindowSec = patch.batchWindowSec;
    if (patch.batchOfferTtlSec !== undefined) set.batchOfferTtlSec = patch.batchOfferTtlSec;

    if (Object.keys(set).length === 0) {
      throw new BadRequestException({ code: 'EMPTY_UPDATE' });
    }

    const rows = await this.db.update(cities).set(set).where(eq(cities.id, cityId)).returning();
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: 'CITY_NOT_FOUND' });

    this.emitter.emit('config.updated', { keys: ['city'] });
    return this.mapCity(row);
  }
}
