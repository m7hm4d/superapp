import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { geographyPoint } from './_geo';

/** المستأجرون: مشغّل واحد افتراضياً؛ التوسع SaaS لاحقاً بلا إعادة تصميم */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameAr: text('name_ar').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** المدينة = وحدة النطاق التشغيلي (تغطي "الحي" في الطيار) */
export const cities = pgTable('cities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  nameAr: text('name_ar').notNull(),
  center: geographyPoint('center').notNull(),
  serviceRadiusKm: integer('service_radius_km').notNull().default(15),
  visibilityRadiusKm: integer('visibility_radius_km').notNull().default(5),
  deliveryFeeIqd: bigint('delivery_fee_iqd', { mode: 'number' }).notNull().default(2000),
  vendorAcceptTimeoutMin: integer('vendor_accept_timeout_min').notNull().default(10),
  batchWindowSec: integer('batch_window_sec').notNull().default(75),
  batchOfferTtlSec: integer('batch_offer_ttl_sec').notNull().default(60),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  value: text('value'), // JSON نصي اختياري (مثل {"max":3})
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});
