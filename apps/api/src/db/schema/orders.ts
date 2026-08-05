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
import { geographyPoint } from './_geo';
import { cities } from './core';
import { users } from './users';
import { vendorProfiles } from './vendors';

export const orderStatusEnum = pgEnum('order_status', [
  'PENDING_BAKERY',
  'PREPARING',
  'READY',
  'IN_DELIVERY',
  'DELIVERED',
  'CANCELLED',
]);

export const cancelledByEnum = pgEnum('cancelled_by', ['customer', 'vendor', 'admin', 'system']);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // كود قصير للدعم الهاتفي مثل BG-4821
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendorProfiles.id),
    status: orderStatusEnum('status').notNull().default('PENDING_BAKERY'),
    subtotalIqd: bigint('subtotal_iqd', { mode: 'number' }).notNull(),
    deliveryFeeIqd: bigint('delivery_fee_iqd', { mode: 'number' }).notNull(),
    commissionIqd: bigint('commission_iqd', { mode: 'number' }).notNull().default(0),
    totalIqd: bigint('total_iqd', { mode: 'number' }).notNull(),
    deliveryLocation: geographyPoint('delivery_location').notNull(),
    deliveryAddressText: text('delivery_address_text').notNull(),
    deliveryLandmark: text('delivery_landmark'),
    contactPhone: text('contact_phone').notNull(),
    note: text('note'),
    deliveryPin: text('delivery_pin').notNull(), // 4 أرقام يراها العميل فقط
    prepMinutes: integer('prep_minutes'),
    cancelledBy: cancelledByEnum('cancelled_by'),
    cancelledReason: text('cancelled_reason'),
    version: integer('version').notNull().default(1), // تفاؤلية expectedVersion
    acceptTimeoutAt: timestamp('accept_timeout_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    index('orders_city_status_idx').on(t.cityId, t.status),
    index('orders_vendor_status_idx').on(t.vendorId, t.status),
    index('orders_customer_created_idx').on(t.customerId, t.createdAt),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    productNameAr: text('product_name_ar').notNull(), // snapshot
    unitPriceIqd: bigint('unit_price_iqd', { mode: 'number' }).notNull(), // snapshot
    quantity: integer('quantity').notNull(),
    lineTotalIqd: bigint('line_total_iqd', { mode: 'number' }).notNull(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
);

/** سجل تدقيق كل انتقال (الملف §8): من/إلى/الفاعل/السبب */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role').notNull(), // role أو 'system'
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
);
