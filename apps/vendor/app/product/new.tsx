import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppText, Screen } from '@superapp/ui';
import { t } from '@superapp/i18n';
import { api } from '../../src/lib/api';
import { ScreenHeader } from '../../src/components/screen-header';
import { ProductForm, type ProductFormValues } from '../../src/components/product-form';

/** M-05 إضافة منتج */
export default function NewProductScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState(false);

  const create = useMutation({
    mutationFn: (values: ProductFormValues) => api.post('vendor/products', values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vendor-products'] });
      router.back();
    },
    onError: () => setError(true),
  });

  return (
    <Screen>
      <ScreenHeader title={t('vendor', 'addProduct')} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View className="gap-4 pb-8">
          {error ? (
            <AppText variant="caption" className="text-status-cancelled">
              {t('common', 'error')}
            </AppText>
          ) : null}
          <ProductForm
            submitTitle={t('common', 'save')}
            submitting={create.isPending}
            onSubmit={(values) => {
              setError(false);
              create.mutate(values);
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
