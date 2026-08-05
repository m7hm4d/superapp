import { t } from '@superapp/i18n';
import { MapView } from '@superapp/map';
import type { CreateOrderInput, OrderView } from '@superapp/shared';
import {
  AppText,
  Button,
  Card,
  Input,
  MoneyText,
  Screen,
} from '@superapp/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { api, apiErrorCode, apiErrorMessage } from '../src/lib/api';
import { toLocalPhone } from '../src/lib/format';
import { useConfigQuery } from '../src/lib/queries';
import { useAuthStore } from '../src/stores/auth';
import { selectCartSubtotal, useCartStore } from '../src/stores/cart';

/** C-05 إتمام الطلب: دبوس عنوان قابل للسحب + COD واضح + مراجعة نهائية */
export default function CheckoutScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const configQuery = useConfigQuery();
  const user = useAuthStore((s) => s.user);
  const authStatus = useAuthStore((s) => s.status);

  const vendorId = useCartStore((s) => s.vendorId);
  const vendorName = useCartStore((s) => s.vendorNameAr);
  const catalogVersion = useCartStore((s) => s.catalogVersion);
  const items = useCartStore((s) => s.items);
  const note = useCartStore((s) => s.note);
  const subtotal = useCartStore(selectCartSubtotal);

  const city = configQuery.data?.city ?? null;
  const deliveryFee = city?.deliveryFeeIqd ?? 0;
  const total = subtotal + deliveryFee;

  const initialCenter = useMemo(
    () => (city ? { lat: city.centerLat, lng: city.centerLng } : { lat: 33.3152, lng: 44.3661 }),
    [city],
  );
  const [location, setLocation] = useState(initialCenter);
  const [addressText, setAddressText] = useState('');
  const [landmark, setLandmark] = useState('');
  const [contactPhone, setContactPhone] = useState(user ? toLocalPhone(user.phone) : '');
  const [addressError, setAddressError] = useState<string | undefined>(undefined);

  const placeOrder = useMutation({
    mutationFn: (input: CreateOrderInput) => api.post<OrderView>('orders', input),
    onSuccess: (order) => {
      useCartStore.getState().clear();
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.setQueryData(['order', order.id], order);
      // C-06: حالة النجاح تظهر كبانر أعلى شاشة التتبع في أول زيارة
      router.replace({ pathname: '/order/[id]', params: { id: order.id, placed: '1' } });
    },
    onError: (error: unknown) => {
      const code = apiErrorCode(error);
      if (code === 'CATALOG_CHANGED') {
        // مراجعة إلزامية: لا تعديل صامت للطلب (§4)
        Alert.alert(
          t('customer', 'catalogChangedTitle'),
          t('customer', 'catalogChangedBody'),
          [
            {
              text: t('customer', 'reviewCart'),
              onPress: () => {
                void queryClient.invalidateQueries({ queryKey: ['store', vendorId] });
                if (vendorId) {
                  router.replace(`/store/${vendorId}`);
                } else {
                  router.back();
                }
              },
            },
          ],
          { cancelable: false },
        );
        return;
      }
      if (code === 'VENDOR_CLOSED') {
        Alert.alert(t('map', 'closed'), t('customer', 'vendorClosedError'));
        return;
      }
      if (code === 'OUT_OF_SERVICE_AREA') {
        Alert.alert(t('customer', 'deliveryAddress'), t('customer', 'outOfServiceArea'));
        return;
      }
      Alert.alert(t('common', 'error'), apiErrorMessage(error) ?? t('common', 'error'));
    },
  });

  if (authStatus === 'guest') {
    return <Redirect href={{ pathname: '/auth/login', params: { next: '/checkout' } }} />;
  }
  if (!vendorId || items.length === 0) {
    return <Redirect href="/cart" />;
  }

  const submit = () => {
    if (addressText.trim().length < 2) {
      setAddressError(t('customer', 'addressPlaceholder'));
      return;
    }
    setAddressError(undefined);
    placeOrder.mutate({
      vendorId,
      items: items.map((i) => ({ productId: i.productId, quantity: i.qty })),
      delivery: {
        location,
        addressText: addressText.trim(),
        landmark: landmark.trim() ? landmark.trim() : undefined,
        contactPhone: contactPhone.trim(),
      },
      note: note.trim() ? note.trim() : undefined,
      catalogVersion: catalogVersion ?? undefined,
    });
  };

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader title={t('customer', 'checkoutTitle')} />
      <ScrollView
        className="flex-1 px-4 pt-3"
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* عنوان التوصيل: خريطة مصغرة بدبوس ثابت في المنتصف والخريطة تتحرك تحته */}
        <AppText variant="heading" className="mb-2">
          {t('customer', 'deliveryAddress')}
        </AppText>
        <View className="h-56 overflow-hidden rounded-card">
          <MapView
            center={initialCenter}
            zoom={15}
            showUserLocation
            onRegionChange={(c) => setLocation({ lat: c.lat, lng: c.lng })}
            style={{ flex: 1 }}
          />
          <View pointerEvents="none" className="absolute inset-0 items-center justify-center pb-6">
            <Ionicons name="location" size={40} color="#ed7320" />
          </View>
        </View>
        <AppText variant="caption" className="mt-2">
          {t('customer', 'moveMapHint')}
        </AppText>

        <View className="mt-3 gap-3">
          <Input
            label={t('customer', 'addressText')}
            placeholder={t('customer', 'addressPlaceholder')}
            value={addressText}
            onChangeText={setAddressText}
            error={addressError}
          />
          <Input
            label={t('map', 'landmark')}
            value={landmark}
            onChangeText={setLandmark}
          />
          <Input
            label={t('customer', 'contactPhone')}
            placeholder={t('auth', 'phonePlaceholder')}
            value={contactPhone}
            onChangeText={setContactPhone}
            keyboardType="phone-pad"
          />
        </View>

        {/* COD واضح قبل التأكيد */}
        <Card className="mt-4 bg-brand-50">
          <View className="flex-row items-center gap-2">
            <Ionicons name="cash-outline" size={22} color="#b84414" />
            <AppText variant="heading" className="flex-1 text-brand-700">
              {t('order', 'codNotice')}
            </AppText>
            <MoneyText amountIqd={total} className="text-brand-700" />
          </View>
        </Card>

        {/* المراجعة النهائية */}
        <AppText variant="heading" className="mb-2 mt-4">
          {t('customer', 'finalReview')}
        </AppText>
        <Card>
          {vendorName ? (
            <AppText variant="body" className="mb-2">
              {vendorName}
            </AppText>
          ) : null}
          {items.map((item) => (
            <View key={item.productId} className="flex-row justify-between py-1">
              <AppText variant="caption" className="flex-1">
                {item.nameAr} × {item.qty}
              </AppText>
              <MoneyText amountIqd={item.priceIqd * item.qty} />
            </View>
          ))}
          <View className="mt-2 border-t border-surface-muted pt-2">
            <View className="flex-row justify-between py-0.5">
              <AppText variant="caption">{t('order', 'subtotal')}</AppText>
              <MoneyText amountIqd={subtotal} />
            </View>
            <View className="flex-row justify-between py-0.5">
              <AppText variant="caption">{t('order', 'deliveryFee')}</AppText>
              <MoneyText amountIqd={deliveryFee} />
            </View>
            <View className="flex-row justify-between py-0.5">
              <AppText variant="heading">{t('order', 'total')}</AppText>
              <MoneyText amountIqd={total} className="text-brand-600" />
            </View>
          </View>
        </Card>
      </ScrollView>

      <View className="border-t border-surface-muted bg-surface px-4 py-3">
        <Button
          title={t('customer', 'placeOrder')}
          onPress={submit}
          loading={placeOrder.isPending}
          disabled={placeOrder.isPending}
        />
      </View>
    </Screen>
  );
}
