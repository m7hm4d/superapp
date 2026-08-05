import React from 'react';
import { Pressable, SectionList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  AppText,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyText,
  Screen,
  Toggle,
  cn,
} from '@superapp/ui';
import { t } from '@superapp/i18n';
import type { ProductView } from '@superapp/shared';
import { api } from '../../src/lib/api';
import { asArray, type VendorProfileView } from '../../src/lib/types';

/** تجميع المنتجات حسب القسم لعرض SectionList */
function groupBySection(products: ProductView[]) {
  const map = new Map<string, ProductView[]>();
  for (const p of products) {
    const key = p.section?.trim() || t('vendor', 'sectionOther');
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

/** M-04 قائمة المنتجات + مفتاح فتح/إغلاق المتجر أعلى الشاشة */
export default function ProductsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: ['vendor-profile'],
    queryFn: () => api.get<VendorProfileView>('vendor/profile'),
  });

  const products = useQuery({
    queryKey: ['vendor-products'],
    queryFn: async () => asArray<ProductView>(await api.get<unknown>('vendor/products'), 'products'),
  });

  const setOpen = useMutation({
    mutationFn: (isOpen: boolean) => api.patch('vendor/profile/open', { isOpen }),
    onMutate: async (isOpen) => {
      await queryClient.cancelQueries({ queryKey: ['vendor-profile'] });
      const prev = queryClient.getQueryData<VendorProfileView>(['vendor-profile']);
      if (prev) queryClient.setQueryData(['vendor-profile'], { ...prev, isOpen });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['vendor-profile'], ctx.prev);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['vendor-profile'] }),
  });

  const setAvailability = useMutation({
    mutationFn: (vars: { id: string; isAvailable: boolean }) =>
      api.patch(`vendor/products/${vars.id}`, { isAvailable: vars.isAvailable }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['vendor-products'] });
      const prev = queryClient.getQueryData<ProductView[]>(['vendor-products']);
      if (prev) {
        queryClient.setQueryData(
          ['vendor-products'],
          prev.map((p) => (p.id === vars.id ? { ...p, isAvailable: vars.isAvailable } : p)),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['vendor-products'], ctx.prev);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['vendor-products'] }),
  });

  const isOpen = profile.data?.isOpen ?? false;

  return (
    <Screen>
      <View className="px-4 pt-4 pb-2 gap-3">
        <AppText variant="title">{t('vendor', 'products')}</AppText>
        {/* حالة المتجر — مثبتة أعلى القائمة */}
        <Card
          className={cn('flex-row items-center justify-between', isOpen ? '' : 'bg-brand-50')}
        >
          <AppText variant="heading">
            {isOpen ? t('vendor', 'storeOpen') : t('vendor', 'storeClosed')}
          </AppText>
          <Toggle
            value={isOpen}
            onValueChange={(v) => setOpen.mutate(v)}
          />
        </Card>
      </View>

      {products.isPending ? (
        <LoadingState />
      ) : products.isError ? (
        <ErrorState onRetry={() => void products.refetch()} />
      ) : products.data.length === 0 ? (
        <EmptyState
          title={t('vendor', 'productsEmpty')}
          body={t('vendor', 'productsEmptyBody')}
          actionTitle={t('vendor', 'addProduct')}
          onAction={() => router.push('/product/new')}
        />
      ) : (
        <SectionList
          sections={groupBySection(products.data)}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 96 }}
          renderSectionHeader={({ section }) => (
            <AppText variant="caption" className="mt-2">
              {section.title}
            </AppText>
          )}
          renderItem={({ item }) => (
            <Card
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
              className="flex-row items-center justify-between gap-3"
            >
              <View className="flex-1 gap-1">
                <AppText variant="body" className={cn(!item.isAvailable && 'opacity-50')}>
                  {item.nameAr}
                </AppText>
                <MoneyText amountIqd={item.priceIqd} />
              </View>
              {/* Quick action: نافد اليوم */}
              <View className="items-center gap-1">
                <AppText variant="caption">
                  {item.isAvailable ? t('vendor', 'availableLabel') : t('vendor', 'outOfStockToday')}
                </AppText>
                <Toggle
                  value={item.isAvailable}
                  onValueChange={(v) => setAvailability.mutate({ id: item.id, isAvailable: v })}
                />
              </View>
            </Card>
          )}
          refreshing={products.isRefetching}
          onRefresh={() => void products.refetch()}
        />
      )}

      {/* FAB إضافة منتج */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('vendor', 'addProduct')}
        onPress={() => router.push('/product/new')}
        className="absolute bottom-6 start-6 bg-brand-600 rounded-full w-14 h-14 items-center justify-center shadow-lg"
      >
        <Ionicons name="add" size={30} color="#ffffff" />
      </Pressable>
    </Screen>
  );
}
