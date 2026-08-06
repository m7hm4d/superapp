import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB, DbClient } from '../src/db/drizzle.module';
import { adminCredentials, adminPasskeys, authEvents, users } from '../src/db/schema';
import { totp } from '../src/modules/auth/totp';
import { createCredential, signAuthentication } from './helpers/soft-authenticator';

/**
 * مفاتيح المرور للإدارة: مراسم WebAuthn حقيقية عبر مصادِق برمجي (ES256)،
 * فما يُختبر هو التوقيع والتحدي وربط النطاق فعلاً لا محاكاة ردود.
 */

const PASSWORD = 'Passkey#Test1234';
const RP_ID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
const ORIGIN = (process.env.WEBAUTHN_ORIGINS ?? 'http://localhost:3001').split(',')[0] as string;

describe('admin passkeys', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let db: DbClient;

  async function createAdmin(opts: { totpSecret?: string } = {}) {
    const email = `pk-${randomInt(100000, 999999)}@superapp.local`;
    const [created] = await db
      .insert(users)
      .values({
        phone: `+96477${String(randomInt(0, 99999999)).padStart(8, '0')}`,
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        fullName: 'أدمن مفاتيح المرور',
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

  /** يسجّل مفتاحاً جديداً للحساب ويعيده */
  async function enrollPasskey(access: string, label = 'آيفون الاختبار') {
    const options = await request(http)
      .post('/api/v1/auth/admin/passkey/register/options')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    const { credential, response } = createCredential({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });
    const saved = await request(http)
      .post('/api/v1/auth/admin/passkey/register/verify')
      .set('Authorization', `Bearer ${access}`)
      .send({ response, label })
      .expect(200);
    return { credential, saved: saved.body, options: options.body };
  }

  async function loginWithPasskey(credential: Parameters<typeof signAuthentication>[0]) {
    const options = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .expect(200);
    const assertion = signAuthentication(credential, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });
    return request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: assertion });
  }

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

  it('a fresh admin can enroll a passkey instead of TOTP and then log in with it', async () => {
    const admin = await createAdmin();

    // بلا عامل ثانٍ: الدخول يعطي توكن تسجيل محدوداً لا جلسة
    const first = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    expect(first.body.status).toBe('totp_enrollment_required');
    const enrollmentToken = first.body.enrollmentToken as string;

    // توكن التسجيل يفتح تسجيل مفتاح المرور (بديلاً عن TOTP)
    const { credential } = await enrollPasskey(enrollmentToken, 'آيفون 15');

    // ثم الدخول بالمفتاح وحده يصدر جلسة إدارية كاملة
    const login = await loginWithPasskey(credential);
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(admin.id);
    const access = login.body.tokens.accessToken as string;
    await request(http)
      .get('/api/v1/admin/finance/summary')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);

    // ولا يُطالَب بعدها بتسجيل TOTP — يُوجَّه إلى مفتاحه
    const again = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(401);
    expect(again.body.code).toBe('USE_PASSKEY');
  });

  it('a challenge is single-use, and a replayed assertion is rejected', async () => {
    const admin = await createAdmin();
    const first = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    const { credential } = await enrollPasskey(first.body.enrollmentToken);

    const options = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .expect(200);
    const assertion = signAuthentication(credential, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });

    const ok = await request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: assertion })
      .expect(200);
    expect(ok.body.tokens.accessToken).toBeTruthy();

    // إعادة إرسال التوقيع نفسه: التحدي استُهلك فلا يُقبل
    const replay = await request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: assertion })
      .expect(401);
    expect(replay.body.code).toBe('PASSKEY_CHALLENGE_EXPIRED');
  });

  it('rejects a signature made for another origin or another challenge', async () => {
    const admin = await createAdmin();
    const first = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    const { credential } = await enrollPasskey(first.body.enrollmentToken);

    // أصل مختلف — جوهر مقاومة التصيّد
    const options = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .expect(200);
    const phishing = signAuthentication(credential, {
      rpId: RP_ID,
      origin: 'https://evil.example',
      challenge: options.body.challenge,
    });
    const rejected = await request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: phishing })
      .expect(401);
    expect(rejected.body.code).toBe('PASSKEY_INVALID');

    // تحدٍّ لم يصدره الخادم
    const forged = signAuthentication(credential, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: Buffer.from('not-a-real-challenge').toString('base64url'),
    });
    await request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: forged })
      .expect(401);
  });

  it('an unknown credential never yields a session', async () => {
    const options = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .expect(200);
    const { credential } = createCredential({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });
    const assertion = signAuthentication(credential, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });
    const res = await request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: assertion })
      .expect(401);
    expect(res.body.code).toBe('PASSKEY_UNKNOWN');
    expect(res.body.tokens).toBeUndefined();
  });

  it('lists and removes keys, but refuses to remove the last factor', async () => {
    const admin = await createAdmin();
    const first = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    const { credential } = await enrollPasskey(first.body.enrollmentToken, 'المفتاح الأول');
    const session = await loginWithPasskey(credential);
    const access = session.body.tokens.accessToken as string;

    const list = await request(http)
      .get('/api/v1/auth/admin/passkeys')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].label).toBe('المفتاح الأول');
    expect(list.body[0].lastUsedAt).toBeTruthy();
    // لا يُسرَّب المفتاح العام ولا معرّف الاعتماد في القائمة
    expect(Object.keys(list.body[0]).sort()).toEqual(
      ['createdAt', 'id', 'label', 'lastUsedAt'].sort(),
    );

    // حذف المفتاح الوحيد بلا TOTP = قفل الحساب على صاحبه
    const refused = await request(http)
      .delete(`/api/v1/auth/admin/passkeys/${list.body[0].id}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(403);
    expect(refused.body.code).toBe('LAST_FACTOR');

    // مع مفتاح ثانٍ يصير الحذف مسموحاً
    await enrollPasskey(access, 'المفتاح الثاني');
    await request(http)
      .delete(`/api/v1/auth/admin/passkeys/${list.body[0].id}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    const after = await request(http)
      .get('/api/v1/auth/admin/passkeys')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(after.body).toHaveLength(1);
    expect(after.body[0].label).toBe('المفتاح الثاني');
  });

  it('TOTP keeps working alongside a passkey, and logins are recorded', async () => {
    const secret = totp.generateSecret();
    const admin = await createAdmin({ totpSecret: secret });

    // مسار TOTP كما كان
    const viaTotp = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email, password: PASSWORD, totp: totp.generate(secret) })
      .expect(200);
    expect(viaTotp.body.status).toBe('ok');

    // ثم يضيف مفتاح مرور من جلسته
    const { credential } = await enrollPasskey(viaTotp.body.tokens.accessToken, 'ماك');
    const viaPasskey = await loginWithPasskey(credential);
    expect(viaPasskey.status).toBe(200);

    const rows = await db.select().from(authEvents).where(eq(authEvents.userId, admin.id));
    expect(rows.some((r) => r.method === 'admin_password_totp' && r.outcome === 'success')).toBe(
      true,
    );
    expect(rows.some((r) => r.method === 'admin_passkey' && r.outcome === 'success')).toBe(true);
    expect(rows.some((r) => r.method === 'admin_passkey' && r.outcome === 'enrollment_completed')).toBe(
      true,
    );

    // الجلسة الناتجة عن المفتاح مربوطة بحدثها فتظهر في شاشة الجلسات
    const success = rows.find((r) => r.method === 'admin_passkey' && r.outcome === 'success');
    expect(success?.sessionFamilyId).toBeTruthy();

    const stored = await db.select().from(adminPasskeys).where(eq(adminPasskeys.userId, admin.id));
    expect(stored).toHaveLength(1);
    expect(stored[0].counter).toBeGreaterThan(0);
  });
});
