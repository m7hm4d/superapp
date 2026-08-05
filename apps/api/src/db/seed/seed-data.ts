import { FeatureFlagKey, OrderStatus } from '@superapp/shared';

/** بيانات الـ seed الثابتة — تُستهلك من seed.ts فقط */

export const TENANT_NAME_AR = 'المشغل الافتراضي';

export const CITY_SEED = {
  nameAr: 'بغداد — الكرادة',
  center: { lat: 33.306, lng: 44.426 },
  serviceRadiusKm: 15,
  visibilityRadiusKm: 5,
  deliveryFeeIqd: 2000,
  vendorAcceptTimeoutMin: 10,
  batchWindowSec: 75,
  batchOfferTtlSec: 60,
} as const;

export const FLAG_SEED: { key: FeatureFlagKey; enabled: boolean; value: string | null }[] = [
  { key: FeatureFlagKey.CATEGORY_BAKERY, enabled: true, value: null },
  { key: FeatureFlagKey.CATEGORY_VEGETABLES, enabled: false, value: null },
  { key: FeatureFlagKey.CATEGORY_MARKET, enabled: false, value: null },
  { key: FeatureFlagKey.CATEGORY_CONSTRUCTION, enabled: false, value: null },
  { key: FeatureFlagKey.AUTH_OTP, enabled: false, value: null },
  { key: FeatureFlagKey.CUSTOMER_LIVE_TRACKING, enabled: false, value: null },
  { key: FeatureFlagKey.BATCH_MAX_SIZE, enabled: true, value: '{"max":3}' },
];

/**
 * لا كلمة مرور للأدمن هنا عمداً — الاعتماديات الإدارية لا تُنشر في المستودع.
 * المصدر: SEED_ADMIN_PASSWORD عند تشغيل الـ seed، أو توليد عشوائي يُطبع مرة واحدة (seed.ts §3).
 */
export const ADMIN_SEED = {
  phone: '+9647700000001',
  fullName: 'مدير المنصة',
  email: 'admin@superapp.local',
} as const;

export const VENDOR_PASSWORD = 'Vendor#12345';
export const DRIVER_PASSWORD = 'Driver#12345';
export const CUSTOMER_PASSWORD = 'Customer#12345';

export interface ProductSeed {
  nameAr: string;
  section: string;
  priceIqd: number;
  descriptionAr?: string;
}

/** كتالوج المنتجات الأساسي — كل بائع يأخذ شريحة منه (6–8 منتجات) */
export const PRODUCT_CATALOG: ProductSeed[] = [
  { nameAr: 'صمون حجري', section: 'خبز', priceIqd: 250, descriptionAr: 'صمون حجري طازج' },
  { nameAr: 'خبز تنور', section: 'خبز', priceIqd: 500, descriptionAr: 'خبز تنور حار' },
  { nameAr: 'صمون سمسم', section: 'خبز', priceIqd: 350, descriptionAr: 'صمون مغطى بالسمسم' },
  { nameAr: 'خبز شعير', section: 'خبز', priceIqd: 750, descriptionAr: 'خبز شعير صحي' },
  { nameAr: 'بقصم', section: 'خبز', priceIqd: 1500, descriptionAr: 'بقصم مقرمش' },
  { nameAr: 'كليجة', section: 'معجنات', priceIqd: 5000, descriptionAr: 'علبة كليجة بالتمر والجوز' },
  { nameAr: 'كعك بالتمر', section: 'معجنات', priceIqd: 4000, descriptionAr: 'كعك محشو بالتمر' },
  { nameAr: 'معجنات جبن', section: 'معجنات', priceIqd: 1000, descriptionAr: 'معجنات محشوة بالجبن' },
];

export interface VendorSeed {
  phone: string;
  storeNameAr: string;
  ownerNameAr: string;
  lat: number;
  lng: number;
  addressText: string;
  /** عدد المنتجات من بداية الكتالوج (6–8) */
  productCount: number;
}

export const APPROVED_VENDORS: VendorSeed[] = [
  {
    phone: '+9647701000001',
    storeNameAr: 'مخبز الكرادة',
    ownerNameAr: 'صاحب مخبز الكرادة',
    lat: 33.306,
    lng: 44.426,
    addressText: 'الكرادة داخل، قرب ساحة كهرمانة',
    productCount: 8,
  },
  {
    phone: '+9647701000002',
    storeNameAr: 'أفران المنصور',
    ownerNameAr: 'صاحب أفران المنصور',
    lat: 33.3239,
    lng: 44.3396,
    addressText: 'المنصور، شارع الأميرات',
    productCount: 7,
  },
  {
    phone: '+9647701000003',
    storeNameAr: 'مخبز الأعظمية',
    ownerNameAr: 'صاحب مخبز الأعظمية',
    lat: 33.368,
    lng: 44.372,
    addressText: 'الأعظمية، قرب جامع الإمام الأعظم',
    productCount: 6,
  },
  {
    phone: '+9647701000004',
    storeNameAr: 'أفران زيونة',
    ownerNameAr: 'صاحب أفران زيونة',
    lat: 33.335,
    lng: 44.448,
    addressText: 'زيونة، شارع الربيعي',
    productCount: 8,
  },
  {
    phone: '+9647701000005',
    storeNameAr: 'مخبز الكاظمية',
    ownerNameAr: 'صاحب مخبز الكاظمية',
    lat: 33.38,
    lng: 44.34,
    addressText: 'الكاظمية، قرب الصحن الشريف',
    productCount: 7,
  },
  {
    phone: '+9647701000006',
    storeNameAr: 'أفران باب الشرقي',
    ownerNameAr: 'صاحب أفران باب الشرقي',
    lat: 33.332,
    lng: 44.403,
    addressText: 'باب الشرقي، قرب حديقة الأمة',
    productCount: 6,
  },
];

