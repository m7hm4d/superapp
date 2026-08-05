import { formatIQD, t } from '@superapp/i18n';
import type { ProductView } from '@superapp/shared';
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyText,
  Screen,
  Stepper,
} from '@superapp/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { Alert, Pressable, SectionList, View } from 'react-native';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useStoreQuery } from '../../src/lib/queries';
import type { StoreView } from '../../src/lib/types';
import {
  selectCartCount,
  selectCartSubtotal,
  useCartStore,
  type CartVendorRef,
} from '../../src/stores/cart';

function ProductRow({
  product,
  store,
}: {
  product: ProductView;
  store: StoreView;
}) {
  const qty = useCartStore(
    (s) => s.items.find((i) => i.productId === product.id)?.qty ?? 0,
  );
  const cartVendorId = useCartStore((s) => s.vendorId);
  const cartVendorName = useCartStore((s) => s.vendorNameAr);

  const vendorRef: CartVendorRef = {
    id: store.vendor.id,
    storeNameAr: store.vendor.storeNameAr,
    catalogVersion: store.catalogVersion,
  };

  const doAdd = () => {
    useCartStore.getState().addItem(vendorRef, {
      productId: product.id,
      nameAr: product.nameAr,
      priceIqd: product.priceIqd,
    });
  };

  // تبديل البائع = حوار تأكيد إفراغ السلة (§4) — لا استبدال صامت
  const onAdd = () => {
    if (cartVendorId !== null && cartVendorId !== store.vendor.id) {
      Alert.alert(
        t('customer', 'switchVendorTitle'),
        t('customer', 'switchVendorBody', {
          current: cartVendorName ?? '',
          next: store.vendor.storeNameAr,
        }),
        [
          { text: t('common', 'cancel'), style: 'cancel' },
          {
            text: t('customer', 'switchVendorConfirm'),
            style: 'destructive',
            onPress: () => {
              useCartStore.getState().clear();
              doAdd();
            },
          },
        ],
      );
      return;
    }
    doAdd();
  };

  return (
    <Card className="mb-3">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <AppText variant="body">{product.nameAr}</AppText>
          {product.descriptionAr ? (
            <AppText variant="caption" className="mt-0.5">
              {product.descriptionAr}
            </AppText>
          ) : null}
          <MoneyText amountIqd={product.priceIqd} className="mt-1" />
        </View>
        {!product.isAvailable ? (
          <Chip label={t('customer', 'unavailable')} />
        ) : qty > 0 ? (
          <Stepper
            value={qty}
            min={0}
            max={99}
            onChange={(next) => useCartStore.getState().setQty(product.id, next)}
          />
        ) : (
          <Button title={t('cart', 'addToCart')} variant="secondary" onPress={onAdd} />
        )}
      </View>
    </Card>
  );
}

/** C-03 متجر المخبز: رأس المتجر، منتجات مجمعة بالأقسام، شريط سلة عائم */
export default function StoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const storeQuery = useStoreQuery(id);
  const store = storeQuery.data;

  const cartVendorId = useCartStore((s) => s.vendorId);
  const cartCount = useCartStore(selectCartCount);
  const cartSubtotal = useCartStore(selectCartSubtotal);
  const showCartBar = cartCount > 0 && cartVendorId === id;

  // مزامنة السلة مع الكتالوج الأحدث (أسعار/توفر/catalogVersion)
  useEffect(() => {
    if (store && cartVendorId === store.vendor.id) {
      useCartStore.getState().syncCatalog(store.vendor.id, store.products, store.catalogVersion);
    }
  }, [store, cartVendorId]);

  const sections = useMemo(() => {
    if (!store) return [];
    const groups = new Map<string, ProductView[]>();
    for (const product of store.products) {
      const key = product.section?.trim() || t('customer', 'sectionOther');
      const list = groups.get(key) ?? [];
      list.push(product);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([title, data]) => ({ title, data }));
  }, [store]);

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader title={store?.vendor.storeNameAr ?? t('map', 'nearbyBakeries')} />

      {storeQuery.isLoading ? (
        <LoadingState />
      ) : storeQuery.isError || !store ? (
        <ErrorState onRetry={() => void storeQuery.refetch()} />
      ) : (
        <View className="flex-1">
          {/* رأس المتجر */}
          <View className="bg-surface px-4 pb-3">
            <View className="flex-row items-center gap-2">
              <AppText variant="caption" className="flex-1">
                {store.vendor.addressText}
              </AppText>
              <Chip
                label={store.vendor.isOpen ? t('map', 'open') : t('map', 'closed')}
                selected={store.vendor.isOpen}
              />
            </View>
            {!store.vendor.isOpen ? (
              <View className="mt-2 rounded-card bg-status-cancelled/10 p-3">
                <AppText variant="caption" className="text-status-cancelled">
                  {t('customer', 'storeClosedNow')}
                </AppText>
              </View>
            ) : null}
          </View>

          {sections.length === 0 ? (
            <EmptyState title={t('customer', 'storeEmpty')} />
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <ProductRow product={item} store={store} />}
              renderSectionHeader={({ section }) => (
                <AppText variant="heading" className="mb-2 mt-3">
                  {section.title}
                </AppText>
              )}
              stickySectionHeadersEnabled={false}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingBottom: showCartBar ? 96 : 24,
              }}
              showsVerticalScrollIndicator={false}
            />
          )}

          {/* شريط السلة العائم: العدد + الإجمالي + CTA السلة */}
          {showCartBar ? (
            <View className="absolute inset-x-4 bottom-4">
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/cart')}
                className="min-h-touch flex-row items-center justify-between rounded-card bg-brand-500 px-4 py-3"
              >
                <AppText variant="body" className="text-white">
                  {t('customer', 'itemsCount', { n: cartCount })}
                </AppText>
                <AppText variant="heading" className="text-white">
                  {t('customer', 'cartBarCta')} — {formatIQD(cartSubtotal)}
                </AppText>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
