import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loginAdmin } from './helpers/admin-login';
import { IdempotencyPurgeService } from '../src/common/idempotency-purge.service';
import { DB, DbClient } from '../src/db/drizzle.module';
import { idempotencyKeys, orders } from '../src/db/schema';

/**
 * ضمانات idempotency (الملف §5): الذرية تحت التزامن، عدم تخزين استجابات
 * المصادقة (توكنات/أسرار TOTP)، فك الادعاء عند الفشل، والاحتفاظ المحدود.
 * يتطلب: قاعدة مهاجَرة + seed بنفس SEED_ADMIN_PASSWORD وSEED_ADMIN_TOTP_SECRET.
 */

const KARRADA = { lat: 33.306, lng: 44.426 };
const CUSTOMER_PASSWORD = 'Customer#123';
const HOUR_MS = 3_600_000;

function randomIraqiPhone(): string {
  return `+96477${String(randomInt(0, 99999999)).padStart(8, '0')}`;
}

function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

describe('idempotency guarantees', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let db: DbClient;

  const customerPhone = randomIraqiPhone();
  let customerAccess = '';
  let customerId = '';
  let vendorProfileId = '';
  let productId = '';

  function orderPayload() {
    return {
      vendorId: vendorProfileId,
      items: [{ productId, quantity: 2 }],
      delivery: {
        location: { lat: 33.309, lng: 44.429 },
        addressText: 'قرب ساحة اختبار الذرية',
        contactPhone: customerPhone,
      },
    };
  }

  async function countCustomerOrders(): Promise<number> {
    const rows = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.customerId, customerId));
    return rows.length;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    http = app.getHttpServer();
    db = app.get(DB);

    const adminAccess = await loginAdmin(http);

    const vendorPhone = randomIraqiPhone();
    const vendorReg = await request(http)
      .post('/api/v1/auth/register')
      .send({
        role: 'vendor',
        phone: vendorPhone,
        password: 'Vendor#1234',
        fullName: 'خباز الذرية',
        storeNameAr: 'مخبز اختبار الذرية',
        category: 'bakery',
        location: KARRADA,
        addressText: 'الكرادة — شارع الذرية',
      })
      .expect(201);
    const vendorAccess = vendorReg.body.tokens.accessToken;

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

    await request(http)
      .patch('/api/v1/vendor/profile/open')
      .set('Authorization', `Bearer ${vendorAccess}`)
      .send({ isOpen: true })
      .expect(200);
    const prod = await request(http)
      .post('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${vendorAccess}`)
      .send({ nameAr: 'صمون الذرية', priceIqd: 500, section: 'خبز' })
      .expect(201);
    productId = prod.body.id;

    const customerReg = await request(http)
      .post('/api/v1/auth/register')
      .send({
        role: 'customer',
        phone: customerPhone,
        password: CUSTOMER_PASSWORD,
        fullName: 'زبون الذرية',
      })
      .expect(201);
    customerAccess = customerReg.body.tokens.accessToken;
    customerId = customerReg.body.user.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('atomicity: concurrent identical requests execute the write exactly once', async () => {
    const key = randomUUID();
    const payload = orderPayload();
    const before = await countCustomerOrders();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(http)
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${customerAccess}`)
          .set('x-idempotency-key', key)
          .send(payload),
      ),
    );

    const created = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(created.length + conflicts.length).toBe(responses.length);
    for (const c of conflicts) {
      expect(c.body.code).toBe('IDEMPOTENCY_IN_FLIGHT');
    }
    // كل الاستجابات الناجحة لنفس الطلب الواحد
    expect(new Set(created.map((r) => r.body.id)).size).toBe(1);
    expect(await countCustomerOrders()).toBe(before + 1);
  });

  it('error release: a failed execution frees the key so a retry can succeed', async () => {
    const key = randomUUID();
    // جسم يفشل في zod (items فارغة) — يصل بعد الادعاء فيُفك عند الرفض
    await request(http)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('x-idempotency-key', key)
      .send({ ...orderPayload(), items: [] })
      .expect(400);

    // نفس المفتاح بجسم صالح ينفَّذ فعلاً — لا تسميم دائم بمفتاح فاشل
    await request(http)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('x-idempotency-key', key)
      .send(orderPayload())
      .expect(201);
  });

  it('stale claim takeover: an abandoned pending claim does not block forever', async () => {
    const key = randomUUID();
    const payload = orderPayload();
    // ادعاء متروك (بلا استجابة) أقدم من نافذة الاستيلاء — كما لو انهارت العملية
    await db.insert(idempotencyKeys).values({
      key,
      userId: customerId,
      method: 'POST',
      path: '/api/v1/orders',
      requestHash: bodyHash(payload),
      createdAt: new Date(Date.now() - 6 * 60_000),
    });

    await request(http)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('x-idempotency-key', key)
      .send(payload)
      .expect(201);
  });

  it('security: auth responses (tokens) are never stored under idempotency keys', async () => {
    const key = randomUUID();
    await request(http)
      .post('/api/v1/auth/login')
      .set('x-idempotency-key', key)
      .send({ phone: customerPhone, password: CUSTOMER_PASSWORD })
      .expect(200);

    const stored = await db
      .select({ key: idempotencyKeys.key })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key));
    expect(stored).toHaveLength(0);

    // المسار مستثنى كلياً: نفس المفتاح بجسم مختلف لا يعلق ولا يعيد استجابة مخزنة
    await request(http)
      .post('/api/v1/auth/login')
      .set('x-idempotency-key', key)
      .send({ phone: customerPhone, password: 'wrong-password-!!' })
      .expect(401);
  });

  it('retention: purge removes keys older than the retention window only', async () => {
    const oldKey = randomUUID();
    const freshKey = randomUUID();
    await db.insert(idempotencyKeys).values([
      {
        key: oldKey,
        method: 'POST',
        path: '/purge-test',
        requestHash: 'h',
        responseStatus: 201,
        responseBody: '{}',
        createdAt: new Date(Date.now() - 25 * HOUR_MS),
      },
      { key: freshKey, method: 'POST', path: '/purge-test', requestHash: 'h' },
    ]);

    await app.get(IdempotencyPurgeService).purgeExpired();

    const oldRows = await db
      .select({ key: idempotencyKeys.key })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, oldKey));
    const freshRows = await db
      .select({ key: idempotencyKeys.key })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, freshKey));
    expect(oldRows).toHaveLength(0);
    expect(freshRows).toHaveLength(1);

    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, freshKey));
  });
});
