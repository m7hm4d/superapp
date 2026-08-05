import { t } from '@superapp/i18n';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  Input,
  MoneyText,
  Screen,
  Stepper,
} from '@superapp/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { useConfigQuery } from '../src/lib/queries';
import { useAuthStore } from '../src/stores/auth';
import { selectCartSubtotal, useCartStore } from '../src/stores/cart';

/** C-04 السلة: تعديل الكميات، ملاحظة للمخبز، الملخص المالي، ثم إتمام الطلب */
export default function CartScreen() {
  const router = useRouter();
  const configQuery = useConfigQuery();
  const authStatus = useAuthStore((s) => s.status);

  const items = useCartStore((s) => s.items);
  const vendorName = useCartStore((s) => s.vendorNameAr);
  const note = useCartStore((s) => s.note);
  const subtotal = useCartStore(selectCartSubtotal);
  const deliveryFee = configQuery.data?.city?.deliveryFeeIqd ?? 0;
  const total = subtotal + deliveryFee;

  const onCheckout = () => {
    // الضيف يتصفح بحرية؛ تسجيل الدخول يلزم عند إتمام أول طلب (§3)
    if (authStatus !== 'authed') {
      router.push({ pathname: '/auth/login', params: { next: '/checkout' } });
      return;
    }
    router.push('/checkout');
  };

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader title={t('cart', 'title')} />

      {items.length === 0 ? (
        <EmptyState
          title={t('cart', 'empty')}
          body={t('customer', 'browseToOrder')}
          actionTitle={t('customer', 'exploreBakeries')}
          onAction={() => router.replace('/(tabs)')}
        />
      ) : (
        <View className="flex-1">
          <ScrollView
            className="flex-1 px-4 pt-3"
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            {vendorName ? (
              <AppText variant="heading" className="mb-3">
                {vendorName}
              </AppText>
            ) : null}

            {items.map((item) => (
              <Card key={item.productId} className="mb-3">
                <View className="flex-row items-center gap-3">
                  <View className="flex-1">
                    <AppText variant="body">{item.nameAr}</AppText>
                    <MoneyText amountIqd={item.priceIqd * item.qty} className="mt-1" />
                  </View>
                  <Stepper
                    value={item.qty}
                    min={0}
                    max={99}
                    onChange={(next) => useCartStore.getState().setQty(item.productId, next)}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => useCartStore.getState().removeItem(item.productId)}
                    className="min-h-touch min-w-touch items-center justify-center"
                    hitSlop={8}
                  >
                    <AppText variant="caption" className="text-status-cancelled">
                      {t('customer', 'removeItem')}
                    </AppText>
                  </Pressable>
                </View>
              </Card>
            ))}

            <Input
              label={t('order', 'note')}
              placeholder={t('customer', 'notePlaceholder')}
              value={note}
              onChangeText={(text) => useCartStore.getState().setNote(text)}
              multiline
            />

            {/* الملخص المالي */}
            <Card className="mt-4">
              <View className="flex-row justify-between py-1">
                <AppText variant="body">{t('order', 'subtotal')}</AppText>
                <MoneyText amountIqd={subtotal} />
              </View>
              <View className="flex-row justify-between py-1">
                <AppText variant="body">{t('order', 'deliveryFee')}</AppText>
                <MoneyText amountIqd={deliveryFee} />
              </View>
              <View className="mt-1 flex-row justify-between border-t border-surface-muted pt-2">
                <AppText variant="heading">{t('order', 'total')}</AppText>
                <MoneyText amountIqd={total} className="text-brand-600" />
              </View>
            </Card>

            {authStatus !== 'authed' ? (
              <AppText variant="caption" className="mt-3 text-center">
                {t('customer', 'loginToContinue')}
              </AppText>
            ) : null}
          </ScrollView>

          <View className="border-t border-surface-muted bg-surface px-4 py-3">
            <Button title={t('cart', 'checkout')} onPress={onCheckout} />
          </View>
        </View>
      )}
    </Screen>
  );
}
