import { bigint, boolean, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { geographyPoint } from './_geo';

export const roleEnum = pgEnum('role', ['customer', 'vendor', 'driver', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'blocked']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull().unique(), // E.164 عبر normalizeIraqiPhone
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    role: roleEnum('role').notNull(),
    status: userStatusEnum('status').notNull().default('active'),
    locale: text('locale').notNull().default('ar'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('users_role_idx').on(t.role)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(), // sha256
    familyId: uuid('family_id').notNull(), // سلالة التدوير — كشف إعادة الاستخدام
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId), index('refresh_tokens_family_idx').on(t.familyId)],
);

/**
 * دخول الإدارة: بريد + كلمة مرور + TOTP إلزامي — مستقل عن تدفق الهاتف.
 * السر قيد التسجيل يُحفظ في pending_totp_secret ولا يلمس السر الفعّال،
 * فإعادة التسجيل لا تُعطّل تطبيق المصادقة القائم قبل تأكيد الجديد.
 * last_totp_step يمنع إعادة استخدام الرمز نفسه داخل نافذته.
 */
export const adminCredentials = pgTable('admin_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  totpSecret: text('totp_secret'),
  pendingTotpSecret: text('pending_totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  lastTotpStep: bigint('last_totp_step', { mode: 'number' }),
});

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label'),
    location: geographyPoint('location').notNull(),
    addressText: text('address_text').notNull(),
    landmark: text('landmark'),
    contactPhone: text('contact_phone').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('customer_addresses_user_idx').on(t.userId)],
);
