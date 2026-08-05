import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { BatchingService } from '../src/modules/deliveries/batching.service';

/**
 * قبول M2 (الخطة): طلبان READY من مخبز واحد يتجمعان بدفعة، سائقان يتسابقان
 * فيفوز واحد، استلام بـ PIN، تسليم أحدهما وفتح استثناء للآخر،
 * التسوية تصفّر العهدة، وحركة تصحيح تنشئ قيداً عكسياً.
 */

const ADMIN_EMAIL = 'admin@superapp.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '';
const KARRADA = { lat: 33.306, lng: 44.426 };

function randomIraqiPhone(): string {
  return `+96478${String(randomInt(0, 99999999)).padStart(8, '0')}`;
}

const idem = () => randomUUID();

describe('M2 acceptance — batching, PINs, ledger, settlement', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let batching: BatchingService;

  let adminAccess = '';
  let vendorAccess = '';
  let customerAccess = '';
  let driver1Access = '';
  let driver2Access = '';
  let vendorProfileId = '';
  let productId = '';
  const orderIds: string[] = [];
  const orderInfo: Record<string, { totalIqd: number; deliveryPin: string; subtotalIqd: number }> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    http = app.getHttpServer();
    batching = app.get(BatchingService);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function adminLogin(): Promise<string> {
    const res = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    return res.body.tokens.accessToken;
  }

  async function registerAndApprove(
    role: 'vendor' | 'driver',
    body: Record<string, unknown>,
  ): Promise<string> {
    const reg = await request(http).post('/api/v1/auth/register').send(body).expect(201);
    const token = reg.body.tokens.accessToken;
    const list = await request(http)
      .get(`/api/v1/admin/approvals?type=${role}&status=pending`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    const rows = list.body.items ?? list.body;
    const mine = rows.find((r: { phone: string }) => r.phone === body.phone);
    await request(http)
      .post(`/api/v1/admin/approvals/${role}/${mine.profileId ?? mine.id}/approve`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({})
      .expect(201);
    if (role === 'vendor') vendorProfileId = mine.profileId ?? mine.id;
    return token;
  }

  it('setup: actors registered and approved', async () => {
    adminAccess = await adminLogin();

    vendorAccess = await registerAndApprove('vendor', {
      role: 'vendor',
      phone: randomIraqiPhone(),
      password: 'Vendor#1234',
      fullName: 'خباز دفعات',
      storeNameAr: 'مخبز اختبار الدفعات',
      category: 'bakery',
      location: KARRADA,
      addressText: 'الكرادة — زقاق الاختبار',
    });

    driver1Access = await registerAndApprove('driver', {
      role: 'driver',
      phone: randomIraqiPhone(),
      password: 'Driver#1234',
      fullName: 'سائق أول',
      vehicleType: 'motorcycle',
    });
    driver2Access = await registerAndApprove('driver', {
      role: 'driver',
      phone: randomIraqiPhone(),
      password: 'Driver#1234',
      fullName: 'سائق ثانٍ',
      vehicleType: 'motorcycle',
    });

    for (const token of [driver1Access, driver2Access]) {
      await request(http)
        .patch('/api/v1/driver/availability')
        .set('Authorization', `Bearer ${token}`)
        .set('x-idempotency-key', idem())
        .send({ isAvailable: true })
        .expect(200);
    }

    await request(http)
      .patch('/api/v1/vendor/profile/open')
      .set('Authorization', `Bearer ${vendorAccess}`)
      .set('x-idempotency-key', idem())
      .send({ isOpen: true })
      .expect(200);
    const prod = await request(http)
      .post('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${vendorAccess}`)
      .set('x-idempotency-key', idem())
      .send({ nameAr: 'خبز تنور', priceIqd: 1000, section: 'خبز' })
      .expect(201);
    productId = prod.body.id;

    const customerPhone = randomIraqiPhone();
    const reg = await request(http)
      .post('/api/v1/auth/register')
      .send({
        role: 'customer',
        phone: customerPhone,
        password: 'Customer#123',
        fullName: 'زبون الدفعات',
      })
      .expect(201);
    customerAccess = reg.body.tokens.accessToken;
  });

  it('two orders reach READY and the engine batches them together', async () => {
    for (const qty of [2, 4]) {
      const res = await request(http)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerAccess}`)
        .set('x-idempotency-key', idem())
        .send({
          vendorId: vendorProfileId,
          items: [{ productId, quantity: qty }],
          delivery: {
            location: { lat: 33.31 + qty / 1000, lng: 44.43 },
            addressText: `عنوان توصيل ${qty}`,
            contactPhone: '+9647811111111',
          },
        })
        .expect(201);
      orderIds.push(res.body.id);
      orderInfo[res.body.id] = {
        totalIqd: res.body.totalIqd,
        subtotalIqd: res.body.subtotalIqd,
        deliveryPin: res.body.deliveryPin,
      };

      const accept = await request(http)
        .post(`/api/v1/vendor/orders/${res.body.id}/accept`)
        .set('Authorization', `Bearer ${vendorAccess}`)
        .set('x-idempotency-key', idem())
        .send({ prepMinutes: 5, expectedVersion: res.body.version })
        .expect(201);
      await request(http)
        .post(`/api/v1/vendor/orders/${res.body.id}/ready`)
        .set('Authorization', `Bearer ${vendorAccess}`)
        .set('x-idempotency-key', idem())
        .send({ expectedVersion: accept.body.version })
        .expect(201);
    }

    // بدل انتظار نافذة التجميع (75 ثانية) نستدعي المحرك مباشرة
    await batching.proposeBatches(vendorProfileId);

    const available = await request(http)
      .get('/api/v1/driver/batches/available')
      .set('Authorization', `Bearer ${driver1Access}`)
      .expect(200);
    const batch = available.body.find(
      (b: { ordersCount: number; vendorNameAr?: string; vendorName?: string }) =>
        (b.vendorNameAr ?? b.vendorName) === 'مخبز اختبار الدفعات',
    );
    expect(batch).toBeTruthy();
    expect(batch.ordersCount).toBe(2);
    expect(batch.totalFeeIqd).toBe(4000);
    batchId = batch.id;
  });

  let batchId = '';
  let winnerAccess = '';
  let pickupPin = '';

  it('claim race: two drivers, exactly one wins', async () => {
    const [r1, r2] = await Promise.all([
      request(http)
        .post(`/api/v1/driver/batches/${batchId}/claim`)
        .set('Authorization', `Bearer ${driver1Access}`)
        .set('x-idempotency-key', idem())
        .send({}),
      request(http)
        .post(`/api/v1/driver/batches/${batchId}/claim`)
        .set('Authorization', `Bearer ${driver2Access}`)
        .set('x-idempotency-key', idem())
        .send({}),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses.filter((s) => s < 300).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(1);
    winnerAccess = r1.status < 300 ? driver1Access : driver2Access;
  });

  it('pickup: wrong PIN rejected, vendor sees pickup PIN, right PIN moves orders to IN_DELIVERY', async () => {
    await request(http)
      .post(`/api/v1/driver/batches/${batchId}/confirm-pickup`)
      .set('Authorization', `Bearer ${winnerAccess}`)
      .set('x-idempotency-key', idem())
      .send({ pin: '0000' })
      .expect(403);

    // PIN الاستلام يعرضه تطبيق المخبز؛ في الاختبار نقرأه من القاعدة مباشرة
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query('SELECT pickup_pin FROM batches WHERE id = $1', [batchId]);
    await pool.end();
    pickupPin = rows[0].pickup_pin;

    await request(http)
      .post(`/api/v1/driver/batches/${batchId}/confirm-pickup`)
      .set('Authorization', `Bearer ${winnerAccess}`)
      .set('x-idempotency-key', idem())
      .send({ pin: pickupPin })
      .expect(201);

    const active = await request(http)
      .get('/api/v1/driver/batches/active')
      .set('Authorization', `Bearer ${winnerAccess}`)
      .expect(200);
    expect(active.body.stops).toHaveLength(2);
    for (const stop of active.body.stops) {
      expect(stop.status).toBe('IN_DELIVERY');
      expect(stop.contactPhoneMasked).not.toContain('+964');
    }
  });

  it('delivery: wrong PIN / wrong cash rejected; correct → DELIVERED with ledger entries', async () => {
    const orderId = orderIds[0]!;
    const info = orderInfo[orderId]!;

    await request(http)
      .post(`/api/v1/driver/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${winnerAccess}`)
      .set('x-idempotency-key', idem())
      .send({ pin: '9999', cashCollectedIqd: info.totalIqd })
      .expect(403);

    const wrongCash = await request(http)
      .post(`/api/v1/driver/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${winnerAccess}`)
      .set('x-idempotency-key', idem())
      .send({ pin: info.deliveryPin, cashCollectedIqd: info.totalIqd - 250 });
    expect(wrongCash.status).toBe(409);
    expect(wrongCash.body.code).toBe('CASH_MISMATCH');

    await request(http)
      .post(`/api/v1/driver/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${winnerAccess}`)
      .set('x-idempotency-key', idem())
      .send({ pin: info.deliveryPin, cashCollectedIqd: info.totalIqd })
      .expect(201);

    const ledger = await request(http)
      .get('/api/v1/driver/ledger')
      .set('Authorization', `Bearer ${winnerAccess}`)
      .expect(200);
    expect(ledger.body.cashOnHandIqd).toBe(info.totalIqd);
    expect(ledger.body.todayFeesIqd).toBe(2000);
    expect(ledger.body.owed[0].amountIqd).toBe(info.subtotalIqd);
  });

  it('exception on second order: no money moves, batch completes, admin cancels it', async () => {
    const orderId = orderIds[1]!;
    await request(http)
      .post(`/api/v1/driver/orders/${orderId}/exception`)
      .set('Authorization', `Bearer ${winnerAccess}`)
      .set('x-idempotency-key', idem())
      .send({ type: 'customer_unavailable', note: 'لا يرد على الهاتف' })
      .expect(201);

    // الطلب يبقى IN_DELIVERY حتى قرار إداري (الملف §8.1)
    const view = await request(http)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(200);
    expect(view.body.status).toBe('IN_DELIVERY');

    // الدفعة اكتملت (كل التوقفات محسومة: تسليم أو استثناء)
    const none = await request(http)
      .get('/api/v1/driver/batches/active')
      .set('Authorization', `Bearer ${winnerAccess}`);
    expect([200, 404]).toContain(none.status);
    if (none.status === 200) expect(none.body?.id).toBeFalsy();

    // العهدة لم تتغير — لا مال على طلب فاشل
    const ledger = await request(http)
      .get('/api/v1/driver/ledger')
      .set('Authorization', `Bearer ${winnerAccess}`)
      .expect(200);
    expect(ledger.body.cashOnHandIqd).toBe(orderInfo[orderIds[0]!]!.totalIqd);

    // الأدمن يحسم الاستثناء بإلغاء الطلب
    const exceptions = await request(http)
      .get('/api/v1/admin/exceptions?status=OPEN')
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    const rows = exceptions.body.items ?? exceptions.body;
    const mine = rows.find((e: { orderId: string }) => e.orderId === orderId);
    expect(mine).toBeTruthy();

    await request(http)
      .post(`/api/v1/admin/exceptions/${mine.id}/resolve`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .set('x-idempotency-key', idem())
      .send({ decision: 'cancel_order', reason: 'العميل غير متاح نهائياً' })
      .expect(201);

    const after = await request(http)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(200);
    expect(after.body.status).toBe('CANCELLED');
  });

  it('settlement: driver initiates with PIN, vendor confirms, custody drops to fee only', async () => {
    const init = await request(http)
      .post('/api/v1/driver/settlements')
      .set('Authorization', `Bearer ${winnerAccess}`)
      .set('x-idempotency-key', idem())
      .send({ vendorId: vendorProfileId })
      .expect(201);
    const settlementId = init.body.id;
    const pin = init.body.settlementPin;
    expect(pin).toMatch(/^\d{4}$/);
    expect(init.body.amountIqd).toBe(orderInfo[orderIds[0]!]!.subtotalIqd);

    await request(http)
      .post(`/api/v1/vendor/settlements/${settlementId}/confirm`)
      .set('Authorization', `Bearer ${vendorAccess}`)
      .set('x-idempotency-key', idem())
      .send({ pin: '0000' })
      .expect(403);

    await request(http)
      .post(`/api/v1/vendor/settlements/${settlementId}/confirm`)
      .set('Authorization', `Bearer ${vendorAccess}`)
      .set('x-idempotency-key', idem())
      .send({ pin })
      .expect(201);

    const ledger = await request(http)
      .get('/api/v1/driver/ledger')
      .set('Authorization', `Bearer ${winnerAccess}`)
      .expect(200);
    // بعد التسوية: العهدة = الإجمالي المحصل - المسدد للمخبز = أجرة التوصيل فقط
    expect(ledger.body.cashOnHandIqd).toBe(2000);
    expect(ledger.body.owed).toHaveLength(0);
  });

  it('admin: finance summary + reversal entry', async () => {
    const summary = await request(http)
      .get('/api/v1/admin/finance/summary')
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    expect(summary.body.gmvIqd).toBeGreaterThan(0);

    const entries = await request(http)
      .get(`/api/v1/admin/ledger?orderId=${orderIds[0]}`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    const rows = entries.body.items ?? entries.body;
    const fee = rows.find((e: { entryType: string }) => e.entryType === 'delivery_fee');
    expect(fee).toBeTruthy();

    const rev = await request(http)
      .post(`/api/v1/admin/ledger/${fee.id}/reverse`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .set('x-idempotency-key', idem())
      .send({ reason: 'قيد اختبار عكسي' })
      .expect(201);
    expect(rev.body.amountIqd).toBe(-fee.amountIqd);

    // لا يمكن عكس نفس القيد مرتين
    await request(http)
      .post(`/api/v1/admin/ledger/${fee.id}/reverse`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .set('x-idempotency-key', idem())
      .send({ reason: 'تكرار' })
      .expect(409);
  });
});
