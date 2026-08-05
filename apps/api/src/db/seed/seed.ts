/* eslint-disable no-console */
/**
 * Seed تجريبي idempotent — يعمل كسكربت ts-node مستقل (بلا سياق Nest):
 *   DATABASE_URL=postgres://... pnpm --filter @superapp/api db:seed
 * إعادة التشغيل آمنة: upsert بالمفاتيح الطبيعية (هاتف/بريد/مفتاح/اسم)،
 * والطلبات التجريبية تُنشأ مرة واحدة فقط (تُتخطى إن وُجدت طلبات لعملاء الـ seed).
 */
import { randomBytes } from 'node:crypto';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as argon2 from 'argon2';
import {
  ApprovalStatus,
  OrderStatus,
  Role,
  VehicleType,
  VendorCategory,
  normalizeIraqiPhone,
} from '@superapp/shared';
import {
  adminCredentials,
  cities,
  customerAddresses,
  driverProfiles,
  featureFlags,
  orderEvents,
  orderItems,
  orders,
  products,
  tenants,
  users,
  vendorProfiles,
} from '../schema';
import { generateOrderCode, generatePin } from '../../common/codes';
import {
  ADMIN_SEED,
  APPROVED_VENDORS,
  CITY_SEED,
  CUSTOMERS,
  CUSTOMER_PASSWORD,
  DRIVERS,
  DRIVER_PASSWORD,
  FLAG_SEED,
  ORDER_SPECS,
  PENDING_VENDOR,
  PRODUCT_CATALOG,
  TENANT_NAME_AR,
  VENDOR_PASSWORD,
  type VendorSeed,
} from './seed-data';

type Db = NodePgDatabase;
type UserRow = typeof users.$inferSelect;
type VendorProfileRow = typeof vendorProfiles.$inferSelect;
type ProductRow = typeof products.$inferSelect;

const MINUTE_MS = 60_000;

async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

async function ensureUser(
  db: Db,
  input: { phone: string; passwordHash: string; fullName: string; role: Role },
): Promise<UserRow> {
  const phone = normalizeIraqiPhone(input.phone);
  const found = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (found[0]) return found[0];
  const inserted = await db
    .insert(users)
    .values({
      phone,
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      role: input.role,
    })
    .onConflictDoNothing({ target: users.phone })
    .returning();
  if (inserted[0]) return inserted[0];
  const again = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (!again[0]) throw new Error(`تعذّر upsert المستخدم ${phone}`);
  return again[0];
}

async function ensureTenant(db: Db): Promise<typeof tenants.$inferSelect> {
  const found = await db.select().from(tenants).where(eq(tenants.nameAr, TENANT_NAME_AR)).limit(1);
  if (found[0]) return found[0];
  const inserted = await db.insert(tenants).values({ nameAr: TENANT_NAME_AR }).returning();
  if (!inserted[0]) throw new Error('تعذّر إنشاء المستأجر');
  return inserted[0];
}

async function ensureCity(db: Db, tenantId: string): Promise<typeof cities.$inferSelect> {
  const found = await db
    .select()
    .from(cities)
    .where(and(eq(cities.tenantId, tenantId), eq(cities.nameAr, CITY_SEED.nameAr)))
    .limit(1);
  if (found[0]) return found[0];
  const inserted = await db
    .insert(cities)
    .values({
      tenantId,
      nameAr: CITY_SEED.nameAr,
      center: { lat: CITY_SEED.center.lat, lng: CITY_SEED.center.lng },
      serviceRadiusKm: CITY_SEED.serviceRadiusKm,
      visibilityRadiusKm: CITY_SEED.visibilityRadiusKm,
      deliveryFeeIqd: CITY_SEED.deliveryFeeIqd,
      vendorAcceptTimeoutMin: CITY_SEED.vendorAcceptTimeoutMin,
      batchWindowSec: CITY_SEED.batchWindowSec,
      batchOfferTtlSec: CITY_SEED.batchOfferTtlSec,
    })
    .returning();
  if (!inserted[0]) throw new Error('تعذّر إنشاء المدينة');
  return inserted[0];
}

