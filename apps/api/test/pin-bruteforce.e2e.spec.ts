import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB, DbClient } from '../src/db/drizzle.module';
import { PinGuardService } from '../src/common/pin-guard.service';
import { pinAttempts } from '../src/db/schema';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

/**
 * انحدار: تخمين رموز PIN.
 *
 * الرمز أربعة أرقام = 10,000 احتمال. قبل هذا الحارس كان الحدّ العام
 * (120 طلباً/دقيقة/IP) الحماية الوحيدة، أي أن تخمين رمز تسليم يستغرق نحو
 * 84 دقيقة من عنوان واحد وأقلّ بعناوين متعددة — ثم يُسجَّل طلب غير مسلَّم
 * كمسلَّم فتتحرك قيود الدفتر. ولم يكن يُسجَّل أي إخفاق، فلا أثر يكشف ذلك.
 */
describe('PIN brute-force protection', () => {
  let app: INestApplication;
  let db: DbClient;
  let guard: PinGuardService;

  const target = () => ({ targetType: 'order_delivery' as const, targetId: randomUUID() });

  const attempt = (t: ReturnType<typeof target>, provided: string) =>
    guard.verify({ ...t, expected: '1234', provided });

  const codeOf = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
      return 'OK';
    } catch (e) {
      const code = (e as { response?: { code?: string } }).response?.code;
      // بلا هذا كان خطأ قاعدة بيانات يعود 'UNKNOWN' بصمت فيظهر العطل
      // كصفٍّ مفقود لا كسببه — أضاع وقتاً في تشخيص قيدٍ أجنبي.
      if (!code) throw e;
      return code;
    }
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DB);
    guard = app.get(PinGuardService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('يقبل الرمز الصحيح بلا أثر متبقٍّ', async () => {
    const t = target();
    expect(await codeOf(attempt(t, '1234'))).toBe('OK');
    const rows = await db
      .select()
      .from(pinAttempts)
      .where(and(eq(pinAttempts.targetType, t.targetType), eq(pinAttempts.targetId, t.targetId)));
    expect(rows).toHaveLength(0);
  });

  it('يقفل بعد ثلاث محاولات خاطئة', async () => {
    const t = target();
    expect(await codeOf(attempt(t, '0000'))).toBe('WRONG_PIN');
    expect(await codeOf(attempt(t, '0001'))).toBe('WRONG_PIN');
    expect(await codeOf(attempt(t, '0002'))).toBe('WRONG_PIN');
    // الرابعة تتجاوز الحدّ المجاني فتُقفل
    expect(await codeOf(attempt(t, '0003'))).toBe('WRONG_PIN');
    expect(await codeOf(attempt(t, '0004'))).toBe('PIN_LOCKED');
  });

  /**
   * جوهر الإصلاح: **الرمز الصحيح لا يمرّ أثناء القفل**.
   * لو مرّ لصار القفل بلا أثر على من يخمّن حتى يصيب.
   */
  it('لا يقبل حتى الرمز الصحيح ما دام مقفلاً', async () => {
    const t = target();
    for (let i = 0; i < 4; i++) await codeOf(attempt(t, '0000'));
    expect(await codeOf(attempt(t, '1234'))).toBe('PIN_LOCKED');
  });

  /** الحدّ على الهدف لا على المستخدم: تغيير الحساب لا يعيد العدّاد */
  it('تغيير المُحاوِل لا يتجاوز القفل', async () => {
    const t = target();
    for (let i = 0; i < 4; i++) {
      await codeOf(guard.verify({ ...t, expected: '1234', provided: '0000', actorUserId: undefined }));
    }
    const other = await codeOf(
      guard.verify({ ...t, expected: '1234', provided: '0001', actorUserId: randomUUID() }),
    );
    expect(other).toBe('PIN_LOCKED');
  });

  it('كل هدف يُحسب على حدة — قفل طلب لا يقفل غيره', async () => {
    const a = target();
    const b = target();
    for (let i = 0; i < 4; i++) await codeOf(attempt(a, '0000'));
    expect(await codeOf(attempt(a, '0000'))).toBe('PIN_LOCKED');
    expect(await codeOf(attempt(b, '1234'))).toBe('OK');
  });

  it('يسجّل كل إخفاق — بلا أثر لا يوجد كشف', async () => {
    const t = target();
    const actor = randomUUID();
    await codeOf(guard.verify({ ...t, expected: '1234', provided: '0000', actorUserId: actor }));
    await codeOf(guard.verify({ ...t, expected: '1234', provided: '0001', actorUserId: actor }));

    const [row] = await db
      .select()
      .from(pinAttempts)
      .where(and(eq(pinAttempts.targetType, t.targetType), eq(pinAttempts.targetId, t.targetId)));
    expect(row.failedCount).toBe(2);
    expect(row.lastActorUserId).toBe(actor);
    expect(row.lastFailedAt).toBeTruthy();
  });

  /**
   * انحدار: كان على العمود مفتاح أجنبي إلى users، فإخفاق منسوب إلى حساب
   * محذوف يُسقط الإدراج كلّه — فلا يُحتسب ولا يُقفل الهدف أبداً. رمز وصول
   * ما زال صالحاً بعد حذف صاحبه كان يكفي لتخمين بلا حدّ.
   */
  it('إخفاق منسوب إلى حساب محذوف يُحتسب ويقفل', async () => {
    const t = target();
    const ghost = randomUUID();
    for (let i = 0; i < 4; i++) {
      expect(await codeOf(guard.verify({ ...t, expected: '1234', provided: '000' + i, actorUserId: ghost }))).toBe(
        'WRONG_PIN',
      );
    }
    expect(await codeOf(guard.verify({ ...t, expected: '1234', provided: '0009', actorUserId: ghost }))).toBe(
      'PIN_LOCKED',
    );

    const [row] = await db
      .select()
      .from(pinAttempts)
      .where(and(eq(pinAttempts.targetType, t.targetType), eq(pinAttempts.targetId, t.targetId)));
    expect(row.failedCount).toBe(4);
    expect(row.lastActorUserId).toBe(ghost);
  });

  /**
   * ‏confirmPickup وconfirm للتسوية يستدعيان الحارس **داخل** معاملة، ورمي
   * WRONG_PIN يُلغيها. لو كتب الحارس عدّاده داخل تلك المعاملة لتراجع معها
   * فلا يُحتسب إخفاق أبداً — الحماية تبدو قائمة وهي لا تعدّ شيئاً.
   */
  it('العدّاد ينجو من تراجع المعاملة المحيطة', async () => {
    const t = target();
    const canary = target(); // شاهد: يُكتب **داخل** المعاملة فيجب أن يختفي معها
    for (let i = 0; i < 3; i++) {
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(pinAttempts).values({ ...canary, failedCount: 99 }).onConflictDoNothing();
          await guard.verify({ ...t, expected: '1234', provided: '0000' });
        }),
      ).rejects.toThrow();
    }

    const [row] = await db
      .select()
      .from(pinAttempts)
      .where(and(eq(pinAttempts.targetType, t.targetType), eq(pinAttempts.targetId, t.targetId)));
    expect(row?.failedCount).toBe(3);

    // اختفاء الشاهد يثبت أن التراجع وقع فعلاً — ولولا الاتصال المنفصل
    // لاختفى العدّاد معه.
    const canaryRows = await db
      .select()
      .from(pinAttempts)
      .where(and(eq(pinAttempts.targetType, canary.targetType), eq(pinAttempts.targetId, canary.targetId)));
    expect(canaryRows).toHaveLength(0);
  });

  /**
   * انحدار: السباق. القراءة والمقارنة والزيادة وقرار القفل كانت غير
   * متسلسلة، فالمحاولات المتزامنة تقرأ العدّاد نفسه وتكتب `lockedUntil`
   * محسوباً من قيمة قديمة. القياس قبل الإصلاح: **٢٠ هدفاً من ٢٠ بلا قفل**
   * رغم بلوغ العدّاد أربعة. أهداف كثيرة لا هدف واحد: سباق يظهر مرة من كل
   * عشرين لا يمسكه اختبار على هدف واحد.
   */
  it('أربع محاولات متزامنة تقفل كل هدف', async () => {
    const targets = Array.from({ length: 20 }, () => target());
    await Promise.all(
      targets.map((t) => Promise.all([0, 1, 2, 3].map((i) => codeOf(attempt(t, `000${i}`))))),
    );

    const now = new Date();
    for (const t of targets) {
      const [row] = await db
        .select()
        .from(pinAttempts)
        .where(and(eq(pinAttempts.targetType, t.targetType), eq(pinAttempts.targetId, t.targetId)));
      expect(row?.failedCount).toBe(4);
      expect(row?.lockedUntil?.getTime() ?? 0).toBeGreaterThan(now.getTime());
    }
  });

  /** التزامن لا يفتح ثغرة في القفل: الرمز الصحيح يبقى مرفوضاً */
  it('الرمز الصحيح لا يمرّ بالتزامن ما دام الهدف مقفلاً', async () => {
    const t = target();
    for (let i = 0; i < 4; i++) await codeOf(attempt(t, `000${i}`));

    const codes = await Promise.all([
      codeOf(attempt(t, '1234')),
      codeOf(attempt(t, '1234')),
      codeOf(attempt(t, '9999')),
      codeOf(attempt(t, '1234')),
    ]);
    expect(codes).toEqual(['PIN_LOCKED', 'PIN_LOCKED', 'PIN_LOCKED', 'PIN_LOCKED']);
  });

  /**
   * انحدار: جمود المسبح. الحارس يُستدعى داخل معاملات المُستدعي، فمشاركته
   * المسبح تعني أن المعاملات الخارجية تحتجز كل الاتصالات وينتظر كلٌّ منها
   * اتصالاً لن يتحرّر — توقّف الخدمة كلها لا هذه الطلبات وحدها. اثنتا عشرة
   * معاملة متزامنة كافية (‏max الافتراضي في pg عشرة).
   */
  it('تداخل الحارس داخل معاملات لا يجمّد المسبح', async () => {
    const nested = Promise.all(
      Array.from({ length: 12 }, () =>
        db
          .transaction(async () => {
            await guard.verify({ ...target(), expected: '1234', provided: '0000' });
          })
          .catch(() => undefined),
      ),
    ).then(() => 'completed' as const);

    const outcome = await Promise.race([
      nested,
      new Promise<'frozen'>((r) => setTimeout(() => r('frozen'), 15_000)),
    ]);
    expect(outcome).toBe('completed');
  }, 30_000);

  /**
   * القفل يتصاعد أُسّياً، فالوصول إلى 10,000 احتمال يصير سنوات بدل ساعة.
   * الحساب هنا لا التجربة: الانتظار الفعلي غير عملي — وهذا هو المقصود.
   */
  it('التصاعد يجعل استنفاد المساحة غير عملي', async () => {
    const t = target();
    for (let i = 0; i < 4; i++) await codeOf(attempt(t, '0000'));
    const [row] = await db
      .select()
      .from(pinAttempts)
      .where(and(eq(pinAttempts.targetType, t.targetType), eq(pinAttempts.targetId, t.targetId)));

    const lockMs = row.lockedUntil!.getTime() - Date.now();
    expect(lockMs).toBeGreaterThan(25_000); // 30 ثانية للمحاولة الرابعة

    // بعد الحدّ المجاني، كل محاولة تكلّف قفلاً يتضاعف أربع مرات حتى ساعة.
    // عشرة آلاف محاولة بمتوسط قفل يقترب من الساعة = أكثر من سنة.
    const worstCaseHours = (10_000 - 3) * 1; // ساعة لكل محاولة بعد التشبّع
    expect(worstCaseHours / 24).toBeGreaterThan(365);
  });
});
