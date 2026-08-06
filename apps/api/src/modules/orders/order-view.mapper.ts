import { ORDER_TERMINAL } from '@superapp/shared';
import type { OrderItemView, OrderView } from '@superapp/shared';
import type { orderItems, orders } from '../../db/schema';

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;

export interface OrderViewOptions {
  /** deliveryPin يظهر للعميل فقط وطالما الطلب غير نهائي */
  includePin: boolean;
}

export function toOrderItemView(row: OrderItemRow): OrderItemView {
  return {
    id: row.id,
    productNameAr: row.productNameAr,
    unitPriceIqd: row.unitPriceIqd,
    quantity: row.quantity,
    lineTotalIqd: row.lineTotalIqd,
  };
}

export function toOrderView(
  order: OrderRow,
  items: OrderItemRow[],
  vendorNameAr: string,
  opts: OrderViewOptions,
): OrderView {
  const isActive = !ORDER_TERMINAL.includes(order.status);
  const view: OrderView = {
    id: order.id,
    code: order.code,
    status: order.status,
    vendorId: order.vendorId,
    vendorNameAr,
    customerId: order.customerId,
    items: items.map(toOrderItemView),
    subtotalIqd: order.subtotalIqd,
    deliveryFeeIqd: order.deliveryFeeIqd,
    totalIqd: order.totalIqd,
    deliveryAddressText: order.deliveryAddressText,
    deliveryLandmark: order.deliveryLandmark,
    deliveryLat: order.deliveryLocation.lat,
    deliveryLng: order.deliveryLocation.lng,
    note: order.note,
    prepMinutes: order.prepMinutes,
    cancelledReason: order.cancelledReason,
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    timestamps: {
      acceptedAt: order.acceptedAt ? order.acceptedAt.toISOString() : null,
      readyAt: order.readyAt ? order.readyAt.toISOString() : null,
      pickedUpAt: order.pickedUpAt ? order.pickedUpAt.toISOString() : null,
      deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
      cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
    },
  };
  if (opts.includePin && isActive) {
    view.deliveryPin = order.deliveryPin;
  }
  return view;
}
