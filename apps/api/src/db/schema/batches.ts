import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { cities } from './core';
import { orders } from './orders';
import { driverProfiles, vendorProfiles } from './vendors';

export const batchStatusEnum = pgEnum('batch_status', [
  'PROPOSED',
  'OFFERED',
  'CLAIMED',
  'PICKUP_CONFIRMED',
  'ACTIVE',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
]);

/** آلة 2 — الخادم ينشئ الدفعة من 1–3 طلبات READY من المخبز نفسه (الملف §8.2) */
export const batches = pgTable(
  'batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendorProfiles.id),
    driverId: uuid('driver_id').references(() => driverProfiles.id),
    status: batchStatusEnum('status').notNull().default('PROPOSED'),
    pickupPin: text('pickup_pin').notNull(), // يعرضه تطبيق المخبز للسائق
    totalFeeIqd: bigint('total_fee_iqd', { mode: 'number' }).notNull(),
    totalCashIqd: bigint('total_cash_iqd', { mode: 'number' }).notNull(),
    offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    pickupConfirmedAt: timestamp('pickup_confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('batches_city_status_idx').on(t.cityId, t.status),
    index('batches_driver_status_idx').on(t.driverId, t.status),
    index('batches_vendor_idx').on(t.vendorId),
  ],
);

export const batchOrders = pgTable(
  'batch_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .unique() // الطلب في دفعة واحدة حية كحد أقصى؛ يُنظف عند EXPIRED/CANCELLED
      .references(() => orders.id),
    sequence: integer('sequence').notNull(), // ترتيب التوقفات من الخادم
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [index('batch_orders_batch_idx').on(t.batchId, t.sequence)],
);

export const exceptionTypeEnum = pgEnum('exception_type', [
  'customer_unavailable',
  'address_unclear',
  'customer_refused',
  'cash_discrepancy',
  'vendor_issue',
  'other',
]);
export const exceptionStatusEnum = pgEnum('exception_status', ['OPEN', 'RESOLVED']);

/** الاستثناء سجل وليس حالة: الطلب يبقى IN_DELIVERY حتى قرار إداري (الملف §8.1) */
export const exceptions = pgTable(
  'exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').references(() => orders.id),
    batchId: uuid('batch_id').references(() => batches.id),
    type: exceptionTypeEnum('type').notNull(),
    status: exceptionStatusEnum('status').notNull().default('OPEN'),
    note: text('note'),
    reportedByUserId: uuid('reported_by_user_id'),
    ownerAdminId: uuid('owner_admin_id'),
    decision: text('decision'),
    decisionReason: text('decision_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('exceptions_status_idx').on(t.status, t.createdAt)],
);