async function ensureFlags(db: Db): Promise<void> {
  for (const flag of FLAG_SEED) {
    await db
      .insert(featureFlags)
      .values({ key: flag.key, enabled: flag.enabled, value: flag.value })
      .onConflictDoNothing({ target: featureFlags.key });
  }
}

async function ensureVendorProfile(
  db: Db,
  input: {
    userId: string;
    cityId: string;
    seed: VendorSeed;
    approvalStatus: ApprovalStatus;
    isOpen: boolean;
  },
): Promise<VendorProfileRow> {
  const found = await db
    .select()
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, input.userId))
    .limit(1);
  if (found[0]) return found[0];
  const inserted = await db
    .insert(vendorProfiles)
    .values({
      userId: input.userId,
      cityId: input.cityId,
      storeNameAr: input.seed.storeNameAr,
      category: VendorCategory.BAKERY,
      location: { lat: input.seed.lat, lng: input.seed.lng },
      addressText: input.seed.addressText,
      isOpen: input.isOpen,
      defaultPrepMinutes: 15,
      approvalStatus: input.approvalStatus,
    })
    .returning();
  if (!inserted[0]) throw new Error(`تعذّر إنشاء ملف البائع ${input.seed.storeNameAr}`);
  return inserted[0];
}

async function ensureVendorProducts(db: Db, vendorId: string, count: number): Promise<ProductRow[]> {
  const slice = PRODUCT_CATALOG.slice(0, count);
  const existing = await db.select().from(products).where(eq(products.vendorId, vendorId));
  const have = new Set(existing.map((p) => p.nameAr));
  const missing = slice.filter((p) => !have.has(p.nameAr));
  if (missing.length > 0) {
    await db.insert(products).values(
      missing.map((p) => ({
        vendorId,
        nameAr: p.nameAr,
        descriptionAr: p.descriptionAr ?? null,
        priceIqd: p.priceIqd,
        section: p.section,
        isAvailable: true,
        sortOrder: slice.indexOf(p),
      })),
    );
  }
  return db.select().from(products).where(eq(products.vendorId, vendorId));
}

async function ensureDriverProfile(
  db: Db,
  input: { userId: string; cityId: string; approved: boolean },
): Promise<typeof driverProfiles.$inferSelect> {
  const found = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, input.userId))
    .limit(1);
  if (found[0]) return found[0];
  const inserted = await db
    .insert(driverProfiles)
    .values({
      userId: input.userId,
      cityId: input.cityId,
      vehicleType: VehicleType.MOTORCYCLE,
      isAvailable: input.approved,
      lastLocation: input.approved
        ? { lat: CITY_SEED.center.lat + 0.004, lng: CITY_SEED.center.lng - 0.003 }
        : null,
      locationUpdatedAt: input.approved ? new Date() : null,
      approvalStatus: input.approved ? ApprovalStatus.APPROVED : ApprovalStatus.PENDING,
    })
    .returning();
  if (!inserted[0]) throw new Error('تعذّر إنشاء ملف السائق');
  return inserted[0];
}

async function ensureCustomerAddress(
  db: Db,
  input: {
    userId: string;
    label: string;
    lat: number;
    lng: number;
    addressText: string;
    landmark: string;
    contactPhone: string;
  },
): Promise<typeof customerAddresses.$inferSelect> {
  const found = await db
    .select()
    .from(customerAddresses)
    .where(
      and(
        eq(customerAddresses.userId, input.userId),
        eq(customerAddresses.addressText, input.addressText),
      ),
    )
    .limit(1);
  if (found[0]) return found[0];
  const inserted = await db
    .insert(customerAddresses)
    .values({
      userId: input.userId,
      label: input.label,
      location: { lat: input.lat, lng: input.lng },
      addressText: input.addressText,
      landmark: input.landmark,
      contactPhone: input.contactPhone,
      isDefault: true,
    })
    .returning();
  if (!inserted[0]) throw new Error('تعذّر إنشاء عنوان العميل');
  return inserted[0];
}

