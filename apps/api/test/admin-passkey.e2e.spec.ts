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
const ORIGIN = (process.env.WEBAUTHN_ORIGINS ?? 'http://localhost:3001').split(',')[0];

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

  /**
   * الخطوة الأولى: بريد وكلمة مرور فقط. تعيد توكن العامل الثاني — وهو ما
   * يثبت أن كلمة المرور تحققت، ولا يفتح شيئاً سواه.
   */
  async function stepUp(email: string) {
    const res = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body as {
      status: string;
      stepUpToken: string;
      methods: string[];
    };
  }

  async function loginWithPasskey(
    credential: Parameters<typeof signAuthentication>[0],
    stepUpToken: string,
  ) {
    const options = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .send({ stepUpToken })
      .expect(200);
    const assertion = signAuthentication(credential, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });
    return request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: assertion, stepUpToken });
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

  it('a fresh admin enrolls a passkey, then uses it as the second factor', async () => {
    const admin = await createAdmin();

    // بلا عامل ثانٍ: الدخول يعطي توكن تسجيل محدوداً لا جلسة
    const first = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    expect(first.body.status).toBe('totp_enrollment_required');

    const { credential } = await enrollPasskey(first.body.enrollmentToken as string, 'آيفون 15');

    // بعد التسجيل: كلمة المرور تعطي خيار عامل ثانٍ لا جلسة
    const challenge = await stepUp(admin.email);
    expect(challenge.status).toBe('second_factor_required');
    expect(challenge.methods).toEqual(['passkey']);
    expect(challenge.stepUpToken).toBeTruthy();
    expect(challenge).not.toHaveProperty('tokens');

    const login = await loginWithPasskey(credential, challenge.stepUpToken);
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(admin.id);
    await request(http)
      .get('/api/v1/admin/finance/summary')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .expect(200);
  });

  /**
   * جوهر التغيير: المفتاح عامل **ثانٍ**. بلا توكن يثبت أن كلمة المرور تحققت،
   * لا يفتح المفتاح شيئاً — فسرقة جهاز مفتوح بمفتاح متزامن لا تكفي.
   */
  it('a passkey alone opens nothing without the password step', async () => {
    const admin = await createAdmin();
    const first = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    const { credential } = await enrollPasskey(first.body.enrollmentToken as string);

    // بلا توكن أصلاً
    await request(http).post('/api/v1/auth/admin/passkey/login/options').send({}).expect(400);

    // وبتوكن مختلق
    const forged = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .send({ stepUpToken: 'not-a-real-token' })
      .expect(401);
    expect(forged.body.code).toBe('STEP_UP_INVALID');

    // وبتوكن تسجيل (نطاق آخر) — لا يصلح لإتمام دخول
    const wrongScope = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .send({ stepUpToken: first.body.enrollmentToken })
      .expect(401);
    expect(wrongScope.body.code).toBe('STEP_UP_INVALID');

    // ومع توكن صحيح يعمل — إثبات أن الرفض سببه غياب الخطوة لا خلل في المفتاح
    const challenge = await stepUp(admin.email);
    const ok = await loginWithPasskey(credential, challenge.stepUpToken);
    expect(ok.status).toBe(200);
  });

  /** مفتاح حساب آخر لا يُتمّ دخول هذا الحساب ولو كانت كلمة مروره صحيحة */
  it('refuses a passkey that belongs to a different admin', async () => {
    const victim = await createAdmin();
    const attacker = await createAdmin();

    const vFirst = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: victim.email, password: PASSWORD })
      .expect(200);
    await enrollPasskey(vFirst.body.enrollmentToken as string);

    const aFirst = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: attacker.email, password: PASSWORD })
      .expect(200);
    const { credential: attackerKey } = await enrollPasskey(aFirst.body.enrollmentToken as string);

    // كلمة مرور الضحية معروفة في الاختبار، لكن المفتاح ليس مفتاحها
    const victimChallenge = await stepUp(victim.email);
    const options = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .send({ stepUpToken: victimChallenge.stepUpToken })
      .expect(200);

    // الخيارات مقصورة على مفاتيح الضحية — مفتاح المهاجم ليس فيها
    const allowed = (options.body.allowCredentials ?? []) as { id: string }[];
    expect(allowed.some((c) => c.id === attackerKey.credentialId)).toBe(false);

    const assertion = signAuthentication(attackerKey, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });
    const res = await request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: assertion, stepUpToken: victimChallenge.stepUpToken });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('PASSKEY_MISMATCH');
  });

  it('a challenge is single-use, and a replayed assertion is rejected', async () => {
    const admin = await createAdmin();
    const first = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    const { credential } = await enrollPasskey(first.body.enrollmentToken);
    const challenge = await stepUp(admin.email);

    const options = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .send({ stepUpToken: challenge.stepUpToken })
      .expect(200);
    const assertion = signAuthentication(credential, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });

    const ok = await request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: assertion, stepUpToken: challenge.stepUpToken })
      .expect(200);
    expect(ok.body.tokens.accessToken).toBeTruthy();

    // إعادة إرسال التوقيع نفسه: التحدي استُهلك فلا يُقبل
    const replay = await request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: assertion, stepUpToken: challenge.stepUpToken })
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
    const challenge = await stepUp(admin.email);

    // أصل مختلف — جوهر مقاومة التصيّد. كلمة المرور صحيحة والتوكن صحيح،
    // ومع ذلك يُرفض التوقيع لأنه صدر لنطاق آخر.
    const options = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .send({ stepUpToken: challenge.stepUpToken })
      .expect(200);
    const phishing = signAuthentication(credential, {
      rpId: RP_ID,
      origin: 'https://evil.example',
      challenge: options.body.challenge,
    });
    const rejected = await request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: phishing, stepUpToken: challenge.stepUpToken })
      .expect(401);
    expect(rejected.body.code).toBe('PASSKEY_INVALID');

    // تحدٍّ لم يصدره الخادم
    const second = await stepUp(admin.email);
    const forged = signAuthentication(credential, {
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: Buffer.from('not-a-real-challenge').toString('base64url'),
    });
    await request(http)
      .post('/api/v1/auth/admin/passkey/login/verify')
      .send({ response: forged, stepUpToken: second.stepUpToken })
      .expect(401);
  });

  it('an unknown credential never yields a session', async () => {
    const admin = await createAdmin();
    const first = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    await enrollPasskey(first.body.enrollmentToken);
    const challenge = await stepUp(admin.email);

    const options = await request(http)
      .post('/api/v1/auth/admin/passkey/login/options')
      .send({ stepUpToken: challenge.stepUpToken })
      .expect(200);
    // مفتاح لم يُسجَّل قط، بكلمة مرور صحيحة وتوكن صالح
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
      .send({ response: assertion, stepUpToken: challenge.stepUpToken })
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
    const challenge = await stepUp(admin.email);
    const session = await loginWithPasskey(credential, challenge.stepUpToken);
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

    // ثم يضيف مفتاح مرور من جلسته — فيصير للحساب عاملان يختار بينهما
    const { credential } = await enrollPasskey(viaTotp.body.tokens.accessToken, 'ماك');

    const challenge = await stepUp(admin.email);
    expect(challenge.methods.sort()).toEqual(['passkey', 'totp']);

    const viaPasskey = await loginWithPasskey(credential, challenge.stepUpToken);
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
