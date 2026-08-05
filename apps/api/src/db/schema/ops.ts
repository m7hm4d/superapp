import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
