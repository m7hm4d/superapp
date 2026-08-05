import type { ProductView, VendorCardView } from '@superapp/shared';

/** استجابة GET config — نقطة إقلاع التطبيق */
export interface FeatureFlagView {
  enabled: boolean;
  value: unknown;
}

export interface CityConfig {
  id: string;
  nameAr: string;
  centerLat: number;
  centerLng: number;
  serviceRadiusKm: number;
  visibilityRadiusKm: number;
  deliveryFeeIqd: number;
}

export interface AppConfig {
  flags: Record<string, FeatureFlagView>;
  city: CityConfig | null;
}

/** استجابة GET vendors/:id */
export interface StoreView {
  vendor: Omit<VendorCardView, 'distanceM'>;
  products: ProductView[];
  catalogVersion: number;
}
