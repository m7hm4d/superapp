import { AUTH_EVENT_OUTCOMES } from '@superapp/shared';
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
    /**
     * الدور الذي صدرت به العائلة.
     *
     * ‏`auth/refresh` مسار عام لا يمرّ بحارس المصادقة، فكان يصدر رمزاً بالدور
     * **الحالي** من القاعدة: حساب زبون رُقّي إلى أدمن يحصل على رمز أدمن كامل
     * بلا مصادقة إدارة ولا عامل ثانٍ — قِيس على بيئة التجربة وفتح مساراً
     * إدارياً بـ200.
     *
     * بمقارنة هذا العمود بالدور الحالي يُكشف التغيّر عند التجديد نفسه، فلا
     * يبقى الكشف رهناً بمرور الرمز على REST أولاً.
     */
    issuedRole: text('issued_role').notNull(),
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

/**
 * مفاتيح المرور (WebAuthn) للإدارة: عامل مقاوم للتصيّد — الاعتماد مربوط
 * بالنطاق تشفيرياً، فصفحة مزيّفة لا تحصل على شيء قابل للتمرير (خلاف TOTP).
 * الاسترداد عند ضياع الهاتف يتكفّل به مزامنة المفاتيح (iCloud/Google).
 */
export const adminPasskeys = pgTable(
  'admin_passkeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(), // base64url
    publicKey: text('public_key').notNull(), // base64url (COSE)
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports'), // JSON نصي
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('admin_passkeys_user_idx').on(t.userId)],
);

export const webauthnPurposeEnum = pgEnum('webauthn_purpose', ['register', 'login']);

/** تحدٍّ واحد الاستعمال بعمر قصير — يُحذف فور التحقق منه */
export const webauthnChallenges = pgTable(
  'webauthn_challenges',
  {
    challenge: text('challenge').primaryKey(),
    purpose: webauthnPurposeEnum('purpose').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('webauthn_challenges_expiry_idx').on(t.expiresAt)],
);

// القيم من @superapp/shared: قائمتان تتباعدان بصمت أسوأ من استيراد واحد
export const authEventOutcomeEnum = pgEnum('auth_event_outcome', AUTH_EVENT_OUTCOMES);

export const authEventMethodEnum = pgEnum('auth_event_method', [
  'phone_password',
  'admin_password_totp',
  'admin_passkey',
  'refresh',
  'logout',
  'admin_action',
]);

/**
 * سجل أحداث المصادقة: من دخل ومتى ومن أين وبأي نتيجة.
 * لا يُخزَّن أي معرّف مُدخَل لم يطابق حساباً قائماً — الحقل الحر قد يحوي
 * كلمة مرور كُتبت في خانة البريد سهواً؛ يكفي أثر المحاولة وعنوانها.
 * sessionFamilyId يربط الحدث بسلالة refresh الناتجة عنه، فتُعرف الجلسة وجهازها.
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    method: authEventMethodEnum('method').notNull(),
    outcome: authEventOutcomeEnum('outcome').notNull(),
    sessionFamilyId: uuid('session_family_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_events_user_idx').on(t.userId, t.createdAt),
    index('auth_events_created_idx').on(t.createdAt),
    index('auth_events_family_idx').on(t.sessionFamilyId),
  ],
);

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