async function uniqueOrderCode(db: Db): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = generateOrderCode();
    const hit = await db.select({ id: orders.id }).from(orders).where(eq(orders.code, code)).limit(1);
    if (hit.length === 0) return code;
  }
  throw new Error('تعذّر توليد كود طلب فريد');
}

interface OrderEventSeed {
  fromStatus: string | null;
  toStatus: string;
  actorUserId: string | null;
  actorRole: string;
  reason: string | null;
  createdAt: Date;
}

async function countRows(db: Db, table: PgTable): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return rows[0]?.n ?? 0;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: url });
  const db: Db = drizzle(pool);

  try {
    // 1) المستأجر + المدينة + الأعلام
    const tenant = await ensureTenant(db);
    const city = await ensureCity(db, tenant.id);
    await ensureFlags(db);

    // 2) كلمات المرور (argon2id) — تجزئة واحدة لكل كلمة مشتركة
    const [vendorHash, driverHash, customerHash] = await Promise.all([
      hashPassword(VENDOR_PASSWORD),
      hashPassword(DRIVER_PASSWORD),
      hashPassword(CUSTOMER_PASSWORD),
    ]);

    // 3) الإدارة — كلمة المرور لا تُنشر في المستودع:
    //    - SEED_ADMIN_PASSWORD موجود: يُعتمد ويُحدَّث الهاش حتى لو كان الأدمن قائماً (مسار تدوير).
    //    - غير موجود وأدمن جديد: تُولَّد كلمة عشوائية وتُطبع مرة واحدة في جدول الاعتماديات أدناه.
    //    - غير موجود وأدمن قائم: الهاش يبقى كما هو.
    // بلا trim: القيمة تُستهلك حرفياً كما ستُرسل عند الدخول — أي تشذيب هنا يخلق عدم تطابق صامت
    const envAdminPassword = process.env.SEED_ADMIN_PASSWORD || undefined;
    const [existingAdmin] = await db
      .select()
      .from(users)
      .where(eq(users.phone, normalizeIraqiPhone(ADMIN_SEED.phone)))
      .limit(1);
    if (existingAdmin && existingAdmin.role !== Role.ADMIN) {
      throw new Error(`رقم الأدمن ${ADMIN_SEED.phone} مملوك لحساب بدور ${existingAdmin.role} — رفض المتابعة`);
    }

    let admin: UserRow;
    let adminPasswordDisplay: string;
    if (!existingAdmin) {
      const adminPassword = envAdminPassword ?? randomBytes(18).toString('base64url');
      admin = await ensureUser(db, {
        phone: ADMIN_SEED.phone,
        passwordHash: await hashPassword(adminPassword),
        fullName: ADMIN_SEED.fullName,
        role: Role.ADMIN,
      });
      adminPasswordDisplay = envAdminPassword
        ? '(من SEED_ADMIN_PASSWORD)'
        : `${adminPassword}  ← وُلِّدت الآن ولن تُعرض مجدداً`;
    } else {
      admin = existingAdmin;
      if (envAdminPassword) {
        await db
          .update(users)
          .set({ passwordHash: await hashPassword(envAdminPassword) })
          .where(eq(users.id, admin.id));
        adminPasswordDisplay = '(حُدِّثت من SEED_ADMIN_PASSWORD)';
      } else {
        adminPasswordDisplay = '(بلا تغيير — عيّن SEED_ADMIN_PASSWORD وأعد الـ seed للتدوير)';
      }
    }
    await db
      .insert(adminCredentials)
      .values({ userId: admin.id, email: ADMIN_SEED.email, totpEnabled: false })
      .onConflictDoNothing();

    // TOTP إلزامي للدخول الإداري. للتطوير والاختبارات الآلية فقط: سرّ معلوم
    // يُمرَّر عبر SEED_ADMIN_TOTP_SECRET فيُسجَّل جاهزاً. في أي بيئة حقيقية
    // يُترك فارغاً — فيسجّل الأدمن جهازه بنفسه عند أول دخول (QR في اللوحة).
    const envTotpSecret = process.env.SEED_ADMIN_TOTP_SECRET?.trim() || undefined;
    let adminTotpDisplay = '(يُسجَّل عند أول دخول عبر QR)';
    if (envTotpSecret) {
      await db
        .update(adminCredentials)
        .set({
          totpSecret: envTotpSecret,
          pendingTotpSecret: null,
          totpEnabled: true,
          lastTotpStep: null,
        })
        .where(eq(adminCredentials.userId, admin.id));
      adminTotpDisplay = '(مسجَّل من SEED_ADMIN_TOTP_SECRET — للتطوير فقط)';
    }

    // 4) البائعون المعتمدون + منتجاتهم
    const vendorByPhone = new Map<
      string,
      { user: UserRow; profile: VendorProfileRow; products: Map<string, ProductRow> }
    >();
    for (const seed of APPROVED_VENDORS) {
      const user = await ensureUser(db, {
        phone: seed.phone,
        passwordHash: vendorHash,
        fullName: seed.ownerNameAr,
        role: Role.VENDOR,
      });
      const profile = await ensureVendorProfile(db, {
        userId: user.id,
        cityId: city.id,
        seed,
        approvalStatus: ApprovalStatus.APPROVED,
        isOpen: true,
      });
      const rows = await ensureVendorProducts(db, profile.id, seed.productCount);
      vendorByPhone.set(user.phone, {
        user,
        profile,
        products: new Map(rows.map((p) => [p.nameAr, p])),
      });
    }

    // 5) بائع قيد المراجعة (بلا منتجات)
    const pendingVendorUser = await ensureUser(db, {
      phone: PENDING_VENDOR.phone,
      passwordHash: vendorHash,
      fullName: PENDING_VENDOR.ownerNameAr,
      role: Role.VENDOR,
    });
    await ensureVendorProfile(db, {
      userId: pendingVendorUser.id,
      cityId: city.id,
      seed: PENDING_VENDOR,
      approvalStatus: ApprovalStatus.PENDING,
      isOpen: false,
    });

    // 6) السائقون (2 معتمدان + 1 قيد المراجعة)
    const approvedDriverUsers: UserRow[] = [];
    for (const seed of DRIVERS) {
      const user = await ensureUser(db, {
        phone: seed.phone,
        passwordHash: driverHash,
        fullName: seed.fullName,
        role: Role.DRIVER,
      });
      await ensureDriverProfile(db, { userId: user.id, cityId: city.id, approved: seed.approved });
      if (seed.approved) approvedDriverUsers.push(user);
    }
    const deliveryDriver = approvedDriverUsers[0];
    if (!deliveryDriver) throw new Error('لا يوجد سائق معتمد لطلب DELIVERED');

    // 7) العملاء + عناوينهم
    const customerByPhone = new Map<
      string,
      { user: UserRow; address: typeof customerAddresses.$inferSelect }
    >();
    for (const seed of CUSTOMERS) {
      const user = await ensureUser(db, {
        phone: seed.phone,
        passwordHash: customerHash,
        fullName: seed.fullName,
        role: Role.CUSTOMER,
      });
      const address = await ensureCustomerAddress(db, {
        userId: user.id,
        label: seed.address.label,
        lat: seed.address.lat,
        lng: seed.address.lng,
        addressText: seed.address.addressText,
        landmark: seed.address.landmark,
        contactPhone: user.phone,
      });
      customerByPhone.set(user.phone, { user, address });
    }

    // 8) الطلبات التجريبية — تُنشأ مرة واحدة فقط
    const customerIds = [...customerByPhone.values()].map((c) => c.user.id);
    const anyOrder = await db
      .select({ id: orders.id })
      .from(orders)
      .where(inArray(orders.customerId, customerIds))
      .limit(1);

    if (anyOrder.length > 0) {
      console.log('الطلبات التجريبية موجودة مسبقاً — تخطّي إنشاء الطلبات.');
    } else {
      const now = Date.now();
      for (const spec of ORDER_SPECS) {
        const vendor = vendorByPhone.get(normalizeIraqiPhone(spec.vendorPhone));
        const customer = customerByPhone.get(normalizeIraqiPhone(spec.customerPhone));
        if (!vendor) throw new Error(`بائع غير موجود للطلب: ${spec.vendorPhone}`);
        if (!customer) throw new Error(`عميل غير موجود للطلب: ${spec.customerPhone}`);

        const items = spec.items.map((it) => {
          const product = vendor.products.get(it.productNameAr);
          if (!product) {
            throw new Error(`منتج "${it.productNameAr}" غير موجود لدى ${vendor.profile.storeNameAr}`);
          }
          return {
            productId: product.id,
            productNameAr: product.nameAr,
            unitPriceIqd: product.priceIqd,
            quantity: it.quantity,
            lineTotalIqd: product.priceIqd * it.quantity,
          };
        });
        const subtotalIqd = items.reduce((sum, it) => sum + it.lineTotalIqd, 0);
        const deliveryFeeIqd = city.deliveryFeeIqd;
        const totalIqd = subtotalIqd + deliveryFeeIqd;

        const createdAt = new Date(now - spec.createdMinutesAgo * MINUTE_MS);
        const acceptTimeoutAt = new Date(
          createdAt.getTime() + city.vendorAcceptTimeoutMin * MINUTE_MS,
        );
        const acceptedAt = new Date(createdAt.getTime() + 2 * MINUTE_MS);
        const readyAt = new Date(createdAt.getTime() + 12 * MINUTE_MS);
        const pickedUpAt = new Date(createdAt.getTime() + 20 * MINUTE_MS);
        const deliveredAt = new Date(createdAt.getTime() + 35 * MINUTE_MS);
        const cancelledAt = new Date(createdAt.getTime() + 5 * MINUTE_MS);

        const wasAccepted =
          spec.status === OrderStatus.PREPARING ||
          spec.status === OrderStatus.READY ||
          spec.status === OrderStatus.DELIVERED;
        const wasReady = spec.status === OrderStatus.READY || spec.status === OrderStatus.DELIVERED;
        const wasDelivered = spec.status === OrderStatus.DELIVERED;
        const wasCancelled = spec.status === OrderStatus.CANCELLED;

        const events: OrderEventSeed[] = [
          {
            fromStatus: null,
            toStatus: OrderStatus.PENDING_BAKERY,
            actorUserId: customer.user.id,
            actorRole: Role.CUSTOMER,
            reason: null,
            createdAt,
          },
        ];
        if (wasAccepted) {
          events.push({
            fromStatus: OrderStatus.PENDING_BAKERY,
            toStatus: OrderStatus.PREPARING,
            actorUserId: vendor.user.id,
            actorRole: Role.VENDOR,
            reason: null,
            createdAt: acceptedAt,
          });
        }
        if (wasReady) {
          events.push({
            fromStatus: OrderStatus.PREPARING,
            toStatus: OrderStatus.READY,
            actorUserId: vendor.user.id,
            actorRole: Role.VENDOR,
            reason: null,
            createdAt: readyAt,
          });
        }
        if (wasDelivered) {
          events.push(
            {
              fromStatus: OrderStatus.READY,
              toStatus: OrderStatus.IN_DELIVERY,
              actorUserId: null,
              actorRole: 'system',
              reason: 'تأكيد الاستلام عبر الدفعة',
              createdAt: pickedUpAt,
            },
            {
              fromStatus: OrderStatus.IN_DELIVERY,
              toStatus: OrderStatus.DELIVERED,
              actorUserId: deliveryDriver.id,
              actorRole: Role.DRIVER,
              reason: null,
              createdAt: deliveredAt,
            },
          );
        }
        if (wasCancelled) {
          events.push({
            fromStatus: OrderStatus.PENDING_BAKERY,
            toStatus: OrderStatus.CANCELLED,
            actorUserId: vendor.user.id,
            actorRole: Role.VENDOR,
            reason: spec.cancelledReason ?? null,
            createdAt: cancelledAt,
          });
        }

        const code = await uniqueOrderCode(db);
        await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(orders)
            .values({
              code,
              cityId: city.id,
              customerId: customer.user.id,
              vendorId: vendor.profile.id,
              status: spec.status,
              subtotalIqd,
              deliveryFeeIqd,
              commissionIqd: 0,
              totalIqd,
              deliveryLocation: {
                lat: customer.address.location.lat,
                lng: customer.address.location.lng,
              },
              deliveryAddressText: customer.address.addressText,
              deliveryLandmark: customer.address.landmark,
              contactPhone: customer.address.contactPhone,
              note: spec.note ?? null,
              deliveryPin: generatePin(),
              prepMinutes: wasAccepted ? 15 : null,
              cancelledBy: wasCancelled ? Role.VENDOR : null,
              cancelledReason: wasCancelled ? (spec.cancelledReason ?? null) : null,
              acceptTimeoutAt,
              createdAt,
              acceptedAt: wasAccepted ? acceptedAt : null,
              readyAt: wasReady ? readyAt : null,
              pickedUpAt: wasDelivered ? pickedUpAt : null,
              deliveredAt: wasDelivered ? deliveredAt : null,
              cancelledAt: wasCancelled ? cancelledAt : null,
            })
            .returning({ id: orders.id });
          const orderId = inserted[0]?.id;
          if (!orderId) throw new Error(`تعذّر إنشاء الطلب ${code}`);

          await tx.insert(orderItems).values(items.map((it) => ({ orderId, ...it })));
          await tx.insert(orderEvents).values(events.map((ev) => ({ orderId, ...ev })));
        });
        console.log(`طلب ${code} — ${spec.status} — ${vendor.profile.storeNameAr}`);
      }
    }

    // 9) الملخص
    const [
      tenantCount,
      cityCount,
      flagCount,
      userCount,
      vendorCount,
      driverCount,
      productCount,
      addressCount,
      orderCount,
      orderItemCount,
      orderEventCount,
    ] = await Promise.all([
      countRows(db, tenants),
      countRows(db, cities),
      countRows(db, featureFlags),
      countRows(db, users),
      countRows(db, vendorProfiles),
      countRows(db, driverProfiles),
      countRows(db, products),
      countRows(db, customerAddresses),
      countRows(db, orders),
      countRows(db, orderItems),
      countRows(db, orderEvents),
    ]);
    const ordersByStatus = await db
      .select({ status: orders.status, n: sql<number>`count(*)::int` })
      .from(orders)
      .groupBy(orders.status);

    console.log('\n===== Seed summary =====');
    console.table([
      { table: 'tenants', count: tenantCount },
      { table: 'cities', count: cityCount },
      { table: 'feature_flags', count: flagCount },
      { table: 'users', count: userCount },
      { table: 'vendor_profiles', count: vendorCount },
      { table: 'driver_profiles', count: driverCount },
      { table: 'products', count: productCount },
      { table: 'customer_addresses', count: addressCount },
      { table: 'orders', count: orderCount },
      { table: 'order_items', count: orderItemCount },
      { table: 'order_events', count: orderEventCount },
    ]);
    console.table(
      ordersByStatus.map((row) => ({ order_status: row.status, count: row.n })),
    );

    console.log('===== Test credentials =====');
    console.table([
      {
        role: 'admin (لوحة الويب فقط)',
        login: ADMIN_SEED.email,
        password: `${adminPasswordDisplay} + TOTP ${adminTotpDisplay}`,
      },
      { role: 'vendor', login: '+9647701000001 .. +9647701000006', password: VENDOR_PASSWORD },
      { role: 'vendor (pending)', login: PENDING_VENDOR.phone, password: VENDOR_PASSWORD },
      { role: 'driver', login: '+9647702000001 .. +9647702000002', password: DRIVER_PASSWORD },
      { role: 'driver (pending)', login: '+9647702000003', password: DRIVER_PASSWORD },
      { role: 'customer', login: '+9647703000001 .. +9647703000003', password: CUSTOMER_PASSWORD },
    ]);
    console.log('seed completed');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
