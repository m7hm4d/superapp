export const Role = {
  CUSTOMER: 'customer',
  VENDOR: 'vendor',
  DRIVER: 'driver',
  ADMIN: 'admin',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const UserStatus = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const ApprovalStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const VendorCategory = {
  BAKERY: 'bakery',
  VEGETABLES: 'vegetables',
  MARKET: 'market',
  CONSTRUCTION: 'construction',
} as const;
export type VendorCategory = (typeof VendorCategory)[keyof typeof VendorCategory];

export const VehicleType = {
  MOTORCYCLE: 'motorcycle',
  CAR: 'car',
  TUKTUK: 'tuktuk',
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];

/** آلة 1 — حالة الطلب (الملف §8.1) */
export const OrderStatus = {
  PENDING_BAKERY: 'PENDING_BAKERY',
  PREPARING: 'PREPARING',
  READY: 'READY',
  IN_DELIVERY: 'IN_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const CancelledBy = {
  CUSTOMER: 'customer',
  VENDOR: 'vendor',
  ADMIN: 'admin',
  SYSTEM: 'system',
} as const;
export type CancelledBy = (typeof CancelledBy)[keyof typeof CancelledBy];

/** آلة 2 — حالة دفعة التوصيل (الملف §8.2) */
export const BatchStatus = {
  PROPOSED: 'PROPOSED',
  OFFERED: 'OFFERED',
  CLAIMED: 'CLAIMED',
  PICKUP_CONFIRMED: 'PICKUP_CONFIRMED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type BatchStatus = (typeof BatchStatus)[keyof typeof BatchStatus];

/** آلة 3 — حالة التسوية المالية (الملف §8.3) */
export const SettlementStatus = {
  UNSETTLED: 'UNSETTLED',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  SETTLED: 'SETTLED',
  DISPUTED: 'DISPUTED',
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];

export const ExceptionType = {
  CUSTOMER_UNAVAILABLE: 'customer_unavailable',
  ADDRESS_UNCLEAR: 'address_unclear',
  CUSTOMER_REFUSED: 'customer_refused',
  CASH_DISCREPANCY: 'cash_discrepancy',
  VENDOR_ISSUE: 'vendor_issue',
  OTHER: 'other',
} as const;
export type ExceptionType = (typeof ExceptionType)[keyof typeof ExceptionType];

export const ExceptionStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
} as const;
export type ExceptionStatus = (typeof ExceptionStatus)[keyof typeof ExceptionStatus];

/** أنواع قيود الدفتر — append-only، التصحيح بحركة عكسية فقط */
export const LedgerEntryType = {
  ORDER_SALE: 'order_sale',
  DELIVERY_FEE: 'delivery_fee',
  PLATFORM_COMMISSION: 'platform_commission',
  CASH_COLLECTED: 'cash_collected',
  SETTLEMENT: 'settlement',
  REVERSAL: 'reversal',
} as const;
export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType];

/** أعلام الميزات الأولية */
export const FeatureFlagKey = {
  CATEGORY_BAKERY: 'category.bakery',
  CATEGORY_VEGETABLES: 'category.vegetables',
  CATEGORY_MARKET: 'category.market',
  CATEGORY_CONSTRUCTION: 'category.construction',
  AUTH_OTP: 'auth.otp',
  CUSTOMER_LIVE_TRACKING: 'customer.live_tracking',
  BATCH_MAX_SIZE: 'batch.max_size',
} as const;
export type FeatureFlagKey = (typeof FeatureFlagKey)[keyof typeof FeatureFlagKey];

export const CATEGORY_FLAG_BY_CATEGORY: Record<VendorCategory, FeatureFlagKey> = {
  [VendorCategory.BAKERY]: FeatureFlagKey.CATEGORY_BAKERY,
  [VendorCategory.VEGETABLES]: FeatureFlagKey.CATEGORY_VEGETABLES,
  [VendorCategory.MARKET]: FeatureFlagKey.CATEGORY_MARKET,
  [VendorCategory.CONSTRUCTION]: FeatureFlagKey.CATEGORY_CONSTRUCTION,
};
