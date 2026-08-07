import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DbClient, PIN_GUARD_DB } from '../db/drizzle.module';
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

/**
 * حدّ انتظار القفل الاستشاري: طلب مرفوض أهون من طلب معلّق إلى الأبد.
 *
 * ثابت في الشيفرة لا مُدخَل — و`SET LOCAL` لا يقبل معاملاً مربوطاً أصلاً
 * (‏`SET LOCAL lock_timeout = $1` خطأ صياغة يرميه الخادم)، فيُبنى نصّاً.
 */
const LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '5s'";

function lockDuration(failedCount: number): number {
  // ‏FREE_ATTEMPTS محاولة **مسموحة** بلا قفل، والقفل يبدأ بما بعدها.
  // بلا الطرح الإضافي كان القفل يقع عند المحاولة الثالثة لا الرابعة —
  // خطأ بمقدار واحد يخالف ما يوثّقه الثابت، ويعاقب خطأً مطبعياً ثالثاً.
  const over = failedCount - FREE_ATTEMPTS - 1;
  if (over < 0) return 0;
  return Math.min(BASE_LOCK_MS * 4 ** over, MAX_LOCK_MS);
}

/** النتيجة تُحسب داخل المعاملة ويُرمى عليها بعد الالتزام */
type Verdict =
  | { kind: 'ok' }
  | { kind: 'locked'; retryAfterSec: number }
  | { kind: 'wrong'; attempt: number; lockedUntil: Date | null };

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

  /**
   * مسبح مستقل — لا `DB`. الحارس يُستدعى داخل معاملات المُستدعي، ومشاركة
   * المسبح تجمّد الخدمة كلها عند التزامن. التفصيل عند `PIN_GUARD_DB`.
   */
  constructor(@Inject(PIN_GUARD_DB) private readonly db: DbClient) {}

  /**
   * يتحقق من الرمز مع حماية التخمين.
   *
   * ثلاثة قيود تحكم البنية هنا، وكلٌّ منها يُسقط الحماية إن أُهمل:
   *
   * ١. **قفل استشاري لكل هدف.** القراءة والمقارنة والزيادة وقرار القفل
   *    لا بد أن تتسلسل. بلا ذلك تقرأ المحاولات المتزامنة العدّاد نفسه
   *    فتكتب `lockedUntil` محسوباً من قيمة قديمة — وقد قِيس ذلك: أربع
   *    محاولات متزامنة تركت **٢٠ هدفاً من ٢٠ بلا قفل** رغم بلوغ العدّاد
   *    أربعة. زيادة ذرّية لا تكفي ما دام القرار غير ذرّي.
   *
   * ٢. **الرمي بعد الالتزام.** `confirmPickup` وتأكيد التسوية يستدعيان
   *    الحارس داخل معاملة يُلغيها الاستثناء. لو رُمي داخل معاملة الحارس
   *    لتراجع العدّاد معها فلا يُحتسب إخفاق قط.
   *
   * ٣. **فحص القفل قبل المقارنة.** الرمز الصحيح لا يمرّ أثناء القفل،
   *    وإلا صار القفل بلا أثر على من يخمّن حتى يصيب.
   */
  async verify(opts: {
    targetType: PinTarget;
    targetId: string;
    expected: string;
    provided: string;
    actorUserId?: string;
  }): Promise<void> {
    const { targetType, targetId, expected, provided, actorUserId } = opts;

    const verdict = await this.db.transaction(async (tx): Promise<Verdict> => {
      await tx.execute(sql.raw(LOCK_TIMEOUT_SQL));
      // القفل على الهدف وحده: أهداف مختلفة لا تتزاحم، ويُحرَّر مع المعاملة
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${targetType}:${targetId}`}::text, 0))`,
      );

      const [row] = await tx
        .select()
        .from(pinAttempts)
        .where(and(eq(pinAttempts.targetType, targetType), eq(pinAttempts.targetId, targetId)))
        .limit(1);

      const now = new Date();
      if (row?.lockedUntil && row.lockedUntil > now) {
        return {
          kind: 'locked',
          retryAfterSec: Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000),
        };
      }

      if (provided === expected) {
        // لا داعي لإبقاء سجل بعد إتمام العملية
        if (row) {
          await tx
            .delete(pinAttempts)
            .where(and(eq(pinAttempts.targetType, targetType), eq(pinAttempts.targetId, targetId)));
        }
        return { kind: 'ok' };
      }

      // القفل الاستشاري يجعل هذه القراءة نهائية، فتُكتب القيمة صراحةً
      // ويُحسب القفل منها هي لا من قراءة سبقتها.
      const failed = (row?.failedCount ?? 0) + 1;
      const lockMs = lockDuration(failed);
      const lockedUntil = lockMs > 0 ? new Date(now.getTime() + lockMs) : null;

      await tx
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
            failedCount: failed,
            lockedUntil,
            lastFailedAt: now,
            lastActorUserId: actorUserId ?? null,
            updatedAt: now,
          },
        });

      return { kind: 'wrong', attempt: failed, lockedUntil };
    });

    // ما بعد الالتزام: الكتابة محفوظة، فالرمي الآن لا يُلغيها
    if (verdict.kind === 'ok') return;

    if (verdict.kind === 'locked') {
      this.logger.warn(
        `pin locked: ${targetType}/${targetId} actor=${actorUserId ?? '?'} retryAfter=${verdict.retryAfterSec}s`,
      );
      throw new ForbiddenException({ code: 'PIN_LOCKED', retryAfterSec: verdict.retryAfterSec });
    }

    this.logger.warn(
      `pin failed: ${targetType}/${targetId} actor=${actorUserId ?? '?'} attempt=${verdict.attempt}`,
    );
    throw new ForbiddenException({
      code: 'WRONG_PIN',
      ...(verdict.lockedUntil ? { lockedUntil: verdict.lockedUntil.toISOString() } : {}),
    });
  }
}
