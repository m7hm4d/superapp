import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/** كل فعل إداري يسجَّل هنا مع السبب (الملف §7: إجراءات موثقة) */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(), // approve_vendor, resolve_exception, update_flag...
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    payload: text('payload'), // JSON نصي
    reason: text('reason'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_actor_idx').on(t.actorUserId, t.createdAt), index('audit_target_idx').on(t.targetType, t.targetId)],
);

/**
 * مفاتيح idempotency لكل كتابة من التطبيقات: المفتاح + hash الجسم + الاستجابة المخزنة.
 * إعادة الإرسال بنفس المفتاح = نفس الاستجابة بلا تنفيذ مكرر.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    userId: uuid('user_id'),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idempotency_created_idx').on(t.createdAt)],
);

/**
 * محاولات التحقق من رموز PIN — لكل هدف (طلب/دفعة/تسوية) على حدة.
 *
 * رمز من أربعة أرقام = 10,000 احتمال. الحد العام (120 طلباً/دقيقة/IP) كان
 * الحماية الوحيدة، أي أن تخمين رمز تسليم يستغرق نحو 84 دقيقة من عنوان
 * واحد، وأقلّ بعناوين متعددة — ثم يُسجَّل طلب غير مسلَّم كمسلَّم فتتحرك
 * قيود الدفتر. ولم يكن يُسجَّل أي إخفاق، فلا أثر يكشف المحاولة.
 *
 * الحدّ هنا على **الهدف** لا على العنوان: تغيير الـIP أو الجهاز لا يعيد
 * العدّاد، وهو ما يُبطل التخمين الموزَّع.
 */
export const pinAttempts = pgTable(
  'pin_attempts',
  {
    /** نوع الهدف: batch_pickup | order_delivery | settlement */
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    failedCount: integer('failed_count').notNull().default(0),
    /** لا تُقبل محاولة قبل هذا الوقت — يتصاعد مع الإخفاق */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
    /**
     * آخر من حاول — للتحقيق لا للحدّ، ولذلك **بلا مفتاح أجنبي**.
     *
     * المفتاح الأجنبي هنا يفرض أحد سوءين: منع حذف المستخدم، أو محو الأثر
     * عند حذفه — وقت الحاجة إليه بالضبط. والأخطر أن فشل القيد يُسقط
     * الإدراج كلّه، فلا يُحتسب الإخفاق ولا يُقفل الهدف أبداً.
     */
    lastActorUserId: uuid('last_actor_user_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.targetType, t.targetId] }),
    index('pin_attempts_locked_idx').on(t.lockedUntil),
  ],
);
