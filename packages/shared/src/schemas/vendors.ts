import { z } from 'zod';
import { VendorCategory } from '../enums';
import { zIqd, zLatLng, zUuid } from './common';

export const zNearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(100).max(15000).default(5000),
  category: z.nativeEnum(VendorCategory).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type NearbyQuery = z.infer<typeof zNearbyQuery>;

export interface VendorCardView {
  id: string;
  storeNameAr: string;
  category: VendorCategory;
  isOpen: boolean;
  lat: number;
  lng: number;
  distanceM: number;
  addressText: string;
  defaultPrepMinutes: number;
}

export const zUpdateVendorProfile = z.object({
  storeNameAr: z.string().min(2).max(120).optional(),
  addressText: z.string().min(2).max(300).optional(),
  location: zLatLng.optional(),
  defaultPrepMinutes: z.number().int().min(1).max(180).optional(),
  openingHours: z.string().max(200).optional(),
});

export const zSetOpen = z.object({ isOpen: z.boolean() });

export const zCreateProduct = z.object({
  nameAr: z.string().min(1).max(120),
  nameEn: z.string().max(120).optional(),
  descriptionAr: z.string().max(500).optional(),
  priceIqd: zIqd.refine((v) => v > 0, 'السعر مطلوب'),
  section: z.string().max(60).optional(),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  imageUrl: z.string().url().optional(),
});
export const zUpdateProduct = zCreateProduct.partial();

export interface ProductView {
  id: string;
  vendorId: string;
  nameAr: string;
  nameEn?: string | null;
  descriptionAr?: string | null;
  priceIqd: number;
  section?: string | null;
  isAvailable: boolean;
  sortOrder: number;
  imageUrl?: string | null;
}

export const zProductIdParam = z.object({ id: zUuid });
