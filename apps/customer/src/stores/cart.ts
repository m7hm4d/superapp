import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProductView } from '@superapp/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface CartItem {
  productId: string;
  nameAr: string;
  priceIqd: number;
  qty: number;
}

export interface CartVendorRef {
  id: string;
  storeNameAr: string;
  catalogVersion: number;
}

interface CartState {
  vendorId: string | null;
  vendorNameAr: string | null;
  catalogVersion: number | null;
  items: CartItem[];
  note: string;
  setNote: (note: string) => void;
  /** الإضافة تفترض سلة فارغة أو نفس البائع — تبديل البائع يتطلب clear() بعد تأكيد المستخدم (§4) */
  addItem: (vendor: CartVendorRef, item: Omit<CartItem, 'qty'>, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
  /**
   * مزامنة إلزامية بعد CATALOG_CHANGED أو عند إعادة فتح المتجر:
   * تحديث الأسعار/الأسماء وحذف ما لم يعد متاحاً — لا تعديل صامت وقت الإرسال.
   */
  syncCatalog: (vendorId: string, products: ProductView[], catalogVersion: number) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      vendorId: null,
      vendorNameAr: null,
      catalogVersion: null,
      items: [],
      note: '',

      setNote: (note) => set({ note }),

      addItem: (vendor, item, qty = 1) => {
        const state = get();
        if (state.vendorId !== null && state.vendorId !== vendor.id) return;
        const existing = state.items.find((i) => i.productId === item.productId);
        const items = existing
          ? state.items.map((i) =>
              i.productId === item.productId ? { ...i, qty: Math.min(99, i.qty + qty) } : i,
            )
          : [...state.items, { ...item, qty }];
        set({
          vendorId: vendor.id,
          vendorNameAr: vendor.storeNameAr,
          catalogVersion: vendor.catalogVersion,
          items,
        });
      },

      setQty: (productId, qty) => {
        const state = get();
        if (qty <= 0) {
          const items = state.items.filter((i) => i.productId !== productId);
          if (items.length === 0) {
            set({ items: [], vendorId: null, vendorNameAr: null, catalogVersion: null, note: '' });
          } else {
            set({ items });
          }
          return;
        }
        set({
          items: state.items.map((i) =>
            i.productId === productId ? { ...i, qty: Math.min(99, qty) } : i,
          ),
        });
      },

      removeItem: (productId) => get().setQty(productId, 0),

      clear: () =>
        set({ vendorId: null, vendorNameAr: null, catalogVersion: null, items: [], note: '' }),

      syncCatalog: (vendorId, products, catalogVersion) => {
        const state = get();
        if (state.vendorId !== vendorId) return;
        const items: CartItem[] = [];
        for (const item of state.items) {
          const product = products.find((p) => p.id === item.productId);
          if (!product || !product.isAvailable) continue;
          items.push({ ...item, nameAr: product.nameAr, priceIqd: product.priceIqd });
        }
        if (items.length === 0) {
          set({ items: [], vendorId: null, vendorNameAr: null, catalogVersion: null, note: '' });
          return;
        }
        set({ items, catalogVersion });
      },
    }),
    {
      name: 'sa.customer.cart',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export const selectCartCount = (s: Pick<CartState, 'items'>): number =>
  s.items.reduce((sum, i) => sum + i.qty, 0);

export const selectCartSubtotal = (s: Pick<CartState, 'items'>): number =>
  s.items.reduce((sum, i) => sum + i.qty * i.priceIqd, 0);
