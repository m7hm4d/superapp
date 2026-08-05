import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApprovalStatus,
  CATEGORY_FLAG_BY_CATEGORY,
  CancelledBy,
  InvalidIraqiPhoneError,
  ORDER_TRANSITIONS,
  OrderStatus,
  Role,
  canTransition,
  normalizeIraqiPhone,
} from '@superapp/shared';
import type { CreateOrderInput, OrderView } from '@superapp/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { generateOrderCode, generatePin } from '../../common/codes';
import { DB, DbClient } from '../../db/drizzle.module';
import {
  cities,
  featureFlags,
  orderEvents,
  orderItems,
  orders,
  products,
  vendorProfiles,
} from '../../db/schema';
import type {
  OrderCreatedDomainEvent,
  OrderStatusDomainEvent,
} from '../../realtime/events.publisher';
import { toOrderView } from './order-view.mapper';
import type { OrderItemRow, OrderRow } from './order-view.mapper';

/** نوع معاملة Drizzle المستخرج من عميل قاعدة البيانات */
export type DbTx = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export interface TransitionActor {
  userId?: string;
  role: Role | 'system';
}

export interface TransitionOpts {
  reason?: string;
  cancelledBy?: CancelledBy;
  expectedVersion?: number;
  /** يُخزن عند قبول المخبز (الانتقال إلى PREPARING) */
  prepMinutes?: number;
}

/** يُبث بعد READY؛ محرك الدفعات (M2) سيشترك به لاحقاً */
export interface OrderReadyDomainEvent {
  orderId: string;
  vendorProfileId: string;
  cityId: string;
}

export type VendorOrdersTab = 'new' | 'preparing' | 'ready' | 'history';

