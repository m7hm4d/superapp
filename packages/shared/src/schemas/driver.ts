import { z } from 'zod';
import { zLatLng, zPin, zUuid } from './common';

export const zSetAvailability = z.object({ isAvailable: z.boolean() });

export const zLocationPing = zLatLng;

export const zClaimBatch = z.object({ batchId: zUuid });

export const zConfirmPickup = z.object({
  pin: zPin, // pickup PIN يعرضه تطبيق المخبز
});

export const zConfirmDelivery = z.object({
  pin: zPin, // delivery PIN لدى العميل
  cashCollectedIqd: z.number().int().nonnegative(),
});

export const zReportException = z.object({
  type: z.enum([
    'customer_unavailable',
    'address_unclear',
    'customer_refused',
    'cash_discrepancy',
    'other',
  ]),
  note: z.string().max(500).optional(),
});

export interface BatchStopView {
  orderId: string;
  orderCode: string;
  sequence: number;
  status: string;
  addressText: string;
  landmark?: string | null;
  lat: number;
  lng: number;
  totalIqd: number; // المبلغ الواجب تحصيله
  contactPhoneMasked: string;
}

export interface BatchView {
  id: string;
  status: string;
  vendorNameAr: string;
  vendorLat: number;
  vendorLng: number;
  vendorAddressText: string;
  ordersCount: number;
  totalFeeIqd: number;
  totalCashIqd: number;
  offerExpiresAt?: string | null;
  stops: BatchStopView[];
}