export const PENDING_VENDOR: VendorSeed = {
  phone: '+9647701000099',
  storeNameAr: 'مخبز قيد المراجعة',
  ownerNameAr: 'صاحب مخبز قيد المراجعة',
  lat: 33.31,
  lng: 44.43,
  addressText: 'الكرادة، شارع 62',
  productCount: 0,
};

export interface DriverSeed {
  phone: string;
  fullName: string;
  approved: boolean;
}

export const DRIVERS: DriverSeed[] = [
  { phone: '+9647702000001', fullName: 'كرار حسين', approved: true },
  { phone: '+9647702000002', fullName: 'حسنين كريم', approved: true },
  { phone: '+9647702000003', fullName: 'مصطفى جاسم', approved: false },
];

export interface CustomerSeed {
  phone: string;
  fullName: string;
  address: {
    label: string;
    lat: number;
    lng: number;
    addressText: string;
    landmark: string;
  };
}

export const CUSTOMERS: CustomerSeed[] = [
  {
    phone: '+9647703000001',
    fullName: 'أحمد محمد',
    address: {
      label: 'المنزل',
      lat: 33.3085,
      lng: 44.4275,
      addressText: 'الكرادة داخل، حي الوحدة، زقاق 14',
      landmark: 'قرب ساحة كهرمانة',
    },
  },
  {
    phone: '+9647703000002',
    fullName: 'فاطمة علي',
    address: {
      label: 'المنزل',
      lat: 33.302,
      lng: 44.43,
      addressText: 'الكرادة، حي بابل، دار 22',
      landmark: 'مقابل الحديقة العامة',
    },
  },
  {
    phone: '+9647703000003',
    fullName: 'علي حسن',
    address: {
      label: 'المنزل',
      lat: 33.311,
      lng: 44.421,
      addressText: 'شارع أبو نؤاس، عمارة النخيل، شقة 5',
      landmark: 'قرب كورنيش أبو نؤاس',
    },
  },
];

export interface OrderItemSpec {
  productNameAr: string;
  quantity: number;
}

export interface OrderSpec {
  /** هاتف البائع (مفتاح ربط) */
  vendorPhone: string;
  /** هاتف العميل (مفتاح ربط) */
  customerPhone: string;
  status: OrderStatus;
  items: OrderItemSpec[];
  /** عمر الطلب بالدقائق (قبل الآن) */
  createdMinutesAgo: number;
  note?: string;
  cancelledReason?: string;
}

/**
 * طلبات العرض التجريبي:
 * 2 PENDING_BAKERY، 1 PREPARING، 2 READY (كلاهما من مخبز الكرادة لعرض دفعات M2)،
 * 1 DELIVERED، 1 CANCELLED.
 */
export const ORDER_SPECS: OrderSpec[] = [
  {
    vendorPhone: '+9647701000001',
    customerPhone: '+9647703000001',
    status: OrderStatus.PENDING_BAKERY,
    items: [
      { productNameAr: 'صمون حجري', quantity: 10 },
      { productNameAr: 'خبز تنور', quantity: 2 },
    ],
    createdMinutesAgo: 5,
    note: 'الرجاء صمون حار',
  },
  {
    vendorPhone: '+9647701000002',
    customerPhone: '+9647703000002',
    status: OrderStatus.PENDING_BAKERY,
    items: [
      { productNameAr: 'صمون سمسم', quantity: 6 },
      { productNameAr: 'كليجة', quantity: 1 },
    ],
    createdMinutesAgo: 3,
  },
  {
    vendorPhone: '+9647701000003',
    customerPhone: '+9647703000003',
    status: OrderStatus.PREPARING,
    items: [
      { productNameAr: 'خبز تنور', quantity: 4 },
      { productNameAr: 'بقصم', quantity: 1 },
    ],
    createdMinutesAgo: 15,
  },
  {
    vendorPhone: '+9647701000001',
    customerPhone: '+9647703000001',
    status: OrderStatus.READY,
    items: [{ productNameAr: 'صمون حجري', quantity: 20 }],
    createdMinutesAgo: 30,
  },
  {
    vendorPhone: '+9647701000001',
    customerPhone: '+9647703000002',
    status: OrderStatus.READY,
    items: [
      { productNameAr: 'خبز تنور', quantity: 3 },
      { productNameAr: 'كعك بالتمر', quantity: 1 },
    ],
    createdMinutesAgo: 25,
  },
  {
    vendorPhone: '+9647701000004',
    customerPhone: '+9647703000003',
    status: OrderStatus.DELIVERED,
    items: [
      { productNameAr: 'كليجة', quantity: 2 },
      { productNameAr: 'صمون حجري', quantity: 8 },
    ],
    createdMinutesAgo: 180,
  },
  {
    vendorPhone: '+9647701000005',
    customerPhone: '+9647703000001',
    status: OrderStatus.CANCELLED,
    items: [{ productNameAr: 'خبز شعير', quantity: 2 }],
    createdMinutesAgo: 240,
    cancelledReason: 'نفاد الخبز لهذا اليوم',
  },
];
