'use client';

import { Badge, type BadgeTone } from './badge';

/**
 * حالة → نص عربي + لون. تغطي آلات الحالة الثلاث (الملف §8)
 * وحالات الاعتماد والمستخدمين والاستثناءات. الحالة لا تعتمد على
 * اللون وحده (الملف §11) — النص دائماً موجود.
 */
const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  // حالة الطلب (§8.1)
  PENDING_BAKERY: { label: 'بانتظار البائع', tone: 'amber' },
  PREPARING: { label: 'قيد التحضير', tone: 'blue' },
  READY: { label: 'جاهز', tone: 'purple' },
  IN_DELIVERY: { label: 'في التوصيل', tone: 'blue' },
  DELIVERED: { label: 'تم التسليم', tone: 'green' },
  CANCELLED: { label: 'ملغي', tone: 'red' },
  // حالة الدفعة (§8.2) — CANCELLED مشتركة أعلاه
  PROPOSED: { label: 'مقترحة', tone: 'gray' },
  OFFERED: { label: 'معروضة', tone: 'amber' },
  CLAIMED: { label: 'مقبولة', tone: 'blue' },
  PICKUP_CONFIRMED: { label: 'تم الاستلام', tone: 'purple' },
  ACTIVE: { label: 'نشطة', tone: 'blue' },
  COMPLETED: { label: 'مكتملة', tone: 'green' },
  EXPIRED: { label: 'منتهية', tone: 'gray' },
  // حالة التسوية (§8.3)
  UNSETTLED: { label: 'غير مسوّى', tone: 'amber' },
  AWAITING_CONFIRMATION: { label: 'بانتظار التأكيد', tone: 'blue' },
  SETTLED: { label: 'مسوّى', tone: 'green' },
  DISPUTED: { label: 'متنازع عليه', tone: 'red' },
  // الاستثناءات
  OPEN: { label: 'مفتوح', tone: 'amber' },
  RESOLVED: { label: 'محلول', tone: 'green' },
  // الاعتماد
  pending: { label: 'قيد المراجعة', tone: 'amber' },
  approved: { label: 'معتمد', tone: 'green' },
  rejected: { label: 'مرفوض', tone: 'red' },
  suspended: { label: 'موقوف', tone: 'gray' },
  // حالة المستخدم
  active: { label: 'نشط', tone: 'green' },
  blocked: { label: 'محظور', tone: 'red' },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
