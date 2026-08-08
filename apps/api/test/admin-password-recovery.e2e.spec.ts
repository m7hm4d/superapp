import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB, DbClient } from '../src/db/drizzle.module';
import { adminCredentials, users } from '../src/db/schema';
import { adminCredentialsFromEnv } from './helpers/admin-login';
import { totp } from '../src/modules/auth/totp';

/**
 * فجوتان كانتا تُغلقان بالخادم لا بالمنتج:
 *
 * - **لا مسار لتغيير كلمة مرور الإدارة.** كل تدوير يمرّ بـSSH وسطر أوامر،
 *   فتبقى الكلمة في تاريخ الصدفة. وقع هذا فعلاً في هذا المشروع.
 * - **لا استرداد لـTOTP.** هاتف ضائع يعني تعديلاً يدوياً في قاعدة البيانات —
 *   وهي النافذة التي تُدفع الفرق فيها إلى تعطيل العامل الثاني كلّه.
 */
describe('admin password change and TOTP recovery', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let db: DbClient;

  const { email, password: ORIGINAL, secret } = adminCredentialsFromEnv();
  let adminId = '';
  let access = '';

  /** يعيد الحساب إلى حالته الأصلية كي لا تتأثر بقية الحزمة */
  const restore = async () => {
    await db
      .update(users)
      .set({ passwordHash: originalHash })
      .where(eq(users.id, adminId));
  };
  let originalHash = '';

  /**
   * رمز TOTP صالح الآن بلا انتظار.
   *
   * الرمز لا يُقبل مرتين، فالانتظار الطبيعي بين استهلاكين ثلاثون ثانية —
   * وهذا الملف يستهلك عشرة، أي خمس دقائق من السكون في كل تشغيل CI.
   * فيُصفَّر عدّاد الاستهلاك في القاعدة بدل تغيير `TOTP_STEP_SEC`: تلك
   * ثابتة بروتوكول تستعملها تطبيقات المصادقة كلها، وتعديلها لأجل الاختبار
   * يُفسد المنتج ليريح الحزمة.
   *
   * ومنع إعادة الاستعمال نفسه مُختبَر في `admin-totp.e2e` — لا يُفقد هنا شيء.
   */
  /** جلسة أدمن بلا انتظار خطوة — تستعمل `totpNow` */
  const adminSession = async (): Promise<string> => {
    const res = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email, password: ORIGINAL, totp: await totpNow() })
      .expect(200);
    return res.body.tokens.accessToken as string;
  };

  const totpNow = async (): Promise<string> => {
    await db.update(adminCredentials).set({ lastTotpStep: null }).where(eq(adminCredentials.userId, adminId));
    return totp.generate(secret);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    http = app.getHttpServer();
    db = app.get(DB);

    const [cred] = await db
      .select({ userId: adminCredentials.userId })
      .from(adminCredentials)
      .where(eq(adminCredentials.email, email))
      .limit(1);
    adminId = cred.userId;
    const [row] = await db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, adminId))
      .limit(1);
    originalHash = row.hash;

    access = await adminSession();
  });

  afterAll(async () => {
    await restore();
    await app?.close();
  });

  const NEW_PASSWORD = 'Changed#Password2026';

  it('تغيير كلمة المرور يرفض بلا عامل ثانٍ', async () => {
    const res = await request(http)
      .post('/api/v1/auth/admin/password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: ORIGINAL, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SECOND_FACTOR_REQUIRED');
  });

  it('ويرفض بكلمة حالية خاطئة رغم صحة العامل الثاني', async () => {
    const res = await request(http)
      .post('/api/v1/auth/admin/password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: 'wrong-one', newPassword: NEW_PASSWORD, totp: await totpNow() });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  /**
   * مسار كامل في اختبار واحد: كل استهلاك لـTOTP يحتاج خطوة زمنية جديدة
   * (ثلاثون ثانية)، فتقسيمُه على اختبارات يجعل الحزمة تنتظر بلا فائدة.
   */
  it('التغيير: يرفض المطابقة، ثم ينجح فيُبطل الجلسات ويقبل الجديدة', async () => {
    const fresh = await adminSession();

    // كلمة جديدة مطابقة للقديمة تعني تدويراً لم يقع
    const same = await request(http)
      .post('/api/v1/auth/admin/password')
      .set('Authorization', `Bearer ${fresh}`)
      .send({ currentPassword: ORIGINAL, newPassword: ORIGINAL, totp: await totpNow() });
    expect(same.status).toBe(400);
    expect(same.body.code).toBe('PASSWORD_UNCHANGED');

    await request(http)
      .post('/api/v1/auth/admin/password')
      .set('Authorization', `Bearer ${fresh}`)
      .send({ currentPassword: ORIGINAL, newPassword: NEW_PASSWORD, totp: await totpNow() })
      .expect(200);

    // الجلسة التي أجرت التغيير سقطت معها — الشكّ في التسريب يشمل كل جهاز
    expect(
      (await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${fresh}`)).status,
    ).toBe(401);

    // القديمة لم تعد تُقبل
    const old = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email, password: ORIGINAL, totp: await totpNow() });
    expect(old.status).toBe(401);

    // والجديدة تُقبل
    const ok = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email, password: NEW_PASSWORD, totp: await totpNow() });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('ok');

    await restore();
  });

  // ─────────────────────────── رموز الاسترداد ───────────────────────────

  it('التوليد يشترط كلمة المرور ورمز TOTP', async () => {
    const bad = await request(http)
      .post('/api/v1/auth/admin/recovery-codes')
      .set('Authorization', `Bearer ${access}`)
      .send({ password: 'wrong', totp: await totpNow() });
    expect(bad.status).toBe(401);
  });

  /** دورة حياة الرمز كاملة برمز TOTP واحد */
  it('عشرة رموز، استعمال واحد لكلٍّ، ويُقبل كما يكتبه الإنسان', async () => {
    const token = await adminSession();
    const gen = await request(http)
      .post('/api/v1/auth/admin/recovery-codes')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: ORIGINAL, totp: await totpNow() })
      .expect(200);
    const codes = gen.body.codes as string[];
    expect(codes).toHaveLength(10);

    expect(
      (
        await request(http)
          .get('/api/v1/auth/admin/recovery-codes')
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body.remaining,
    ).toBe(10);

    // يُدخل بلا TOTP — وهذا كل المقصود: الهاتف ضائع
    const first = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email, password: ORIGINAL, recoveryCode: codes[3] });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('ok');

    // استعمال واحد: الثاني يُرفض
    const second = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email, password: ORIGINAL, recoveryCode: codes[3] });
    expect(second.status).toBe(401);
    expect(second.body.code).toBe('RECOVERY_CODE_INVALID');

    // بلا شرطات وبحروف صغيرة — كما يُنسخ عن ورقة
    const messy = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email, password: ORIGINAL, recoveryCode: codes[7].replace(/-/g, '').toLowerCase() });
    expect(messy.status).toBe(200);

    // ثمانية باقية بعد استهلاك اثنين
    const after = await request(http)
      .get('/api/v1/auth/admin/recovery-codes')
      .set('Authorization', `Bearer ${first.body.tokens.accessToken}`)
      .expect(200);
    expect(after.body.remaining).toBe(8);
  });

  /**
   * توزيع الحروف موحّد.
   *
   * كان التوليد `randomBytes(n) % ALPHABET.length` — موحّداً بمحض المصادفة
   * (‏256 = 32 × 8). حرف واحد يُضاف إلى الأبجدية أو يُحذف منها كان يجعل
   * الرموز منحازة بصمت، وأبجديةٌ تعليقها يدعو إلى تنقيتها مُرشَّحة لذلك.
   *
   * والانحياز يقلّص فضاء التخمين فعلياً — لا يبطله لكنه يضيّقه بلا أن
   * يلاحظ أحد.
   */
  it('حروف الرموز موزّعة بلا انحياز', async () => {
    const token = await adminSession();
    const seen = new Map<string, number>();
    // مئة رمز = ألفا حرف: كافية لكشف انحياز بنيوي لا لتقلّب عشوائي
    for (let round = 0; round < 10; round++) {
      const res = await request(http)
        .post('/api/v1/auth/admin/recovery-codes')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: ORIGINAL, totp: await totpNow() })
        .expect(200);
      for (const code of res.body.codes as string[]) {
        for (const ch of code.replace(/-/g, '')) seen.set(ch, (seen.get(ch) ?? 0) + 1);
      }
    }

    const counts = [...seen.values()];
    const total = counts.reduce((a, b) => a + b, 0);
    const expected = total / 32;
    expect(seen.size).toBe(32); // كل حرف ظهر ولو مرة
    // لا حرف يبتعد عن المتوقَّع أكثر من النصف — عتبة واسعة تمسك الانحياز
    // البنيوي (`% 33` مثلاً يعطي حرفاً واحداً نصفَ نصيب البقية) ولا ترتجف
    // من تقلّب عشوائي طبيعي.
    for (const [ch, n] of seen) {
      expect(Math.abs(n - expected) / expected, `الحرف ${ch}`).toBeLessThan(0.5);
    }
  }, 60_000);

  /** مجموعة جديدة تُبطل ما سبقها: ورقة ضاعت لا تبقى مفتاحاً */
  it('التوليد يُبطل المجموعة السابقة', async () => {
    const token = await adminSession();
    const before = await request(http)
      .post('/api/v1/auth/admin/recovery-codes')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: ORIGINAL, totp: await totpNow() })
      .expect(200);
    const stale = (before.body.codes as string[])[0];

    await request(http)
      .post('/api/v1/auth/admin/recovery-codes')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: ORIGINAL, totp: await totpNow() })
      .expect(200);

    const res = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email, password: ORIGINAL, recoveryCode: stale });
    expect(res.status).toBe(401);
  });
});
