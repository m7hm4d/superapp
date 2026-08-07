import { z } from 'zod';
import { zLatLng, zPin, zUuid } from './common';
import { zSettlementView } from './settlements';

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

/**
 * الاستجابات مخططات لا واجهات مجرّدة.
 *
 * الواجهة تُمحى عند التصريف فلا يبقى منها شيء وقت التشغيل — فلا يمكن
 * توليد عقد منها، ولا التحقق من أن ما يرسله الخادم يطابقها. المخطط يبقى
 * قيمة حقيقية: منه يُولَّد OpenAPI، ومنه تُشتقّ نماذج Dart.
 *
 * والواجهات أدناه `z.infer` من المخططات لا تعريفات مستقلة — فأي انحراف
 * بين الاثنين يصير خطأ تصريف لا مفاجأة وقت التشغيل.
 */
export const zBatchStopView = z.object({
  orderId: zUuid,
  orderCode: z.string(),
  sequence: z.number().int(),
  status: z.string(),
  addressText: z.string(),
  landmark: z.string().nullish(),
  lat: z.number(),
  lng: z.number(),
  /** المبلغ الواجب تحصيله من هذا العميل */
  totalIqd: z.number().int(),
  /** مقنّع من الخادم — لا يُرسل الرقم الكامل إلى التطبيق */
  contactPhoneMasked: z.string(),
});

export const zBatchView = z.object({
  id: zUuid,
  status: z.string(),
  vendorNameAr: z.string(),
  vendorLat: z.number(),
  vendorLng: z.number(),
  vendorAddressText: z.string(),
  ordersCount: z.number().int(),
  totalFeeIqd: z.number().int(),
  totalCashIqd: z.number().int(),
  offerExpiresAt: z.string().nullish(),
  stops: z.array(zBatchStopView),
});

/** توقف كما يراه السائق: يضيف وقت التسليم */
export const zDriverBatchStop = zBatchStopView.extend({
  deliveredAt: z.string().nullable(),
});

export const zDriverBatchView = zBatchView.extend({
  stops: z.array(zDriverBatchStop),
});

export const zDriverLedger = z.object({
  todayDeliveredCount: z.number().int(),
  todayFeesIqd: z.number().int(),
  /** النقد الذي بعهدة السائق ولم يُسوَّ بعد */
  cashOnHandIqd: z.number().int(),
  owed: z.array(
    z.object({
      vendorId: zUuid,
      vendorNameAr: z.string(),
      amountIqd: z.number().int(),
    }),
  ),
  /**
   * تسويات السائق. تحمل `settlementPin` ما دامت بانتظار تأكيد المخبز —
   * فالرمز ليس صالحاً لحظة الإنشاء فقط، والسائق يستعيده من هنا لو أغلق
   * التطبيق قبل أن يُريه للمخبز.
   */
  settlements: z.array(zSettlementView),
});

export type BatchStopView = z.infer<typeof zBatchStopView>;
export type BatchView = z.infer<typeof zBatchView>;
export type DriverBatchStop = z.infer<typeof zDriverBatchStop>;
export type DriverBatchView = z.infer<typeof zDriverBatchView>;
export type DriverLedger = z.infer<typeof zDriverLedger>;
