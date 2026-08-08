import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LedgerEntryType, OrderStatus } from '@superapp/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB, DbClient } from '../src/db/drizzle.module';
import { driverProfiles, ledgerEntries, orders, vendorProfiles } from '../src/db/schema';
import { LedgerService } from '../src/modules/ledger/ledger.service';

/**
 * المستحقات المتقابلة: ما بذمة السائق لكل مخبز، وما للمخبز لدى كل سائق.
 * هما أساس شاشتَي التسوية، ولم يكن يغطيهما اختبار.
 *
 * انحدار: `vendorOutstandingByDriver` كان يصفّي بـ`orders.vendorId` عبر
 * انضمام — فلا يجيب الدفتر عن بائع إلا بسؤال جدول لا يملكه. والعمود
 * `ledger_entries.vendor_id` موجود منذ البداية بفهرسه، لكن مسار الكتابة كان
 * يتركه فارغاً في قيود النقد المحصَّل وحدها.
 *
 * والاختبار يصنع بياناته عبر `recordDeliveryEntries` نفسه لا عبر إدراج
 * يدوي: تركيبةٌ تُقلّد المسار تنحرف عنه بصمت — وقد انحرفت فعلاً في ملف
 * آخر، فسقط قيده من حساب مستحقات مخبزه بلا أن يُخطئ شيء.
 */
describe('ledger outstanding balances', () => {
  let app: INestApplication;
  let db: DbClient;
  let ledger: LedgerService;

  let vendorId = '';
  let driverId = '';
  const SUBTOTAL = 12_000;
  const FEE = 3_000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DB);
    ledger = app.get(LedgerService);

    const [vendor] = await db.select({ id: vendorProfiles.id }).from(vendorProfiles).limit(1);
    const [driver] = await db.select({ id: driverProfiles.id }).from(driverProfiles).limit(1);
    vendorId = vendor.id;
    driverId = driver.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** طلب مسلَّم بقيوده الأربعة — عبر المسار الكاتب نفسه لا بإدراج يدوي */
  const deliveredOrder = async (): Promise<string> => {
    const [vendor] = await db
      .select({ cityId: vendorProfiles.cityId })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.id, vendorId))
      .limit(1);
    const [order] = await db
      .insert(orders)
      .values({
        code: `T${randomUUID().slice(0, 7).toUpperCase()}`,
        cityId: vendor.cityId,
        vendorId,
        customerId: (await db.select({ id: vendorProfiles.userId }).from(vendorProfiles).limit(1))[0]
          .id,
        status: OrderStatus.DELIVERED,
        subtotalIqd: SUBTOTAL,
        deliveryFeeIqd: FEE,
        commissionIqd: 0,
        totalIqd: SUBTOTAL + FEE,
        deliveryLocation: { lat: 33.31, lng: 44.43 },
        deliveryAddressText: 'عنوان اختبار المستحقات',
        contactPhone: '+9647700000088',
        deliveryPin: '1234',
        acceptTimeoutAt: new Date(),
        deliveredAt: new Date(),
      })
      .returning({ id: orders.id });

    await db.transaction(async (tx) => {
      await ledger.recordDeliveryEntries(tx, {
        orderId: order.id,
        vendorId,
        driverId,
        subtotalIqd: SUBTOTAL,
        deliveryFeeIqd: FEE,
        commissionIqd: 0,
        totalIqd: SUBTOTAL + FEE,
      });
    });
    return order.id;
  };

  /**
   * بائع فارغ يعني قيداً يسقط من حساب مستحقات مخبزه — نقص مال صامت لا
   * خطأ ظاهر. الفحص على الجدول كله فيمسك أي كاتب آخر يُغفله.
   */
  it('كل قيد نقد محصَّل يحمل بائعه', async () => {
    await deliveredOrder();
    const orphans = await db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.entryType, LedgerEntryType.CASH_COLLECTED),
          isNull(ledgerEntries.vendorId),
        ),
      );
    expect(orphans).toHaveLength(0);
  });

  /** بائع القيد هو بائع طلبه — التكافؤ الذي يقوم عليه استبدال الانضمام */
  it('بائع القيد يطابق بائع طلبه', async () => {
    await deliveredOrder();
    const rows = await db
      .select({ entryVendor: ledgerEntries.vendorId, orderVendor: orders.vendorId })
      .from(ledgerEntries)
      .innerJoin(orders, eq(orders.id, ledgerEntries.orderId))
      .where(eq(ledgerEntries.entryType, LedgerEntryType.CASH_COLLECTED));

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.entryVendor).toBe(row.orderVendor);
  });

  /** الاتجاهان يقرآن الحقيقة نفسها من طرفين */
  it('ما بذمة السائق لهذا المخبز هو ما يراه المخبز مستحقاً عليه', async () => {
    const orderId = await deliveredOrder();

    const owed = await ledger.driverOwedByVendor(driverId);
    const forVendor = owed.find((v) => v.vendorId === vendorId);
    expect(forVendor?.orderIds).toContain(orderId);

    const outstanding = await ledger.vendorOutstandingByDriver(vendorId);
    const fromDriver = outstanding.find((d) => d.driverId === driverId);
    expect(fromDriver).toBeTruthy();
    expect(fromDriver!.amountIqd).toBe(forVendor!.amountIqd);
  });

  /** التصفية بالبائع تعزل فعلاً: بائع لا قيود له يعيد فارغاً لا كل القيود */
  it('بائع بلا قيود يعيد فارغاً', async () => {
    await deliveredOrder();
    expect(await ledger.vendorOutstandingByDriver(randomUUID())).toEqual([]);
  });
});
