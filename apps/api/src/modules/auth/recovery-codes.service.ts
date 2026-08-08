import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { DB, DbClient } from '../../db/drizzle.module';
import { adminRecoveryCodes } from '../../db/schema';
import { ARGON2_OPTIONS } from './auth.service';

/** عشرة تكفي لسنوات من فقد الأجهزة، ولا تُثقل من يطبعها ويحفظها */
const CODE_COUNT = 10;

/**
 * أبجدية بلا أحرف متشابهة: من ينسخ رمزاً عن ورقة لا يميّز 0 من O ولا 1 من l،
 * وخطأ نسخ هنا يعني حساباً لا يُستعاد.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * أربع مجموعات من خمسة: قابل للقراءة والنسخ يدوياً.
 *
 * ‏`randomInt` لا `randomBytes(n) % length`. الثانية موحَّدة التوزيع اليوم
 * بمحض المصادفة — 256 = 32 × 8 — فلو أُضيف حرف إلى الأبجدية أو حُذف منها
 * لصارت الرموز منحازة بصمت، ولا شيء في الشيفرة يُنبّه. وهذه الأبجدية
 * مُرشَّحة للتعديل: تعليقها نفسه يدعو إلى تنقيتها من الأحرف المتشابهة.
 *
 * و`randomInt` غير منحازة مهما كان حجم الأبجدية — ترفض العيّنات الزائدة
 * وتعيد السحب.
 */
function generateCode(): string {
  const chars = Array.from({ length: 20 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-');
}

/** التطبيع يقبل ما يكتبه الإنسان: شرطات وفراغات وحروف صغيرة */
function normalise(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * رموز استرداد الإدارة.
 *
 * هاتف ضائع كان يعني تعديلاً يدوياً في قاعدة البيانات — ولا مسار في المنتج
 * يستعيد وصول مسؤول فقد جهازه. وتلك هي النافذة التي تُدفع الفرق فيها إلى
 * تعطيل العامل الثاني كلّه، فيصير الحساب بكلمة مرور وحدها.
 *
 * تُخزَّن مجزّأة بـargon2id كما كلمات المرور: من قرأ قاعدة البيانات لا يجد
 * مفاتيح دخول جاهزة. وبطء التجزئة مقصود — هو ما يجعل تخمين الرمز غير عملي.
 */
@Injectable()
export class RecoveryCodesService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  /**
   * يولّد مجموعة جديدة ويُبطل ما سبقها.
   *
   * الإبطال قبل الإنشاء: مجموعتان صالحتان معاً تعنيان أن ورقة قديمة ضاعت
   * تبقى مفتاحاً. والقيم تُعاد **مرة واحدة** — لا تُخزَّن نصّاً فلا سبيل
   * إلى عرضها ثانيةً، وهذا هو المقصود.
   */
  async regenerate(userId: string): Promise<string[]> {
    const codes = Array.from({ length: CODE_COUNT }, generateCode);
    const hashes = await Promise.all(
      codes.map((code) => hash(normalise(code), ARGON2_OPTIONS)),
    );

    await this.db.transaction(async (tx) => {
      await tx.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.userId, userId));
      await tx
        .insert(adminRecoveryCodes)
        .values(hashes.map((codeHash) => ({ userId, codeHash })));
    });

    return codes;
  }

  /**
   * يستهلك رمزاً صالحاً — ويعيد false إن لم يكن أيٌّ منها مطابقاً.
   *
   * المقارنة على كل الرموز غير المستعملة: التجزئة تمنع البحث بالفهرس، فلا
   * سبيل إلا المرور عليها. وعشرة رموز تعني عشر مقارنات في أسوأ حال —
   * والحدّ الأعلى للعدد هو ما يبقي هذا مقبولاً.
   *
   * والختم شرطي (`usedAt IS NULL`): محاولتان متزامنتان بالرمز نفسه لا
   * تنجحان معاً.
   */
  async consume(userId: string, provided: string): Promise<boolean> {
    const candidate = normalise(provided);
    const rows = await this.db
      .select({ id: adminRecoveryCodes.id, codeHash: adminRecoveryCodes.codeHash })
      .from(adminRecoveryCodes)
      .where(and(eq(adminRecoveryCodes.userId, userId), isNull(adminRecoveryCodes.usedAt)));

    for (const row of rows) {
      // تجزئة تالفة تُتخطّى ولا تُسقط المسار كلّه: رمز واحد معطوب لا يمنع
      // صاحبه من استعمال التسعة الباقية.
      const matches = await verify(row.codeHash, candidate).catch(() => false);
      if (!matches) continue;

      const consumed = await this.db
        .update(adminRecoveryCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(adminRecoveryCodes.id, row.id), isNull(adminRecoveryCodes.usedAt)))
        .returning({ id: adminRecoveryCodes.id });
      return consumed.length > 0;
    }
    return false;
  }

  /** كم بقي — تعرضه اللوحة كي يعرف المسؤول متى يولّد مجموعة جديدة */
  async remaining(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: adminRecoveryCodes.id })
      .from(adminRecoveryCodes)
      .where(and(eq(adminRecoveryCodes.userId, userId), isNull(adminRecoveryCodes.usedAt)));
    return rows.length;
  }
}
