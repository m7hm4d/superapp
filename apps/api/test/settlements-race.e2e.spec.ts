import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB, DbClient } from '../src/db/drizzle.module';
import { cities, driverProfiles, ledgerEntries, orders, settlements } from '../src/db/schema';
import { SettlementsService } from '../src/modules/ledger/settlements.service';

/**
 * ضمانات آلة 3 ضد ازدواج التسوية (الملف §8.3): لقطة المستحق تُحسب داخل
 * معاملة القفل، وتسوية DISPUTED تحجب بدء تسوية جديدة لنفس الثنائي —
 * فلا يمكن خصم عهدة السائق مرتين عن الطلبات نفسها.
 * يتطلب: قاعدة مهاجَرة + seed مُشغَّل بنفس SEED_ADMIN_PASSWORD المتاح هنا.
 */

const ADMIN_EMAIL = 'admin@superapp.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '';
const KARRADA = { lat: 33.306, lng: 44.426 };

function randomIraqiPhone(): string {
  return `+96477${String(randomInt(0, 99999999)).padStart(8, '0')}`;
}

describe('settlement doubling guarantees', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let db: DbClient;

  let adminAccess = '';
  let adminUserId = '';
  let vendorAccess = '';
  let vendorProfileId = '';
  let driverAccess = '';
  let driverProfileId = '';
  let customerId = '';
  let cityId = '';

  /** يزرع طلباً DELIVERED + قيد cash_collected كما يكتبهما مسار التسليم الحقيقي */
  async function seedDeliveredOrder(subtotalIqd: number, deliveryFeeIqd = 2000): Promise<string> {
    const totalIqd = subtotalIqd + deliveryFeeIqd;
    const [order] = await db
      .insert(orders)
      .values({
        code: `TS-${randomInt(1000, 9999)}${randomInt(1000, 9999)}`,
        cityId,
        customerId,
        vendorId: vendorProfileId,
        status: 'DELIVERED',
        subtotalIqd,
        deliveryFeeIqd,
        commissionIqd: 0,
        totalIqd,
        deliveryLocation: { lat: 33.309, lng: 44.429 },
        deliveryAddressText: 'قرب ساحة اختبار التسوية',
        contactPhone: '+9647700000099',
        deliveryPin: '1234',
        acceptTimeoutAt: new Date(),
        deliveredAt: new Date(),
      })
      .returning({ id: orders.id });
    await db.insert(ledgerEntries).values([
      { entryType: 'delivery_fee', orderId: order.id, driverId: driverProfileId, amountIqd: deliveryFeeIqd },
      { entryType: 'cash_collected', orderId: order.id, driverId: driverProfileId, amountIqd: totalIqd },
    ]);
    return order.id;
  }

  async function driverCashOnHand(): Promise<number> {
    const res = await request(http)
      .get('/api/v1/driver/ledger')
      .set('Authorization', `Bearer ${driverAccess}`)
      .expect(200);
    return res.body.cashOnHandIqd;
  }

  async function settlementDebitsCount(): Promise<number> {
    const rows = await db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(
        and(eq(ledgerEntries.driverId, driverProfileId), eq(ledgerEntries.entryType, 'settlement')),
      );
    return rows.length;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    http = app.getHttpServer();
    db = app.get(DB);

    expect(ADMIN_PASSWORD, 'SEED_ADMIN_PASSWORD مطلوب لتهيئة هذا الاختبار').toBeTruthy();
    const adminRes = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    adminAccess = adminRes.body.tokens.accessToken;
    adminUserId = adminRes.body.user.id;

    const [city] = await db.select({ id: cities.id }).from(cities).limit(1);
    expect(city).toBeTruthy();
    cityId = city.id;

    // مخبز معتمد
    const vendorPhone = randomIraqiPhone();
    const vendorReg = await request(http)
      .post('/api/v1/auth/register')
      .send({
        role: 'vendor',
        phone: vendorPhone,
        password: 'Vendor#1234',
        fullName: 'خباز التسويات',
        storeNameAr: 'مخبز اختبار التسويات',
        category: 'bakery',
        location: KARRADA,
        addressText: 'الكرادة — شارع التسويات',
      })
      .expect(201);
    vendorAccess = vendorReg.body.tokens.accessToken;
    const vendorList = await request(http)
      .get('/api/v1/admin/approvals?type=vendor&status=pending')
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    const vendorRows = vendorList.body.items ?? vendorList.body;
    const myVendor = vendorRows.find((r: { phone: string }) => r.phone === vendorPhone);
    vendorProfileId = myVendor.profileId ?? myVendor.id;
    await request(http)
      .post(`/api/v1/admin/approvals/vendor/${vendorProfileId}/approve`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({})
      .expect(201);

    // سائق معتمد
    const driverPhone = randomIraqiPhone();
    const driverReg = await request(http)
      .post('/api/v1/auth/register')
      .send({
        role: 'driver',
        phone: driverPhone,
        password: 'Driver#1234',
        fullName: 'سائق التسويات',
        vehicleType: 'motorcycle',
      })
      .expect(201);
    driverAccess = driverReg.body.tokens.accessToken;
    const driverUserId = driverReg.body.user.id;
    const driverList = await request(http)
      .get('/api/v1/admin/approvals?type=driver&status=pending')
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    const driverRows = driverList.body.items ?? driverList.body;
    const myDriver = driverRows.find((r: { phone: string }) => r.phone === driverPhone);
    await request(http)
      .post(`/api/v1/admin/approvals/driver/${myDriver.profileId ?? myDriver.id}/approve`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({})
      .expect(201);
    const [dp] = await db
      .select({ id: driverProfiles.id })
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driverUserId))
      .limit(1);
    driverProfileId = dp.id;

    // عميل (صاحب الطلبات المزروعة)
    const customerReg = await request(http)
      .post('/api/v1/auth/register')
      .send({
        role: 'customer',
        phone: randomIraqiPhone(),
        password: 'Customer#123',
        fullName: 'زبون التسويات',
      })
      .expect(201);
    customerId = customerReg.body.user.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('dispute doubling closed: a DISPUTED settlement blocks re-initiation until admin resolves', async () => {
    await seedDeliveredOrder(10_000); // عهدة السائق: 12,000 (نقد محصَّل)

    const init = await request(http)
      .post('/api/v1/driver/settlements')
      .set('Authorization', `Bearer ${driverAccess}`)
      .send({ vendorId: vendorProfileId })
      .expect(201);
    expect(init.body.amountIqd).toBe(10_000);
    const settlementId = init.body.id;

    await request(http)
      .post(`/api/v1/vendor/settlements/${settlementId}/dispute`)
      .set('Authorization', `Bearer ${vendorAccess}`)
      .send({ reason: 'المبلغ غير مطابق' })
      .expect(201);

    // قبل الإصلاح: كانت تُنشأ تسوية ثانية لنفس الطلبات هنا (ثم يحسم الأدمن
    // الأولى فيُخصم المبلغ مرتين) — الآن المعترَض عليها تحجب البدء
    const again = await request(http)
      .post('/api/v1/driver/settlements')
      .set('Authorization', `Bearer ${driverAccess}`)
      .send({ vendorId: vendorProfileId })
      .expect(409);
    expect(again.body.code).toBe('SETTLEMENT_IN_PROGRESS');

    // الأدمن يحسم الاعتراض (المسار غير مكشوف عبر HTTP بعد — نداء مباشر للخدمة)
    await app.get(SettlementsService).adminResolve(settlementId, adminUserId, 'تم العد يدوياً');

    expect(await settlementDebitsCount()).toBe(1);
    expect(await driverCashOnHand()).toBe(2_000); // بقيت أجرة التوصيل فقط

    // بعد الحسم لا شيء مستحقاً — اللقطة الطازجة تستبعد المسوّى
    const empty = await request(http)
      .post('/api/v1/driver/settlements')
      .set('Authorization', `Bearer ${driverAccess}`)
      .send({ vendorId: vendorProfileId })
      .expect(409);
    expect(empty.body.code).toBe('NOTHING_TO_SETTLE');
  });

  it('concurrency: parallel initiations create exactly one settlement', async () => {
    await seedDeliveredOrder(7_000); // عهدة إضافية: 9,000

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(http)
          .post('/api/v1/driver/settlements')
          .set('Authorization', `Bearer ${driverAccess}`)
          .send({ vendorId: vendorProfileId }),
      ),
    );
    const created = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);
    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(3);

    const open = await db
      .select({ id: settlements.id })
      .from(settlements)
      .where(
        and(
          eq(settlements.driverId, driverProfileId),
          eq(settlements.vendorId, vendorProfileId),
          inArray(settlements.status, ['UNSETTLED', 'AWAITING_CONFIRMATION', 'DISPUTED']),
        ),
      );
    expect(open).toHaveLength(1);

    await request(http)
      .post(`/api/v1/vendor/settlements/${created[0].body.id}/confirm`)
      .set('Authorization', `Bearer ${vendorAccess}`)
      .send({ pin: created[0].body.settlementPin })
      .expect(201);

    expect(await settlementDebitsCount()).toBe(2);
    expect(await driverCashOnHand()).toBe(4_000); // أجرتا توصيل فقط
  });

  it('fresh snapshot: a new settlement covers only unsettled orders', async () => {
    const orderId = await seedDeliveredOrder(5_000); // عهدة إضافية: 7,000

    const init = await request(http)
      .post('/api/v1/driver/settlements')
      .set('Authorization', `Bearer ${driverAccess}`)
      .send({ vendorId: vendorProfileId })
      .expect(201);
    // المبلغ والطلبات = الطلب الجديد فقط — المسوّى سابقاً مستبعد
    expect(init.body.amountIqd).toBe(5_000);
    expect(init.body.orderIds).toEqual([orderId]);

    await request(http)
      .post(`/api/v1/vendor/settlements/${init.body.id}/confirm`)
      .set('Authorization', `Bearer ${vendorAccess}`)
      .send({ pin: init.body.settlementPin })
      .expect(201);

    expect(await settlementDebitsCount()).toBe(3);
    expect(await driverCashOnHand()).toBe(6_000); // ثلاث أجور توصيل
  });
});