const VENDOR_TAB_STATUSES: Record<VendorOrdersTab, readonly OrderStatus[]> = {
  new: [OrderStatus.PENDING_BAKERY],
  preparing: [OrderStatus.PREPARING],
  ready: [OrderStatus.READY],
  history: [OrderStatus.IN_DELIVERY, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
};

const CANCELLED_BY_FROM_ROLE: Record<Role | 'system', CancelledBy> = {
  [Role.CUSTOMER]: CancelledBy.CUSTOMER,
  [Role.VENDOR]: CancelledBy.VENDOR,
  [Role.DRIVER]: CancelledBy.SYSTEM, // السائق لا يلغي مباشرة بحسب آلة الحالة
  [Role.ADMIN]: CancelledBy.ADMIN,
  system: CancelledBy.SYSTEM,
};

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly emitter: EventEmitter2,
  ) {}

  // ─────────────────────────────── آلة 1: الانتقال ───────────────────────────────

  /**
   * قلب آلة الحالة: قفل صف الطلب، تحقق الانتقال من ORDER_TRANSITIONS،
   * فرض expectedVersion، تحديث الحالة + الطابع الزمني، وسجل order_events.
   * لا يبث الحدث بنفسه — يعيد الحمولة ليبثها المستدعي بعد الالتزام (commit).
   */
  async transition(
    tx: DbTx,
    orderId: string,
    to: OrderStatus,
    actor: TransitionActor,
    opts: TransitionOpts = {},
  ): Promise<{ order: OrderRow; event: OrderStatusDomainEvent }> {
    // قفل تشاؤمي على صف الطلب طوال المعاملة
    await tx.execute(sql`SELECT * FROM orders WHERE id = ${orderId} FOR UPDATE`);
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    }

    const from = order.status as OrderStatus;
    if (!canTransition(ORDER_TRANSITIONS, from, to, actor.role)) {
      throw new ConflictException({ code: 'ILLEGAL_TRANSITION', from, to });
    }
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== order.version) {
      throw new ConflictException({ code: 'VERSION_CONFLICT', currentVersion: order.version });
    }

    const now = new Date();
    const patch: Partial<typeof orders.$inferInsert> = {
      status: to,
      version: order.version + 1,
    };
    switch (to) {
      case OrderStatus.PREPARING:
        patch.acceptedAt = now;
        if (opts.prepMinutes !== undefined) patch.prepMinutes = opts.prepMinutes;
        break;
      case OrderStatus.READY:
        patch.readyAt = now;
        break;
      case OrderStatus.IN_DELIVERY:
        patch.pickedUpAt = now;
        break;
      case OrderStatus.DELIVERED:
        patch.deliveredAt = now;
        break;
      case OrderStatus.CANCELLED:
        patch.cancelledAt = now;
        patch.cancelledBy = opts.cancelledBy ?? CANCELLED_BY_FROM_ROLE[actor.role];
        patch.cancelledReason = opts.reason ?? null;
        break;
      default:
        break;
    }

    const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, orderId)).returning();
    if (!updated) {
      throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
    }

    await tx.insert(orderEvents).values({
      orderId,
      fromStatus: from,
      toStatus: to,
      actorUserId: actor.userId ?? null,
      actorRole: actor.role,
      reason: opts.reason ?? null,
    });

    const event: OrderStatusDomainEvent = {
      orderId: order.id,
      code: order.code,
      status: to,
      customerId: order.customerId,
      vendorProfileId: order.vendorId,
      ...(to === OrderStatus.CANCELLED && opts.reason ? { cancelledReason: opts.reason } : {}),
    };
    return { order: updated, event };
  }

  /** يفتح معاملة، ينفذ الانتقال، ثم يبث 'order.status' بعد الالتزام */
  async transitionOrder(
    orderId: string,
    to: OrderStatus,
    actor: TransitionActor,
    opts: TransitionOpts = {},
  ): Promise<{ order: OrderRow; event: OrderStatusDomainEvent }> {
    const result = await this.db.transaction((tx) =>
      this.transition(tx, orderId, to, actor, opts),
    );
    this.emitter.emit('order.status', result.event);
    return result;
  }

  // ─────────────────────────────── إنشاء الطلب ───────────────────────────────

  async createOrder(customerId: string, input: CreateOrderInput): Promise<OrderView> {
    let contactPhone: string;
    try {
      contactPhone = normalizeIraqiPhone(input.delivery.contactPhone);
    } catch (err) {
      if (err instanceof InvalidIraqiPhoneError) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'بيانات غير صالحة',
          issues: [{ path: 'delivery.contactPhone', message: 'رقم هاتف عراقي غير صالح' }],
        });
      }
      throw err;
    }

    // 1) البائع موجود + موافَق عليه + مفتوح
    const [vendor] = await this.db
      .select()
      .from(vendorProfiles)
      .where(eq(vendorProfiles.id, input.vendorId))
      .limit(1);
    if (!vendor || vendor.approvalStatus !== ApprovalStatus.APPROVED || !vendor.isOpen) {
      throw new ConflictException({ code: 'VENDOR_CLOSED' });
    }

    // 2) علم الفئة مفعّل
    const flagKey = CATEGORY_FLAG_BY_CATEGORY[vendor.category];
    const [flag] = await this.db
      .select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(eq(featureFlags.key, flagKey))
      .limit(1);
    if (!flag || !flag.enabled) {
      throw new ConflictException({ code: 'CATEGORY_DISABLED' });
    }

    // 3) نقطة التسليم داخل نطاق خدمة مدينة البائع
    const { lat, lng } = input.delivery.location;
    const [city] = await this.db
      .select({
        id: cities.id,
        isActive: cities.isActive,
        deliveryFeeIqd: cities.deliveryFeeIqd,
        vendorAcceptTimeoutMin: cities.vendorAcceptTimeoutMin,
        withinService: sql<boolean>`ST_DWithin(${cities.center}, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${cities.serviceRadiusKm} * 1000)`,
      })
      .from(cities)
      .where(eq(cities.id, vendor.cityId))
      .limit(1);
    if (!city || !city.isActive || !city.withinService) {
      throw new UnprocessableEntityException({ code: 'OUT_OF_SERVICE_AREA' });
    }

    // 4) المنتجات: كلها متوفرة وتخص البائع — وإلا مراجعة إلزامية للكتالوج
    const quantityByProduct = new Map<string, number>();
    for (const item of input.items) {
      quantityByProduct.set(
        item.productId,
        (quantityByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }
    const productIds = [...quantityByProduct.keys()];
    const productRows = await this.db
      .select()
      .from(products)
      .where(inArray(products.id, productIds));
    const productById = new Map(productRows.map((p) => [p.id, p]));
    for (const id of productIds) {
      const product = productById.get(id);
      if (!product || product.vendorId !== vendor.id || !product.isAvailable || product.isDeleted) {
        throw new ConflictException({ code: 'CATALOG_CHANGED' });
      }
    }

    // نسخة الكتالوج التي رآها العميل مقابل أحدث max(updated_at) بالثواني
    if (input.catalogVersion !== undefined) {
      const [agg] = await this.db
        .select({
          maxEpoch: sql`floor(extract(epoch from max(${products.updatedAt})))`.mapWith(Number),
        })
        .from(products)
        .where(and(eq(products.vendorId, vendor.id), eq(products.isDeleted, false)));
      const currentVersion = agg && Number.isFinite(agg.maxEpoch) ? agg.maxEpoch : 0;
      if (currentVersion !== input.catalogVersion) {
        throw new ConflictException({ code: 'CATALOG_CHANGED' });
      }
    }

    // 5) لقطات الأسماء والأسعار + الحساب بالدينار الصحيح
    const itemSnapshots = productIds.map((id) => {
      const product = productById.get(id)!;
      const quantity = quantityByProduct.get(id)!;
      return {
        productId: id,
        productNameAr: product.nameAr,
        unitPriceIqd: product.priceIqd,
        quantity,
        lineTotalIqd: product.priceIqd * quantity,
      };
    });
    const subtotalIqd = itemSnapshots.reduce((sum, i) => sum + i.lineTotalIqd, 0);
    const deliveryFeeIqd = city.deliveryFeeIqd;
    const commissionIqd = 0;
    const totalIqd = subtotalIqd + deliveryFeeIqd;

    const code = await this.uniqueOrderCode();
    const deliveryPin = generatePin();
    const acceptTimeoutAt = new Date(Date.now() + city.vendorAcceptTimeoutMin * 60_000);

    // 6) الإدراج الذري: الطلب + الأصناف + سجل الحدث الأول
    const created = await this.db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          code,
          cityId: city.id,
          customerId,
          vendorId: vendor.id,
          status: OrderStatus.PENDING_BAKERY,
          subtotalIqd,
          deliveryFeeIqd,
          commissionIqd,
          totalIqd,
          deliveryLocation: { lat, lng },
          deliveryAddressText: input.delivery.addressText,
          deliveryLandmark: input.delivery.landmark ?? null,
          contactPhone,
          note: input.note ?? null,
          deliveryPin,
          acceptTimeoutAt,
        })
        .returning();
      if (!order) {
        throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
      }
      const insertedItems = await tx
        .insert(orderItems)
        .values(itemSnapshots.map((s) => ({ ...s, orderId: order.id })))
        .returning();
      await tx.insert(orderEvents).values({
        orderId: order.id,
        fromStatus: null,
        toStatus: OrderStatus.PENDING_BAKERY,
        actorUserId: customerId,
        actorRole: Role.CUSTOMER,
        reason: null,
      });
      return { order, items: insertedItems };
    });

    // بعد الالتزام: بث الحدثين
    const createdEvent: OrderCreatedDomainEvent = {
      orderId: created.order.id,
      code: created.order.code,
      vendorProfileId: vendor.id,
      customerId,
      itemsCount: created.items.length,
      totalIqd,
    };
    this.emitter.emit('order.created', createdEvent);
    const statusEvent: OrderStatusDomainEvent = {
      orderId: created.order.id,
      code: created.order.code,
      status: OrderStatus.PENDING_BAKERY,
      customerId,
      vendorProfileId: vendor.id,
    };
    this.emitter.emit('order.status', statusEvent);

    return toOrderView(created.order, created.items, vendor.storeNameAr, { includePin: true });
  }

  // ─────────────────────────────── مسارات العميل ───────────────────────────────

  async listCustomerOrders(customerId: string): Promise<OrderView[]> {
    const rows = await this.db
      .select({ order: orders, vendorNameAr: vendorProfiles.storeNameAr })
      .from(orders)
      .innerJoin(vendorProfiles, eq(vendorProfiles.id, orders.vendorId))
      .where(eq(orders.customerId, customerId))
      .orderBy(
        sql`CASE WHEN ${orders.status} IN ('DELIVERED', 'CANCELLED') THEN 1 ELSE 0 END`,
        desc(orders.createdAt),
      )
      .limit(100);
    return this.attachItems(rows, { includePin: true });
  }

  async getCustomerOrder(customerId: string, orderId: string): Promise<OrderView> {
    const order = await this.getOwnedOrder(orderId, { customerId });
    return this.loadView(order.id, { includePin: true });
  }

  async cancelByCustomer(
    customerId: string,
    orderId: string,
    reason: string,
  ): Promise<OrderView> {
    await this.getOwnedOrder(orderId, { customerId });
    const { order } = await this.transitionOrder(
      orderId,
      OrderStatus.CANCELLED,
      { userId: customerId, role: Role.CUSTOMER },
      { reason, cancelledBy: CancelledBy.CUSTOMER },
    );
    return this.loadView(order.id, { includePin: true });
  }

  // ─────────────────────────────── مسارات البائع ───────────────────────────────

  async listVendorOrders(userId: string, tab: VendorOrdersTab): Promise<OrderView[]> {
    const vendor = await this.requireVendorProfile(userId);
    const statuses = [...VENDOR_TAB_STATUSES[tab]];
    const rows = await this.db
      .select({ order: orders, vendorNameAr: vendorProfiles.storeNameAr })
      .from(orders)
      .innerJoin(vendorProfiles, eq(vendorProfiles.id, orders.vendorId))
      .where(and(eq(orders.vendorId, vendor.id), inArray(orders.status, statuses)))
      .orderBy(tab === 'history' ? desc(orders.createdAt) : asc(orders.createdAt))
      .limit(100);
    return this.attachItems(rows, { includePin: false });
  }

  async acceptByVendor(
    userId: string,
    orderId: string,
    input: { prepMinutes: number; expectedVersion: number },
  ): Promise<OrderView> {
    const vendor = await this.requireVendorProfile(userId);
    await this.getOwnedOrder(orderId, { vendorProfileId: vendor.id });
    const { order } = await this.transitionOrder(
      orderId,
      OrderStatus.PREPARING,
      { userId, role: Role.VENDOR },
      { expectedVersion: input.expectedVersion, prepMinutes: input.prepMinutes },
    );
    return this.loadView(order.id, { includePin: false });
  }

  async rejectByVendor(
    userId: string,
    orderId: string,
    input: { reason: string; expectedVersion: number },
  ): Promise<OrderView> {
    const vendor = await this.requireVendorProfile(userId);
    await this.getOwnedOrder(orderId, { vendorProfileId: vendor.id });
    const { order } = await this.transitionOrder(
      orderId,
      OrderStatus.CANCELLED,
      { userId, role: Role.VENDOR },
      {
        reason: input.reason,
        cancelledBy: CancelledBy.VENDOR,
        expectedVersion: input.expectedVersion,
      },
    );
    return this.loadView(order.id, { includePin: false });
  }

  async markReadyByVendor(
    userId: string,
    orderId: string,
    input: { expectedVersion: number },
  ): Promise<OrderView> {
    const vendor = await this.requireVendorProfile(userId);
    await this.getOwnedOrder(orderId, { vendorProfileId: vendor.id });
    const { order } = await this.transitionOrder(
      orderId,
      OrderStatus.READY,
      { userId, role: Role.VENDOR },
      { expectedVersion: input.expectedVersion },
    );
    // متوافق مسبقاً مع محرك دفعات M2
    const readyEvent: OrderReadyDomainEvent = {
      orderId: order.id,
      vendorProfileId: order.vendorId,
      cityId: order.cityId,
    };
    this.emitter.emit('order.ready', readyEvent);
    return this.loadView(order.id, { includePin: false });
  }

  async cancelByVendor(userId: string, orderId: string, reason: string): Promise<OrderView> {
    const vendor = await this.requireVendorProfile(userId);
    await this.getOwnedOrder(orderId, { vendorProfileId: vendor.id });
    const { order } = await this.transitionOrder(
      orderId,
      OrderStatus.CANCELLED,
      { userId, role: Role.VENDOR },
      { reason, cancelledBy: CancelledBy.VENDOR },
    );
    return this.loadView(order.id, { includePin: false });
  }

  // ─────────────────────────────── مساعدات داخلية ───────────────────────────────

  private async getOwnedOrder(
    orderId: string,
    owner: { customerId?: string; vendorProfileId?: string },
  ): Promise<OrderRow> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    }
    if (owner.customerId !== undefined && order.customerId !== owner.customerId) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    if (owner.vendorProfileId !== undefined && order.vendorId !== owner.vendorProfileId) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    return order;
  }

  private async requireVendorProfile(
    userId: string,
  ): Promise<{ id: string; cityId: string; storeNameAr: string }> {
    const [vendor] = await this.db
      .select({
        id: vendorProfiles.id,
        cityId: vendorProfiles.cityId,
        storeNameAr: vendorProfiles.storeNameAr,
      })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, userId))
      .limit(1);
    if (!vendor) {
      // ApprovedGuard يمنع الوصول قبل هذا عادةً؛ حماية إضافية فقط
      throw new ForbiddenException({
        code: 'PENDING_APPROVAL',
        approvalStatus: 'missing',
        reason: null,
      });
    }
    return vendor;
  }

  private async loadView(
    orderId: string,
    opts: { includePin: boolean },
  ): Promise<OrderView> {
    const [row] = await this.db
      .select({ order: orders, vendorNameAr: vendorProfiles.storeNameAr })
      .from(orders)
      .innerJoin(vendorProfiles, eq(vendorProfiles.id, orders.vendorId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    }
    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    return toOrderView(row.order, items, row.vendorNameAr, opts);
  }

  private async attachItems(
    rows: { order: OrderRow; vendorNameAr: string }[],
    opts: { includePin: boolean },
  ): Promise<OrderView[]> {
    if (rows.length === 0) return [];
    const orderIds = rows.map((r) => r.order.id);
    const itemRows = await this.db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds));
    const itemsByOrder = new Map<string, OrderItemRow[]>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.orderId);
      if (list) list.push(item);
      else itemsByOrder.set(item.orderId, [item]);
    }
    return rows.map((r) =>
      toOrderView(r.order, itemsByOrder.get(r.order.id) ?? [], r.vendorNameAr, opts),
    );
  }

  private async uniqueOrderCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateOrderCode();
      const [existing] = await this.db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.code, code))
        .limit(1);
      if (!existing) return code;
    }
    throw new InternalServerErrorException({ code: 'ORDER_CODE_EXHAUSTED' });
  }
}
