import { z } from 'zod';
import { zIqd, zLatLng, zUuid } from './common';

export const zOrderItemInput = z.object({
  productId: zUuid,
  quantity: z.number().int().min(1).max(99),
});

export const zCreateOrder = z.object({
  vendorId: zUuid,
  items: z.array(zOrderItemInput).min(1).max(50),
  delivery: z.object({
    location: zLatLng,
    addressText: z.string().min(2).max(300),
    landmark: z.string().max(200).optional(),
    contactPhone: z.string().min(7).max(20),
  }),
  note: z.string().max(500).optional(),
  /** نسخة الكتالوج التي رآها العميل؛ تغيّر سعر/توفر = 409 مراجعة إلزامية */
  catalogVersion: z.number().int().optional(),
});
export type CreateOrderInput = z.infer<typeof zCreateOrder>;

export const zCancelOrder = z.object({
  reason: z.string().min(2).max(300),
});

export const zAcceptOrder = z.object({
  prepMinutes: z.number().int().min(1).max(180),
  expectedVersion: z.number().int(),
});

export const zRejectOrder = z.object({
  reason: z.string().min(2).max(300),
  expectedVersion: z.number().int(),
});

export const zMarkReady = z.object({
  expectedVersion: z.number().int(),
});

export interface OrderItemView {
  id: string;
  productNameAr: string;
  unitPriceIqd: number;
  quantity: number;
  lineTotalIqd: number;
}

export interface OrderView {
  id: string;
  code: string;
  status: string;
  vendorId: string;
  vendorNameAr: string;
  customerId: string;
  items: OrderItemView[];
  subtotalIqd: number;
  deliveryFeeIqd: number;
  totalIqd: number;
  deliveryAddressText: string;
  deliveryLandmark?: string | null;
  deliveryLat: number;
  deliveryLng: number;
  note?: string | null;
  prepMinutes?: number | null;
  deliveryPin?: string;
  cancelledReason?: string | null;
  version: number;
  createdAt: string;
  timestamps: Partial<Record<'acceptedAt' | 'readyAt' | 'pickedUpAt' | 'deliveredAt' | 'cancelledAt', string | null>>;
}

export const zIqdAmount = zIqd;
