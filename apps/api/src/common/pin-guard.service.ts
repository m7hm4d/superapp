import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB, DbClient } from '../db/drizzle.module';
import { pinAttempts } from '../db/schema';

/** نوع الهدف الذي يحمي رمزه */
export type PinTarget = 'batch_pickup' | 'order_delivery' | 'settlement';

/**
 * عدد الإخفاقات المسموح بها قبل أول قفل. ثلاث محاولات تكفي لخطأ مطبعي
 * أو رمز أُملي خطأً؛ ما بعدها ليس خطأً.
 */
const FREE_ATTEMPTS = 3;

/**
 * القفل يتصاعد: 30 ثانية، دقيقتان، ثمان، اثنتان وثلاثون… بحدّ أقصى ساعة.
 *
 * التصاعد هو ما يقتل التخمين: الوصول إلى 10,000 احتمال يصير سنوات بدل
 * ساعة، بينما يبقى الخطأ العرضي كلفته ثوانٍ.
 */
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 60 * 60_000;

function lockDuration(failedCount: number): number {
  // ‏FREE_ATTEMPTS محاولة **مسموحة** بلا قفل، والقفل يبدأ بما بعدها.
  // بلا الطرح الإضافي كان القفل يقع عند المحاولة الثالثة لا الرابعة —
  // خطأ بمقدار واحد يخالف ما يوثّقه الثابت، ويعاقب خطأً مطبعياً ثالثاً.
  const over = failedCount - FREE_ATTEMPTS - 1;
  if (over < 0) return 0;
  return Math.min(BASE_LOCK_MS * 4 ** over, MAX_LOCK_MS);
}

/**
 * حارس رموز PIN.
 *
 * الحدّ على **الهدف** لا على الـIP ولا على المستخدم: رمز تسليم طلب بعينه
 * لا يُخمَّن مهما تغيّر العنوان أو الجهاز أو الحساب. الحدّ على العنوان
 * وحده كان يسقط أمام أبسط توزيع.
 *
 * وكل إخفاق يُسجَّل: بلا أثر لا يوجد كشف، وقد كان المسار صامتاً تماماً.
 */
@Injectable()
export class PinGuardService {
  private readonly logger = new Logger(PinGuardService.name);

  constructor(@Inject(DB) private readonly db: DbClient) {}

  /**
   * يتحقق من الرمز مع حماية التخمين.
   *
   * يُستدعى **قبل** أي كتابة: القفل يجب أن يمنع المحاولة لا أن يُسجَّل
   * بعد نجاحها.
   *
   * ملاحظة جوهرية: يكتب على `this.db` لا على معاملة المُستدعي — عمداً.
   * ‏confirmPickup وconfirm للتسوية يستدعيانه **داخل** معاملة، ورمي الاستثناء
   * يُلغيها. لو كُتب العدّاد داخلها لتراجع معها، فلا يُحتسب إخفاق قط: حماية
   * قائمة في الشيفرة لا تعدّ شيئاً في الواقع. من يمرّر `tx` إلى هنا «تنظيفاً»
   * يُلغي الحماية كلها بصمت — واختبار «العدّاد ينجو من تراجع المعاملة» يمسكه.
   */
  async verify(opts: {
    targetType: PinTarget;
    targetId: string;
    expected: string;
    provided: string;
    actorUserId?: string;
  }): Promise<void> {
    const { targetType, targetId, expected, provided, actorUserId } = opts;

    const [row] = await this.db
      .select()
      .from(pinAttempts)
      .where(and(eq(pinAttempts.targetType, targetType), eq(pinAttempts.targetId, targetId)))
      .limit(1);

    const now = new Date();
    if (row?.lockedUntil && row.lockedUntil > now) {
      const retryAfterSec = Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000);
      this.logger.warn(
        `pin locked: ${targetType}/${targetId} actor=${actorUserId ?? '?'} retryAfter=${retryAfterSec}s`,
      );
      throw new ForbiddenException({ code: 'PIN_LOCKED', retryAfterSec });
    }

    // المقارنة بعد فحص القفل — رمز صحيح أثناء القفل لا يمرّ أيضاً، وإلا
    // صار القفل بلا أثر على من يخمّن حتى يصيب.
    if (provided === expected) {
      if (row) await this.reset(targetType, targetId);
      return;
    }

    const failed = (row?.failedCount ?? 0) + 1;
    const lockMs = lockDuration(failed);
    const lockedUntil = lockMs > 0 ? new Date(now.getTime() + lockMs) : null;

    await this.db
      .insert(pinAttempts)
      .values({
        targetType,
        targetId,
        failedCount: failed,
        lockedUntil,
        lastFailedAt: now,
        lastActorUserId: actorUserId ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [pinAttempts.targetType, pinAttempts.targetId],
        set: {
          // الزيادة في SQL لا في الشيفرة: محاولتان متزامنتان تُحتسبان
          // كلتاهما بدل أن تكتب إحداهما فوق الأخرى.
          failedCount: sql`${pinAttempts.failedCount} + 1`,
          lockedUntil,
          lastFailedAt: now,
          lastActorUserId: actorUserId ?? null,
          updatedAt: now,
        },
      });

    this.logger.warn(
      `pin failed: ${targetType}/${targetId} actor=${actorUserId ?? '?'} attempt=${failed}`,
    );
    throw new ForbiddenException({
      code: 'WRONG_PIN',
      ...(lockedUntil ? { lockedUntil: lockedUntil.toISOString() } : {}),
    });
  }

  /** ينظّف عدّاد هدف نجح رمزه — لا داعي لإبقاء سجل بعد إتمام العملية */
  private async reset(targetType: PinTarget, targetId: string): Promise<void> {
    await this.db
      .delete(pinAttempts)
      .where(and(eq(pinAttempts.targetType, targetType), eq(pinAttempts.targetId, targetId)));
  }
}
