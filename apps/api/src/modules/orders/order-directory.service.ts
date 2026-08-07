import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { orders } from '../../db/schema';

type OrderRow = typeof orders.$inferSelect;

/** ما تحتاجه الوحدات الأخرى من الطلب — لا الصف كاملاً */
export interface OrderSummary {
  id: OrderRow['id'];
  code: OrderRow['code'];
  status: OrderRow['status'];
  vendorId: OrderRow['vendorId'];
  subtotalIqd: OrderRow['subtotalIqd'];
  deliveryFeeIqd: OrderRow['deliveryFeeIqd'];
}

/**
 * منفذ القراءة إلى الطلبات.
 *
 * `orders` تلمسه أربع وحدات ولا تملكه: الدفتر يحتاج المبالغ، والاستثناءات
 * تحتاج الرمز والحالة للعرض.
 *
 * دفعي فقط — عمداً. الطلبات تُقرأ في قوائم لا صفّاً صفّاً، ومنفذ يعيد صفاً
 * واحداً يدعو إلى استدعائه داخل حلقة فيصير N+1. من أراد صفاً واحداً يطلب
 * دفعة من واحد.
 */
@Injectable()
export class OrderDirectoryService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  async summariesFor(orderIds: readonly string[]): Promise<Map<string, OrderSummary>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: orders.id,
        code: orders.code,
        status: orders.status,
        vendorId: orders.vendorId,
        subtotalIqd: orders.subtotalIqd,
        deliveryFeeIqd: orders.deliveryFeeIqd,
      })
      .from(orders)
      .where(inArray(orders.id, [...new Set(orderIds)]));
    return new Map(rows.map((row) => [row.id, row]));
  }
}
