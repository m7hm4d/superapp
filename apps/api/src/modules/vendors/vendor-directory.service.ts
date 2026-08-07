import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { vendorProfiles } from '../../db/schema';

/**
 * ما تحتاجه الوحدات الأخرى من ملف البائع — لا الصف كاملاً.
 *
 * الأنواع مشتقّة من المخطط لا مكتوبة يدوياً: كتابة `category: string` تُفقد
 * التعداد فيسقط كل من يفهرس به، وقد سقط فعلاً عند أول محاولة.
 */
type VendorRow = typeof vendorProfiles.$inferSelect;

export interface VendorSummary {
  id: VendorRow['id'];
  userId: VendorRow['userId'];
  storeNameAr: VendorRow['storeNameAr'];
  cityId: VendorRow['cityId'];
  approvalStatus: VendorRow['approvalStatus'];
  /** مفتوح للطلبات الآن — يفحصه مسار إنشاء الطلب */
  isOpen: VendorRow['isOpen'];
  category: VendorRow['category'];
}

/** نقطة الاستلام: ما يحتاجه السائق ليصل إلى المتجر */
export interface VendorPickupPoint {
  id: string;
  storeNameAr: string;
  addressText: string;
  lat: number;
  lng: number;
}

/**
 * منفذ القراءة إلى ملفات البائعين.
 *
 * `vendorProfiles` أكثر جدول مطلوب في المشروع: تلمسه سبع وحدات من ثمان،
 * وإحدى عشرة لمسة مباشرة. فكل تغيير في أعمدته كان يستلزم قراءة المشروع كله،
 * ولا يمكن نقل الجدول ولا الوحدة إلى خدمة مستقلة ما دام الجميع يستعلم عنه.
 *
 * هذا المنفذ يجعل `vendors` الواجهة الوحيدة إليه. والحقول المعلنة هنا هي
 * ما تقرؤه الوحدات فعلاً — استُخرجت من الشيفرة لا من التوقّع، فلا يتسرّب
 * عبر الحدّ ما لا يحتاجه أحد.
 *
 * ملاحظة على النطاق: الاستبدال يبدأ بالاستعلامات **المستقلة**. سبع لمسات
 * أخرى تقع داخل انضمامات SQL، واستبدالها بنداء لكل صف يحوّل استعلاماً
 * واحداً إلى N+1 — تلك تحتاج منفذاً دفعياً وقراراً واعياً، لا استبدالاً
 * آلياً. ولذلك وُجد `summariesFor`.
 */
@Injectable()
export class VendorDirectoryService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  /** ملخّص ببطاقة الملف — أو null إن لم يوجد */
  async summaryFor(vendorProfileId: string): Promise<VendorSummary | null> {
    const [row] = await this.db
      .select(SUMMARY_COLUMNS)
      .from(vendorProfiles)
      .where(eq(vendorProfiles.id, vendorProfileId))
      .limit(1);
    return row ?? null;
  }

  /** ملخّص بحساب صاحبه — أو null إن لم يكن للحساب ملف بائع */
  async summaryForUser(userId: string): Promise<VendorSummary | null> {
    const [row] = await this.db
      .select(SUMMARY_COLUMNS)
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, userId))
      .limit(1);
    return row ?? null;
  }

  /**
   * ملخّصات دفعة واحدة، مفهرسة بالمعرّف.
   *
   * بديل الانضمام حين يُستبدل: استعلام واحد لكل الصفوف ثم ضمٌّ في الذاكرة —
   * لا نداء لكل صف.
   */
  async summariesFor(vendorProfileIds: readonly string[]): Promise<Map<string, VendorSummary>> {
    if (vendorProfileIds.length === 0) return new Map();
    const rows = await this.db
      .select(SUMMARY_COLUMNS)
      .from(vendorProfiles)
      .where(inArray(vendorProfiles.id, [...new Set(vendorProfileIds)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** نقطة الاستلام — الموقع والعنوان معاً كما يحتاجهما مسار السائق */
  async pickupPointFor(vendorProfileId: string): Promise<VendorPickupPoint | null> {
    const [row] = await this.db
      .select({
        id: vendorProfiles.id,
        storeNameAr: vendorProfiles.storeNameAr,
        addressText: vendorProfiles.addressText,
        location: vendorProfiles.location,
      })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.id, vendorProfileId))
      .limit(1);
    if (!row) return null;
    const { location, ...rest } = row;
    return { ...rest, lat: location.lat, lng: location.lng };
  }
}

/** تعريف واحد للأعمدة: منفذ يعيد شكلين مختلفين للملخّص يربك مستهلكيه */
const SUMMARY_COLUMNS = {
  id: vendorProfiles.id,
  userId: vendorProfiles.userId,
  storeNameAr: vendorProfiles.storeNameAr,
  cityId: vendorProfiles.cityId,
  approvalStatus: vendorProfiles.approvalStatus,
  isOpen: vendorProfiles.isOpen,
  category: vendorProfiles.category,
} as const;
