import {
  bigint,
  boolean,
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

export const vendorCategoryEnum = pgEnum('vendor_category', [
  'bakery',
  'vegetables',
  'market',
  'construction',
]);
export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'suspended',
]);
export const vehicleTypeEnum = pgEnum('vehicle_type', ['motorcycle', 'car', 'tuktuk']);

export const vendorProfiles = pgTable(
  'vendor_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id),
    storeNameAr: text('store_name_ar').notNull(),
    storeNameEn: text('store_name_en'),
    category: vendorCategoryEnum('category').notNull(),
    location: geographyPoint('location').notNull(),
    addressText: text('address_text').notNull(),
    isOpen: boolean('is_open').notNull().default(false),
    openingHours: text('opening_hours'),
    defaultPrepMinutes: integer('default_prep_minutes').notNull().default(15),
    approvalStatus: approvalStatusEnum('approval_status').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vendor_profiles_city_category_idx').on(t.cityId, t.category),
    index('vendor_profiles_approval_idx').on(t.approvalStatus),
  ],
);

export const driverProfiles = pgTable(
  'driver_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id),
    vehicleType: vehicleTypeEnum('vehicle_type').notNull(),
    isAvailable: boolean('is_available').notNull().default(false),
    lastLocation: geographyPoint('last_location'),
    locationUpdatedAt: timestamp('location_updated_at', { withTimezone: true }),
    approvalStatus: approvalStatusEnum('approval_status').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('driver_profiles_city_available_idx').on(t.cityId, t.isAvailable)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendorProfiles.id, { onDelete: 'cascade' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en'),
    descriptionAr: text('description_ar'),
    priceIqd: bigint('price_iqd', { mode: 'number' }).notNull(),
    section: text('section'),
    imageUrl: text('image_url'),
    isAvailable: boolean('is_available').notNull().default(true),
    isDeleted: boolean('is_deleted').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('products_vendor_available_idx').on(t.vendorId, t.isAvailable)],
);
