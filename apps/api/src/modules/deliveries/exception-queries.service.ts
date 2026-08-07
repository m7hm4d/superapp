import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { exceptions } from '../../db/schema';
import { OrderDirectoryService } from '../orders/order-directory.service';
import { UserDirectoryService } from '../auth/user-directory.service';
import { VendorDirectoryService } from '../vendors/vendor-directory.service';

interface ListQuery {
  status: (typeof exceptions.$inferSelect)['status'];
  limit: number;
  offset: number;
}

/**
 * استعلامات الاستثناءات التي تعرضها لوحة الإدارة.
 *
 * موضعها هنا لا في `admin` لأن `exceptions` ملك هذه الوحدة. واللوحة نموذج
 * قراءة فوق المجالات كلها — فإن ملك كل مجال استعلاماته الإدارية، لم تبقَ
 * للوحة حاجة إلى الاستعلام عن جداول غيرها.
 *
 * والإثراء عبر المنافذ لا بانضمام: `deliveries` لا تملك `orders` ولا
 * `users` ولا `vendorProfiles`. أربعة استعلامات محدودة بصفحة واحدة بدل
 * انضمام رباعي — والتصفية والترقيم يبقيان على `exceptions` وحده، فلا يتحوّل
 * شيء إلى عمل غير محدود.
 */
@Injectable()
export class ExceptionQueriesService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly ordersDirectory: OrderDirectoryService,
    private readonly vendors: VendorDirectoryService,
    private readonly usersDirectory: UserDirectoryService,
  ) {}

  async listForAdmin(q: ListQuery) {
    const where = eq(exceptions.status, q.status);

    const [rows, countRows] = await Promise.all([
      this.db
        .select()
        .from(exceptions)
        .where(where)
        .orderBy(desc(exceptions.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(exceptions).where(where),
    ]);

    const total = countRows[0]?.count ?? 0;
    if (rows.length === 0) return { items: [], total, limit: q.limit, offset: q.offset };

    const orderIds = rows.map((r) => r.orderId).filter((id): id is string => id !== null);
    const reporterIds = rows
      .map((r) => r.reportedByUserId)
      .filter((id): id is string => id !== null);

    const [ordersById, reporterNames] = await Promise.all([
      this.ordersDirectory.summariesFor(orderIds),
      this.usersDirectory.namesFor(reporterIds),
    ]);
    // أسماء المتاجر بعد الطلبات: معرّف البائع يأتي من الطلب لا من الاستثناء
    const vendorsById = await this.vendors.summariesFor(
      [...ordersById.values()].map((o) => o.vendorId),
    );

    const items = rows.map((row) => {
      const order = row.orderId ? ordersById.get(row.orderId) : undefined;
      const vendor = order ? vendorsById.get(order.vendorId) : undefined;
      return {
        id: row.id,
        type: row.type,
        status: row.status,
        note: row.note,
        orderId: row.orderId,
        orderCode: order?.code ?? null,
        orderStatus: order?.status ?? null,
        vendorId: order?.vendorId ?? null,
        vendorStoreNameAr: vendor?.storeNameAr ?? null,
        batchId: row.batchId,
        reportedByUserId: row.reportedByUserId,
        reporterName: row.reportedByUserId
          ? (reporterNames.get(row.reportedByUserId) ?? null)
          : null,
        ownerAdminId: row.ownerAdminId,
        decision: row.decision,
        decisionReason: row.decisionReason,
        createdAt: row.createdAt,
        resolvedAt: row.resolvedAt,
      };
    });

    return { items, total, limit: q.limit, offset: q.offset };
  }
}
