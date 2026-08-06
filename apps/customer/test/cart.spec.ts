import type { ProductView } from '@superapp/shared';
import { selectCartCount, selectCartSubtotal, useCartStore } from '../src/stores/cart';

const VENDOR = { id: 'v1', storeNameAr: 'مخبز الكرادة', catalogVersion: 1 };
const OTHER = { id: 'v2', storeNameAr: 'مخبز الجادرية', catalogVersion: 1 };

const product = (id: string, priceIqd = 1000) => ({
  productId: id,
  nameAr: `منتج ${id}`,
  priceIqd,
});

const catalog = (over: Partial<ProductView>[] = []): ProductView[] =>
  over as unknown as ProductView[];

beforeEach(() => {
  useCartStore.getState().clear();
});

describe('سلة العميل', () => {
  it('تضيف صنفاً وتثبّت البائع معه', () => {
    useCartStore.getState().addItem(VENDOR, product('p1'), 2);
    const s = useCartStore.getState();
    expect(s.vendorId).toBe('v1');
    expect(s.vendorNameAr).toBe('مخبز الكرادة');
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ productId: 'p1', qty: 2 });
  });

  it('تجمع الكمية عند إعادة إضافة الصنف نفسه', () => {
    const { addItem } = useCartStore.getState();
    addItem(VENDOR, product('p1'), 2);
    addItem(VENDOR, product('p1'), 3);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0]?.qty).toBe(5);
  });

  /**
   * قاعدة §4: سلة واحدة لبائع واحد. الإضافة من بائع آخر تُرفض بصمت،
   * والتبديل يمرّ بـclear() بعد تأكيد المستخدم — لا خلط طلبين في سلة.
   */
  it('ترفض صنفاً من بائع آخر وتُبقي السلة كما هي', () => {
    const { addItem } = useCartStore.getState();
    addItem(VENDOR, product('p1'));
    addItem(OTHER, product('p9'));
    const s = useCartStore.getState();
    expect(s.vendorId).toBe('v1');
    expect(s.items.map((i) => i.productId)).toEqual(['p1']);
  });

  it('تقبل بائعاً جديداً بعد clear()', () => {
    const { addItem, clear } = useCartStore.getState();
    addItem(VENDOR, product('p1'));
    clear();
    useCartStore.getState().addItem(OTHER, product('p9'));
    expect(useCartStore.getState().vendorId).toBe('v2');
  });

  it('تسقف الكمية عند 99', () => {
    const { addItem } = useCartStore.getState();
    addItem(VENDOR, product('p1'), 90);
    addItem(VENDOR, product('p1'), 50);
    expect(useCartStore.getState().items[0]?.qty).toBe(99);
    useCartStore.getState().setQty('p1', 500);
    expect(useCartStore.getState().items[0]?.qty).toBe(99);
  });

  it('تحذف الصنف عند كمية صفر أو أقل', () => {
    const { addItem } = useCartStore.getState();
    addItem(VENDOR, product('p1'));
    addItem(VENDOR, product('p2'));
    useCartStore.getState().setQty('p1', 0);
    expect(useCartStore.getState().items.map((i) => i.productId)).toEqual(['p2']);
  });

  /** إفراغ آخر صنف يحرّر البائع أيضاً، وإلا بقيت سلة فارغة مربوطة بمخبز */
  it('تُحرّر البائع والملاحظة حين يُحذف آخر صنف', () => {
    const { addItem, setNote } = useCartStore.getState();
    addItem(VENDOR, product('p1'));
    setNote('بلا سمسم');
    useCartStore.getState().removeItem('p1');
    const s = useCartStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.vendorId).toBeNull();
    expect(s.note).toBe('');
  });

  describe('syncCatalog', () => {
    it('تحدّث الاسم والسعر من الكتالوج الجديد', () => {
      useCartStore.getState().addItem(VENDOR, product('p1', 1000), 2);
      useCartStore.getState().syncCatalog('v1', catalog([
        { id: 'p1', nameAr: 'صمون جديد', priceIqd: 1500, isAvailable: true },
      ]), 2);
      const item = useCartStore.getState().items[0];
      expect(item).toMatchObject({ nameAr: 'صمون جديد', priceIqd: 1500, qty: 2 });
      expect(useCartStore.getState().catalogVersion).toBe(2);
    });

    /** التعديل الصامت وقت الإرسال هو ما تمنعه هذه المزامنة */
    it('تحذف ما لم يعد متاحاً', () => {
      const { addItem } = useCartStore.getState();
      addItem(VENDOR, product('p1'));
      addItem(VENDOR, product('p2'));
      useCartStore.getState().syncCatalog('v1', catalog([
        { id: 'p1', nameAr: 'صمون', priceIqd: 1000, isAvailable: true },
        { id: 'p2', nameAr: 'كعك', priceIqd: 2000, isAvailable: false },
      ]), 2);
      expect(useCartStore.getState().items.map((i) => i.productId)).toEqual(['p1']);
    });

    it('تُفرغ السلة وتحرّر البائع حين لا يبقى صنف متاح', () => {
      useCartStore.getState().addItem(VENDOR, product('p1'));
      useCartStore.getState().syncCatalog('v1', catalog([
        { id: 'p1', nameAr: 'صمون', priceIqd: 1000, isAvailable: false },
      ]), 2);
      const s = useCartStore.getState();
      expect(s.items).toHaveLength(0);
      expect(s.vendorId).toBeNull();
    });

    it('تتجاهل مزامنة بائع آخر', () => {
      useCartStore.getState().addItem(VENDOR, product('p1'));
      useCartStore.getState().syncCatalog('v2', catalog([]), 5);
      expect(useCartStore.getState().items).toHaveLength(1);
      expect(useCartStore.getState().catalogVersion).toBe(1);
    });
  });

  describe('المحدِّدات', () => {
    it('تحسب العدد والمجموع', () => {
      const { addItem } = useCartStore.getState();
      addItem(VENDOR, product('p1', 1000), 2);
      addItem(VENDOR, product('p2', 2500), 3);
      const s = useCartStore.getState();
      expect(selectCartCount(s)).toBe(5);
      expect(selectCartSubtotal(s)).toBe(2 * 1000 + 3 * 2500);
    });

    it('تعطي صفراً لسلة فارغة', () => {
      const s = useCartStore.getState();
      expect(selectCartCount(s)).toBe(0);
      expect(selectCartSubtotal(s)).toBe(0);
    });
  });
});
