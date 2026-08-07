import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DB, DbClient } from '../src/db/drizzle.module';
import { adminCredentials, users } from '../src/db/schema';
import { totp } from '../src/modules/auth/totp';

const PASSWORD = 'Scope#Test12345';

/**
 * انحدار ثغرة تجاوز العامل الثاني.
 *
 * توكن الخطوة الثانية يُصدَر بمعرفة كلمة المرور وحدها. وحارس JWT كان يكتفي
 * بوجود `scope` أياً كانت قيمته، فكان هذا التوكن يفتح مسارات التسجيل
 * المخصّصة لنطاق آخر. النتيجة: من يعرف كلمة المرور يسجّل عاملاً ثانياً
 * **لنفسه** ثم يدخل — فيسقط العامل الثاني بالكامل.
 *
 * الاتجاه المفحوص هنا هو العكسي تحديداً: `admin_step_up` نحو مسارات التسجيل.
 */
describe('token scopes are enforced by value, not by presence', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let db: DbClient;

  async function createAdmin(opts: { totpSecret?: string } = {}) {
    const email = `scope-${randomInt(100000, 999999)}@superapp.local`;
    const [created] = await db
      .insert(users)
      .values({
        phone: `+96477${String(randomInt(0, 99999999)).padStart(8, '0')}`,
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        fullName: 'أدمن فحص النطاقات',
        role: 'admin',
      })
      .returning({ id: users.id });
    await db.insert(adminCredentials).values({
      userId: created.id,
      email,
      totpSecret: opts.totpSecret ?? null,
      totpEnabled: Boolean(opts.totpSecret),
    });
    return { id: created.id, email };
  }

  const login = (body: Record<string, unknown>) =>
    request(http).post('/api/v1/auth/admin/login').send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    http = app.getHttpServer();
    db = app.get(DB);
  });

  afterAll(async () => {
    await app?.close();
  });

  /**
   * الهجوم كاملاً: كلمة المرور → توكن خطوة ثانية → تسجيل TOTP جديد →
   * جلسة إدارية. كل خطوة بعد الأولى يجب أن تُرفض.
   */
  it('a step-up token cannot enroll a new TOTP device', async () => {
    const admin = await createAdmin({ totpSecret: totp.generateSecret() });
    const challenge = await login({ email: admin.email, password: PASSWORD }).expect(200);
    const stepUp = challenge.body.stepUpToken as string;
    expect(stepUp).toBeTruthy();

    const setup = await request(http)
      .post('/api/v1/auth/admin/totp/setup')
      .set('Authorization', `Bearer ${stepUp}`)
      .expect(401);
    expect(setup.body.code).toBe('TOKEN_SCOPE_FORBIDDEN');
    expect(setup.body.secret).toBeUndefined();

    const enable = await request(http)
      .post('/api/v1/auth/admin/totp/enable')
      .set('Authorization', `Bearer ${stepUp}`)
      .send({ totp: '123456' })
      .expect(401);
    expect(enable.body.code).toBe('TOKEN_SCOPE_FORBIDDEN');
    expect(enable.body.tokens).toBeUndefined();
  });

  /** والطريق الآخر إلى الجلسة نفسها: تسجيل مفتاح مرور جديد */
  it('a step-up token cannot register a new passkey', async () => {
    const admin = await createAdmin({ totpSecret: totp.generateSecret() });
    const challenge = await login({ email: admin.email, password: PASSWORD }).expect(200);
    const stepUp = challenge.body.stepUpToken as string;

    for (const path of ['passkey/register/options', 'passkey/register/verify']) {
      const res = await request(http)
        .post(`/api/v1/auth/admin/${path}`)
        .set('Authorization', `Bearer ${stepUp}`)
        .send({ response: {}, label: 'مفتاح المهاجم' })
        .expect(401);
      expect(res.body.code).toBe('TOKEN_SCOPE_FORBIDDEN');
    }
  });

  /** ولا يفتح أي مسار إداري عادي — الجلسة الكاملة وحدها تفعل */
  it('a step-up token is not a session', async () => {
    const admin = await createAdmin({ totpSecret: totp.generateSecret() });
    const challenge = await login({ email: admin.email, password: PASSWORD }).expect(200);
    const res = await request(http)
      .get('/api/v1/admin/finance/summary')
      .set('Authorization', `Bearer ${challenge.body.stepUpToken}`)
      .expect(401);
    expect(res.body.code).toBe('TOKEN_SCOPE_FORBIDDEN');
  });

  /**
   * الاتجاه المسموح يبقى يعمل: توكن التسجيل لمسارات التسجيل. لولا هذا
   * الفحص لأمكن «إصلاح» الثغرة بمنع كل نطاق ثم كسر تسجيل أول أدمن.
   */
  it('an enrollment token still opens exactly the enrollment routes', async () => {
    const admin = await createAdmin();
    const first = await login({ email: admin.email, password: PASSWORD }).expect(200);
    expect(first.body.status).toBe('totp_enrollment_required');
    const enrollment = first.body.enrollmentToken as string;

    const setup = await request(http)
      .post('/api/v1/auth/admin/totp/setup')
      .set('Authorization', `Bearer ${enrollment}`)
      .expect(201);
    expect(setup.body.secret).toBeTruthy();

    // وهو نفسه لا يفتح مساراً إدارياً
    const blocked = await request(http)
      .get('/api/v1/admin/finance/summary')
      .set('Authorization', `Bearer ${enrollment}`)
      .expect(401);
    expect(blocked.body.code).toBe('TOKEN_SCOPE_FORBIDDEN');
  });
});
