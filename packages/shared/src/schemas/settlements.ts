import { z } from 'zod';
import { zPin, zUuid } from './common';

/** السائق يبدأ التسوية مع مخبز محدد بمجموع طلبات مسلّمة غير مسوّاة */
export const zInitiateSettlement = z.object({
  vendorId: zUuid,
});

/** المخبز يؤكد الاستلام بإدخال PIN التسوية الظاهر عند السائق */
export const zConfirmSettlement = z.object({
  pin: zPin,
});

export const zDisputeSettlement = z.object({
  reason: z.string().min(2).max(500),
});

export interface SettlementView {
  id: string;
  vendorId: string;
  vendorNameAr: string;
  driverId: string;
  driverName: string;
  status: string;
  amountIqd: number;
  orderIds: string[];
  settlementPin?: string;
  createdAt: string;
  settledAt?: string | null;
}

export interface LedgerSummaryView {
  date: string;
  deliveredCount: number;
  grossSalesIqd: number;
  feesIqd: number;
  cancelledCount: number;
}
