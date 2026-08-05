import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB, DbClient } from '../src/db/drizzle.module';
import { adminCredentials, users } from '../src/db/schema';
import { totp } from '../src/modules/auth/totp';
import { loginAdmin } from './helpers/admin-login';

/**
 * TOTP إلزامي للإدارة (الملف §3): لا جلسة إدارية بعامل واحد، الرمز المستهلَك
 * لا يُعاد استعماله، وانحراف ±30 ثانية مقبول.
 *
 * كل اختبار يعمل على حساب أدمن خاص به: حماية إعادة الاستخدام تصاعدية
 * (أي رمز أقدم من آخر رمز مستهلَك يُرفض)، فمشاركة حساب واحد بين الاختبارات
 * — أو مع ملفات أخرى تعمل بالتوازي — تجعل النتائج معتمدة على الترتيب.
 */

const ADMIN_PASSWORD = 'Totp#Test1234';

async function createAdmin(
  db: DbClient,
  opts: { secret?: string } = {},
): Promise<{ email: string; userId: string; secret?: string }> {
  const email = `totp-${randomInt(100000, 999999)}@superapp.local`;
  const [created] = await db
    .insert(users)
    .values({
      phone: `+96477${String(randomInt(0, 99999999)).padStart(8, '0')}`,
      passwordHash: await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id }),
      fullName: 'أدمن اختبار TOTP',
      role: 'admin',
    })
    .returning({ id: users.id });
  await db.insert(adminCredentials).values({
    userId: created.id,
    email,
    totpSecret: opts.secret ?? null,
    totpEnabled: Boolean(opts.secret),
  });
  return { email, userId: created.id, secret: opts.secret };
}

