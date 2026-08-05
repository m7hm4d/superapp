import type {
  LedgerSummaryView,
  OrderView,
  ProductView,
  SettlementView,
  VendorCategory,
} from '@superapp/shared';

/** حالة بروفايل المتجر كما يرجعها GET vendor/profile (نوع متسامح مع حقول إضافية) */
export interface VendorProfileView {
  id: string;
  storeNameAr: string;
  category: VendorCategory;
  isOpen: boolean;
  addressText: string;
  defaultPrepMinutes: number;
  openingHours?: string | null;
  lat?: number;
  lng?: number;
  approvalStatus?: string;
}

/** مستحق نقدي بعهدة سائق معيّن (شكل متسامح — الباكند مصدر الحقيقة) */
export interface OutstandingRow {
  driverId: string;
  driverName?: string;
  amountIqd: number;
  orderIds?: string[];
  deliveredCount?: number;
}

export interface VendorLedgerResponse {
  days?: LedgerSummaryView[];
  outstanding?: OutstandingRow[];
  settlements?: SettlementView[];
}

export type VendorOrdersResponse = OrderView[] | { orders: OrderView[] };

export type VendorProductsResponse = ProductView[] | { products: ProductView[] };

/** يطبع استجابات القوائم التي قد تأتي مصفوفة مباشرة أو مغلفة بمفتاح */
export function asArray<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const inner = (data as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}
