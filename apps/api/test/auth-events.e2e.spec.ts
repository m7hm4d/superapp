import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB, DbClient } from '../src/db/drizzle.module';
import { authEvents } from '../src/db/schema';
import { loginAdmin } from './helpers/admin-login';

/**
 * سجل عمليات الدخول والجلسات (A-07): كل محاولة تُقيَّد بنتيجتها ومصدرها،
 * والجلسة النشطة تُشتق من سلالة refresh ويمكن قطعها من اللوحة.
 */

const CUSTOMER_PASSWORD = 'Customer#123';

function randomIraqiPhone(): string {
  return `+96477${String(randomInt(0, 99999999)).padStart(8, '0')}`;
}

describe('auth events and sessions', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let db: DbClient;
  let adminAccess = '';

  const customerPhone = randomIraqiPhone();
  let customerId = '';

  async function eventsFor(userId: string) {
    return db.select().from(authEvents).where(eq(authEvents.userId, userId));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    http = app.getHttpServer();
    db = app.get(DB);
    adminAccess = await loginAdmin(http);

    const reg = await request(http)
      .post('/api/v1/auth/register')
      .send({
        role: 'customer',
        phone: customerPhone,
        password: CUSTOMER_PASSWORD,
        fullName: 'زبون السجل',
      })
      .expect(201);
    customerId = reg.body.user.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('records a successful login with device, ip and the session it created', async () => {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .set('User-Agent', 'SuperAppTest/1.0 (Android)')
      .send({ phone: customerPhone, password: CUSTOMER_PASSWORD })
      .expect(200);

    const rows = await eventsFor(customerId);
    const success = rows.find((r) => r.outcome === 'success');
    expect(success).toBeTruthy();
    expect(success?.method).toBe('phone_password');
    expect(success?.sessionFamilyId).toBeTruthy();
    expect(success?.ip).toBeTruthy();
    expect(success?.userAgent).toContain('SuperAppTest');
    expect(res.body.tokens.accessToken).toBeTruthy();
  });

  it('records failures without storing what was typed as the identifier', async () => {
    await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: customerPhone, password: 'definitely-wrong' })
      .expect(401);

    const rows = await eventsFor(customerId);
    expect(rows.some((r) => r.outcome === 'invalid_credentials')).toBe(true);

    // رقم غير مسجّل: يُقيَّد الحدث بلا ربط بمستخدم وبلا تخزين المُدخَل
    const before = await db
      .select()
      .from(authEvents)
      .where(eq(authEvents.outcome, 'unknown_identifier'));
    await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: randomIraqiPhone(), password: 'whatever' })
      .expect(401);
    const after = await db
      .select()
      .from(authEvents)
      .where(eq(authEvents.outcome, 'unknown_identifier'));
    expect(after.length).toBe(before.length + 1);
    const latest = after[after.length - 1];
    expect(latest.userId).toBeNull();
    expect(Object.values(latest)).not.toContain('whatever');
  });

  it('records the admin path separately, including the TOTP-less attempt', async () => {
    const { email, password } = await import('./helpers/admin-login').then((m) =>
      m.adminCredentialsFromEnv(),
    );
    await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email, password })
      .expect(401);

    const rows = await db
      .select()
      .from(authEvents)
      .where(
        and(eq(authEvents.method, 'admin_password_totp'), eq(authEvents.outcome, 'totp_required')),
      );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('admin can list events and filter them by outcome', async () => {
    const all = await request(http)
      .get('/api/v1/admin/auth-events?limit=20&offset=0')
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    expect(all.body.items.length).toBeGreaterThan(0);
    expect(all.body.total).toBeGreaterThan(0);
    expect(all.body.items[0]).toHaveProperty('outcome');

    const failures = await request(http)
      .get('/api/v1/admin/auth-events?outcome=invalid_credentials&limit=20&offset=0')
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    expect(failures.body.items.length).toBeGreaterThan(0);
    expect(
      failures.body.items.every((r: { outcome: string }) => r.outcome === 'invalid_credentials'),
    ).toBe(true);

    const summary = await request(http)
      .get('/api/v1/admin/auth-events/summary')
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    expect(summary.body.successCount).toBeGreaterThan(0);
    expect(summary.body.activeSessions).toBeGreaterThan(0);
  });

  it('sessions list shows the live session, and revoking it kills the refresh family', async () => {
    const login = await request(http)
      .post('/api/v1/auth/login')
      .set('User-Agent', 'SuperAppTest/2.0 (iPhone)')
      .send({ phone: customerPhone, password: CUSTOMER_PASSWORD })
      .expect(200);
    const refreshToken = login.body.tokens.refreshToken;

    const sessions = await request(http)
      .get(`/api/v1/admin/sessions?userId=${customerId}&limit=50&offset=0`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    const mine = sessions.body.items.find((s: { userAgent: string | null }) =>
      s.userAgent?.includes('SuperAppTest/2.0'),
    );
    expect(mine).toBeTruthy();
    expect(mine.fullName).toBe('زبون السجل');
    expect(mine.ip).toBeTruthy();

    // التجديد يعمل قبل القطع
    await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    await request(http)
      .post(`/api/v1/admin/sessions/${mine.familyId}/revoke`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({})
      .expect(200);

    // بعد القطع لا تجديد — الجلسة ماتت فعلاً لا شكلاً
    await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    const after = await request(http)
      .get(`/api/v1/admin/sessions?userId=${customerId}&limit=50&offset=0`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    expect(
      after.body.items.some((s: { familyId: string }) => s.familyId === mine.familyId),
    ).toBe(false);

    const revokedEvent = await db
      .select()
      .from(authEvents)
      .where(
        and(
          eq(authEvents.outcome, 'session_revoked'),
          eq(authEvents.sessionFamilyId, mine.familyId),
        ),
      );
    expect(revokedEvent.length).toBe(1);
  });

  it('logout is recorded and rbac keeps the log admin-only', async () => {
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: customerPhone, password: CUSTOMER_PASSWORD })
      .expect(200);

    await request(http)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({ refreshToken: login.body.tokens.refreshToken })
      .expect(200);

    const rows = await eventsFor(customerId);
    expect(rows.some((r) => r.outcome === 'logout')).toBe(true);

    // الزبون لا يرى سجل الدخول ولا الجلسات
    const customerLogin = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: customerPhone, password: CUSTOMER_PASSWORD })
      .expect(200);
    for (const path of ['admin/auth-events', 'admin/sessions']) {
      await request(http)
        .get(`/api/v1/${path}`)
        .set('Authorization', `Bearer ${customerLogin.body.tokens.accessToken}`)
        .expect(403);
    }
  });
});
