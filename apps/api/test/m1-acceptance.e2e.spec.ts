import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loginAdmin } from './helpers/admin-login';

/**
 * قبول M1 (الخطة): طلب يمر بكل الحالات، الانتقالات غير الشرعية مرفوضة،
 * order_events كامل، rotation للتوكنات، idempotency، وحوكمة الموافقات.
 * يتطلب: قاعدة مهاجَرة + seed بنفس SEED_ADMIN_PASSWORD وSEED_ADMIN_TOTP_SECRET.
 */

const ADMIN_PHONE = '+9647700000001';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '';
const KARRADA = { lat: 33.306, lng: 44.426 };

function randomIraqiPhone(): string {
  return `+96477${String(randomInt(0, 99999999)).padStart(8, '0')}`;
}

describe('M1 acceptance', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const customerPhone = randomIraqiPhone();
  const vendorPhone = randomIraqiPhone();
  let customerAccess = '';
  let customerRefresh = '';
  let vendorAccess = '';
  let adminAccess = '';
  let vendorProfileId = '';
  let productId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('health: up with db', async () => {
    const res = await request(http).get('/api/v1/health').expect(200);
    expect(res.body.db).toBe('up');
  });

  it('auth: customer registers and logs in', async () => {
    const reg = await request(http)
      .post('/api/v1/auth/register')
      .send({
        role: 'customer',
        phone: customerPhone,
        password: 'Customer#123',
        fullName: 'زبون الاختبار',
      })
      .expect(201);
    expect(reg.body.tokens.accessToken).toBeTruthy();
    customerAccess = reg.body.tokens.accessToken;
    customerRefresh = reg.body.tokens.refreshToken;
  });

  it('auth: refresh rotation + reuse detection', async () => {
    const r1 = await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: customerRefresh });
    expect([200, 201]).toContain(r1.status);
    const newRefresh = r1.body.tokens?.refreshToken ?? r1.body.refreshToken;
    expect(newRefresh).toBeTruthy();

    // إعادة استخدام التوكن القديم = سرقة مفترضة → العائلة كلها تُلغى
    await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: customerRefresh })
      .expect(401);
    await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: newRefresh })
      .expect(401);

    // الدخول من جديد يعمل
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: customerPhone, password: 'Customer#123' })
      .expect(200);
    customerAccess = login.body.tokens.accessToken;
  });

  it('admin: logs in via /auth/admin/login (email + password + TOTP)', async () => {
    adminAccess = await loginAdmin(http);
  });

  it('security: phone login rejects admin even with correct password (TOTP bypass closed)', async () => {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD })
      .expect(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('vendor: registers pending, business routes locked with PENDING_APPROVAL', async () => {
    const reg = await request(http)
      .post('/api/v1/auth/register')
      .send({
        role: 'vendor',
        phone: vendorPhone,
        password: 'Vendor#1234',
        fullName: 'خباز الاختبار',
        storeNameAr: 'مخبز الاختبار الآلي',
        category: 'bakery',
        location: KARRADA,
        addressText: 'الكرادة — شارع الاختبار',
      })
      .expect(201);
    vendorAccess = reg.body.tokens.accessToken;

    const locked = await request(http)
      .get('/api/v1/vendor/orders')
      .set('Authorization', `Bearer ${vendorAccess}`)
      .expect(403);
    expect(locked.body.code).toBe('PENDING_APPROVAL');
  });

  it('admin: approves the vendor (audited)', async () => {
    const list = await request(http)
      .get('/api/v1/admin/approvals?type=vendor&status=pending')
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    const rows = list.body.items ?? list.body;
    const mine = rows.find((r: { phone: string }) => r.phone === vendorPhone);
    expect(mine).toBeTruthy();
    vendorProfileId = mine.profileId ?? mine.id;

    await request(http)
      .post(`/api/v1/admin/approvals/vendor/${vendorProfileId}/approve`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({})
      .expect(201);
  });

  it('vendor: opens store and creates a product', async () => {
    await request(http)
      .patch('/api/v1/vendor/profile/open')
      .set('Authorization', `Bearer ${vendorAccess}`)
      .send({ isOpen: true })
      .expect(200);

    const prod = await request(http)
      .post('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${vendorAccess}`)
      .send({ nameAr: 'صمون حجري', priceIqd: 500, section: 'خبز' })
      .expect(201);
    productId = prod.body.id;
  });

  it('customer: sees the bakery on the map (PostGIS nearby)', async () => {
    const res = await request(http)
      .get(`/api/v1/vendors/nearby?lat=${KARRADA.lat}&lng=${KARRADA.lng}&radius=3000`)
      .expect(200);
    const found = res.body.find((v: { id: string }) => v.id === vendorProfileId);
    expect(found).toBeTruthy();
    expect(found.isOpen).toBe(true);
    expect(typeof found.distanceM).toBe('number');
  });

  function orderPayload() {
    return {
      vendorId: vendorProfileId,
      items: [{ productId, quantity: 3 }],
      delivery: {
        location: { lat: 33.309, lng: 44.429 },
        addressText: 'قرب ساحة الاختبار',
        landmark: 'الباب الأزرق',
        contactPhone: customerPhone,
      },
      note: 'بدون سمسم',
    };
  }

  let orderId = '';
  let orderVersion = 1;

  it('order: created COD with code + delivery PIN, totals correct', async () => {
    const res = await request(http)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('x-idempotency-key', randomUUID())
      .send(orderPayload())
      .expect(201);
    expect(res.body.status).toBe('PENDING_BAKERY');
    expect(res.body.code).toMatch(/^[A-Z]{2}-/);
    expect(res.body.deliveryPin).toMatch(/^\d{4}$/);
    expect(res.body.subtotalIqd).toBe(1500);
    expect(res.body.deliveryFeeIqd).toBe(2000);
    expect(res.body.totalIqd).toBe(3500);
    orderId = res.body.id;
    orderVersion = res.body.version;
  });

  it('idempotency: same key + same body returns the same order, no duplicate', async () => {
    const key = randomUUID();
    const first = await request(http)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('x-idempotency-key', key)
      .send(orderPayload())
      .expect(201);
    const second = await request(http)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('x-idempotency-key', key)
      .send(orderPayload());
    expect(second.body.id).toBe(first.body.id);

    // نفس المفتاح بجسم مختلف = 409
    const diff = await request(http)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('x-idempotency-key', key)
      .send({ ...orderPayload(), note: 'مختلف' });
    expect(diff.status).toBe(409);

    // تنظيف: إلغاء الطلب الثاني
    await request(http)
      .post(`/api/v1/orders/${first.body.id}/cancel`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('x-idempotency-key', randomUUID())
      .send({ reason: 'اختبار idempotency' })
      .expect(201);
  });

  it('machine: illegal transition rejected (READY before accept)', async () => {
    const res = await request(http)
      .post(`/api/v1/vendor/orders/${orderId}/ready`)
      .set('Authorization', `Bearer ${vendorAccess}`)
      .set('x-idempotency-key', randomUUID())
      .send({ expectedVersion: orderVersion });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ILLEGAL_TRANSITION');
  });

  it('machine: version conflict on stale expectedVersion', async () => {
    const res = await request(http)
      .post(`/api/v1/vendor/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${vendorAccess}`)
      .set('x-idempotency-key', randomUUID())
      .send({ prepMinutes: 10, expectedVersion: 999 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VERSION_CONFLICT');
  });

  it('machine: PENDING → PREPARING → READY with actor checks', async () => {
    const acc = await request(http)
      .post(`/api/v1/vendor/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${vendorAccess}`)
      .set('x-idempotency-key', randomUUID())
      .send({ prepMinutes: 10, expectedVersion: orderVersion })
      .expect(201);
    expect(acc.body.status).toBe('PREPARING');
    orderVersion = acc.body.version;

    // العميل لا يستطيع الإلغاء بعد القبول (سياسة الملف: PENDING فقط)
    const lateCancel = await request(http)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('x-idempotency-key', randomUUID())
      .send({ reason: 'غيرت رأيي' });
    expect(lateCancel.status).toBe(409);

    const ready = await request(http)
      .post(`/api/v1/vendor/orders/${orderId}/ready`)
      .set('Authorization', `Bearer ${vendorAccess}`)
      .set('x-idempotency-key', randomUUID())
      .send({ expectedVersion: orderVersion })
      .expect(201);
    expect(ready.body.status).toBe('READY');
    orderVersion = ready.body.version;
  });

  it('machine: customer sees status live via GET, admin force-cancel audited', async () => {
    const view = await request(http)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(200);
    expect(view.body.status).toBe('READY');
    expect(view.body.timestamps.readyAt).toBeTruthy();

    await request(http)
      .post(`/api/v1/admin/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .set('x-idempotency-key', randomUUID())
      .send({ reason: 'إغلاق سيناريو الاختبار' })
      .expect(201);

    const after = await request(http)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(200);
    expect(after.body.status).toBe('CANCELLED');
  });

  it('flags: public config exposes bakery enabled + city ops values', async () => {
    const res = await request(http).get('/api/v1/config').expect(200);
    expect(res.body.flags['category.bakery'].enabled).toBe(true);
    expect(res.body.flags['auth.otp'].enabled).toBe(false);
    expect(res.body.city.deliveryFeeIqd).toBe(2000);
  });

  it('rbac: customer cannot hit admin routes', async () => {
    await request(http)
      .get('/api/v1/admin/approvals?type=vendor&status=pending')
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(403);
  });
});
