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

/**
 * مخطط لا واجهة: منه يُولَّد العقد ونماذج Dart.
 *
 * `settlementPin` اختياري لأنه لا يُرسل إلا لمن يحقّ له رؤيته — السائق
 * صاحب التسوية ما دامت بانتظار تأكيد المخبز. المخبز لا يراه أبداً: هو
 * يُدخله ليؤكّد، فإرساله إليه يُلغي معنى التأكيد.
 */
export const zSettlementView = z.object({
  id: zUuid,
  vendorId: zUuid,
  vendorNameAr: z.string(),
  driverId: zUuid,
  driverName: z.string(),
  status: z.string(),
  amountIqd: z.number().int(),
  orderIds: z.array(zUuid),
  settlementPin: z.string().optional(),
  createdAt: z.string(),
  settledAt: z.string().nullish(),
});

export type SettlementView = z.infer<typeof zSettlementView>;

export interface LedgerSummaryView {
  date: string;
  deliveredCount: number;
  grossSalesIqd: number;
  feesIqd: number;
  cancelledCount: number;
}
