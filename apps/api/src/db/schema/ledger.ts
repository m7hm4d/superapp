import { bigint, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { driverProfiles, vendorProfiles } from './vendors';

export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', [
  'order_sale',
  'delivery_fee',
  'platform_commission',
  'cash_collected',
  'settlement',
  'reversal',
]);

/**
 * دفتر append-only: لا حذف ولا تعديل — التصحيح بحركة عكسية مرتبطة بالأصل.
 * عند DELIVERED تُكتب القيود في معاملة واحدة مع انتقال الطلب.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryType: ledgerEntryTypeEnum('entry_type').notNull(),
    orderId: uuid('order_id').references(() => orders.id),
    vendorId: uuid('vendor_id').references(() => vendorProfiles.id),
    driverId: uuid('driver_id').references(() => driverProfiles.id),
    settlementId: uuid('settlement_id'),
    amountIqd: bigint('amount_iqd', { mode: 'number' }).notNull(), // موقّع
    note: text('note'),
    reversalOfId: uuid('reversal_of_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_vendor_idx').on(t.vendorId, t.createdAt),
    index('ledger_driver_idx').on(t.driverId, t.createdAt),
    index('ledger_order_idx').on(t.orderId),
  ],
);

export const settlementStatusEnum = pgEnum('settlement_status', [
  'UNSETTLED',
  'AWAITING_CONFIRMATION',
  'SETTLED',
  'DISPUTED',
]);

/** آلة 3 — تسوية نقد السائق مع المخبز، تأكيد بـ PIN (الملف §8.3) */
export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendorProfiles.id),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driverProfiles.id),
    status: settlementStatusEnum('status').notNull().default('UNSETTLED'),
    amountIqd: bigint('amount_iqd', { mode: 'number' }).notNull(),
    settlementPin: text('settlement_pin').notNull(),
    orderIds: text('order_ids').notNull(), // JSON array نصي للطلبات المشمولة
    disputeReason: text('dispute_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    index('settlements_vendor_status_idx').on(t.vendorId, t.status),
    index('settlements_driver_status_idx').on(t.driverId, t.status),
  ],
);