describe('admin TOTP is mandatory', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let db: DbClient;

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

  it('password alone is not enough, and a wrong code is rejected', async () => {
    const admin = await createAdmin(db, { secret: totp.generateSecret() });

    const noCode = await login({ email: admin.email, password: ADMIN_PASSWORD }).expect(401);
    expect(noCode.body.code).toBe('TOTP_REQUIRED');
    expect(noCode.body.tokens).toBeUndefined();

    const wrong = await login({
      email: admin.email,
      password: ADMIN_PASSWORD,
      totp: '000000',
    }).expect(401);
    expect(wrong.body.code).toBe('TOTP_INVALID');

    const ok = await login({
      email: admin.email,
      password: ADMIN_PASSWORD,
      totp: totp.generate(admin.secret as string),
    }).expect(200);
    expect(ok.body.status).toBe('ok');
    expect(ok.body.tokens.accessToken).toBeTruthy();
  });

  it('replay: the same code cannot be used twice', async () => {
    const admin = await createAdmin(db, { secret: totp.generateSecret() });
    const code = totp.generate(admin.secret as string);

    const first = await login({ email: admin.email, password: ADMIN_PASSWORD, totp: code });
    expect(first.status).toBe(200);

    const replay = await login({ email: admin.email, password: ADMIN_PASSWORD, totp: code }).expect(
      401,
    );
    expect(replay.body.code).toBe('TOTP_ALREADY_USED');
  });

  it('clock skew: a code from the previous 30s window is accepted', async () => {
    const admin = await createAdmin(db, { secret: totp.generateSecret() });
    // رمز الخطوة السابقة — يرفضه window=0 ويقبله window=1
    const previous = totp
      .clone({ epoch: Date.now() - 30_000 })
      .generate(admin.secret as string);

    const res = await login({ email: admin.email, password: ADMIN_PASSWORD, totp: previous });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('enrollment: no session until a device is registered', async () => {
    const admin = await createAdmin(db); // بلا سر — كما ينشئه الـseed
    const first = await login({ email: admin.email, password: ADMIN_PASSWORD }).expect(200);
    expect(first.body.status).toBe('totp_enrollment_required');
    expect(first.body.tokens).toBeUndefined();
    const enrollmentToken = first.body.enrollmentToken as string;
    expect(enrollmentToken).toBeTruthy();

    // التوكن المحدود لا يفتح أي مسار إداري
    const blocked = await request(http)
      .get('/api/v1/admin/finance/summary')
      .set('Authorization', `Bearer ${enrollmentToken}`)
      .expect(401);
    expect(blocked.body.code).toBe('TOTP_ENROLLMENT_REQUIRED');

    // لكنه يفتح الإعداد ويعيد سراً ورابط otpauth الذي يصير باركود في اللوحة
    const setup = await request(http)
      .post('/api/v1/auth/admin/totp/setup')
      .set('Authorization', `Bearer ${enrollmentToken}`)
      .expect(201);
    expect(setup.body.secret).toBeTruthy();
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.otpauthUrl).toContain('SuperApp%20Admin');
    expect(setup.body.otpauthUrl).toContain(encodeURIComponent(admin.email));

    // السر المعلّق لا يفعّل شيئاً قبل التأكيد
    const stillEnrolling = await login({ email: admin.email, password: ADMIN_PASSWORD }).expect(200);
    expect(stillEnrolling.body.status).toBe('totp_enrollment_required');

    // تأكيد أول رمز ⇒ جلسة كاملة فوراً
    const enable = await request(http)
      .post('/api/v1/auth/admin/totp/enable')
      .set('Authorization', `Bearer ${enrollmentToken}`)
      .send({ totp: totp.generate(setup.body.secret) })
      .expect(200);
    expect(enable.body.status).toBe('ok');
    await request(http)
      .get('/api/v1/admin/finance/summary')
      .set('Authorization', `Bearer ${enable.body.tokens.accessToken}`)
      .expect(200);

    // وبعدها الرمز مطلوب دائماً
    await login({ email: admin.email, password: ADMIN_PASSWORD })
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('TOTP_REQUIRED'));
  });

  it('re-enrollment keeps the working device until the new one is confirmed', async () => {
    const secret = totp.generateSecret();
    const admin = await createAdmin(db, { secret });
    const session = await login({
      email: admin.email,
      password: ADMIN_PASSWORD,
      totp: totp.generate(secret),
    }).expect(200);

    const setup = await request(http)
      .post('/api/v1/auth/admin/totp/setup')
      .set('Authorization', `Bearer ${session.body.tokens.accessToken}`)
      .expect(201);

    // السر الفعّال لم يتغيّر — الجهاز القديم ما زال هو المعتمد
    const [cred] = await db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.userId, admin.userId));
    expect(cred.totpSecret).toBe(secret);
    expect(cred.pendingTotpSecret).toBe(setup.body.secret);
    expect(cred.totpEnabled).toBe(true);

    // الترقية تحدث فقط بتأكيد رمز من الجهاز الجديد
    await request(http)
      .post('/api/v1/auth/admin/totp/enable')
      .set('Authorization', `Bearer ${session.body.tokens.accessToken}`)
      .send({ totp: totp.generate(setup.body.secret) })
      .expect(200);
    const [after] = await db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.userId, admin.userId));
    expect(after.totpSecret).toBe(setup.body.secret);
    expect(after.pendingTotpSecret).toBeNull();
  });

  it('brute force: the auth throttle actually rejects beyond the configured limit', async () => {
    // التجاوز يُطابَق باسم المحدِّد؛ اسم غير مطابق يجعله يُهمَل بصمت —
    // فنتحقق من الرفض فعلياً لا من وجود المزخرِف.
    const limit = Number(process.env.AUTH_THROTTLE_LIMIT ?? 5);
    const unknownEmail = `nobody-${randomInt(100000, 999999)}@superapp.local`;
    let throttled = 0;
    for (let i = 0; i < limit + 2; i++) {
      const res = await login({ email: unknownEmail, password: 'not-a-real-password' });
      if (res.status === 429) throttled++;
      else expect(res.status).toBe(401);
    }
    expect(throttled).toBeGreaterThan(0);
  });

  it('the seeded admin (used by the rest of the suite) requires TOTP too', async () => {
    const access = await loginAdmin(http);
    await request(http)
      .get('/api/v1/admin/finance/summary')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);

    const { email, password } = await import('./helpers/admin-login').then((m) =>
      m.adminCredentialsFromEnv(),
    );
    await login({ email, password })
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('TOTP_REQUIRED'));
  });
});
