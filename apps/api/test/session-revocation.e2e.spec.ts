import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@superapp/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB, DbClient } from '../src/db/drizzle.module';
import { users } from '../src/db/schema';

/**
 * انحدار: الخروج الذي لا يُنهي الوصول.
 *
 * إبطال عائلة التجديد كان يقتل `auth/refresh` ويقطع الـsocket، ولا يمسّ REST:
 * الحارس يتحقق من التوقيع ثم يثق بما في الرمز. فبعد الخروج — أو إبطال الجلسة
 * من اللوحة، أو حظر الحساب، أو خفض دوره — يبقى رمز الوصول يفتح المسارات
 * المحمية حتى ينتهي، ومدته الافتراضية **خمس عشرة دقيقة**.
 *
 * قِيس على بيئة التجربة الحيّة قبل الإصلاح: بعد `auth/logout` عاد
 * `auth/refresh` بـ401 بينما فتح `auth/me` بـ200.
 */
describe('REST session revocation is immediate', () => {
  let app: INestApplication;
  let http: Parameters<typeof request>[0];
  let db: DbClient;

  const phone = () => `+96477${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  /** يسجّل حساباً جديداً ويعيد رموزه ومعرّفه */
  const newSession = async () => {
    const number = phone();
    const res = await request(http)
      .post('/api/v1/auth/register')
      .send({ phone: number, password: 'Passw0rd#2026', fullName: 'اختبار', role: Role.CUSTOMER })
      .expect(201);
    return {
      phone: number,
      userId: res.body.user.id as string,
      access: res.body.tokens.accessToken as string,
      refresh: res.body.tokens.refreshToken as string,
    };
  };

  const meStatus = (access: string) =>
    request(http)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${access}`)
      .then((r) => r.status);

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

  it('رمز الوصول يعمل ما دامت الجلسة حيّة', async () => {
    const s = await newSession();
    expect(await meStatus(s.access)).toBe(200);
  });

  it('الخروج يُبطل رمز الوصول فوراً لا بعد انتهائه', async () => {
    const s = await newSession();
    expect(await meStatus(s.access)).toBe(200);

    await request(http)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${s.access}`)
      .send({ refreshToken: s.refresh })
      .expect(200);

    expect(await meStatus(s.access)).toBe(401);
  });

  it('حظر الحساب يمنع رمزه الحالي فوراً', async () => {
    const s = await newSession();
    expect(await meStatus(s.access)).toBe(200);

    await db.update(users).set({ status: UserStatus.BLOCKED }).where(eq(users.id, s.userId));

    expect(await meStatus(s.access)).toBe(401);
  });

  /**
   * `RolesGuard` يقرأ ما يضعه حارس المصادقة. أخذُ الدور من الرمز كان يعني
   * أن خفض الصلاحيات بلا أثر حتى ينتهي — ورمز أدمن سابق يبقى أدمن.
   */
  it('الدور يُقرأ من القاعدة لا من الرمز', async () => {
    const s = await newSession();
    // مسار إداري: زبون يُرفض بـ403 لا 401 — أي أن المصادقة مرّت والدور رُفض
    expect(
      (
        await request(http)
          .get('/api/v1/admin/auth-events')
          .set('Authorization', `Bearer ${s.access}`)
      ).status,
    ).toBe(403);

    await db.update(users).set({ role: Role.ADMIN }).where(eq(users.id, s.userId));

    // الرمز نفسه لم يتغيّر، ودوره فيه ما زال customer — لكن القاعدة تقول admin
    expect(
      (
        await request(http)
          .get('/api/v1/admin/auth-events')
          .set('Authorization', `Bearer ${s.access}`)
      ).status,
    ).toBe(200);
  });

  it('إبطال جلسة جهاز لا يمسّ أجهزة الحساب الأخرى', async () => {
    const a = await newSession();
    // جهاز ثانٍ لنفس الحساب: دخول جديد ينشئ عائلة مستقلة
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: a.phone, password: 'Passw0rd#2026' })
      .expect(200);
    const b = { access: login.body.tokens.accessToken as string, refresh: login.body.tokens.refreshToken as string };

    await request(http)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${a.access}`)
      .send({ refreshToken: a.refresh })
      .expect(200);

    expect(await meStatus(a.access)).toBe(401);
    expect(await meStatus(b.access)).toBe(200);
  });

  /**
   * كشف إعادة الاستخدام يُبطل العائلة كلها — ويجب أن يسقط معها رمز الوصول
   * المرتبط بها، وإلا بقي للمهاجم نافذة عمل بعد أن كُشف.
   */
  it('إعادة استعمال رمز تجديد ملغى تُسقط رمز الوصول معها', async () => {
    const s = await newSession();
    const rotated = await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s.refresh })
      .expect(200);
    const fresh = rotated.body.tokens.accessToken as string;
    expect(await meStatus(fresh)).toBe(200);

    // الرمز القديم استُهلك — إعادة استعماله كشفٌ يُبطل العائلة
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: s.refresh }).expect(401);

    expect(await meStatus(fresh)).toBe(401);
  });

  /** السقف قبل التحقق التشفيري لا بعده — بلا سقف يدخل نصّ مهما طال */
  it('رمز تجديد مفرط الطول يُرفض قبل أي عمل تشفيري', async () => {
    const res = await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'a'.repeat(5000) });
    expect(res.status).toBe(400);
  });

  /**
   * كان `login` و`register` يحملان حدّاً مخصصاً و`refresh` لا يحمله، فصار
   * مضخّة عمل تشفيري مجانية: كل طلب فكُّ توقيع واستعلام قاعدة.
   */
  it('مسار التحديث يحمل حدّ محاولات ويردّ 429', async () => {
    const s = await newSession();
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: `${s.refresh}x${i}` });
      codes.push(r.status);
      if (r.status === 429) break;
    }
    expect(codes).toContain(429);
  }, 30_000);

  /** رسالة واحدة لكل الحالات: التمييز يخبر المهاجم أي شرط سقط */
  it('كل حالات الإبطال تردّ SESSION_REVOKED', async () => {
    const s = await newSession();
    await request(http)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${s.access}`)
      .send({ refreshToken: s.refresh })
      .expect(200);

    const res = await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${s.access}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_REVOKED');
  });
});
