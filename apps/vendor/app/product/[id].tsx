import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText, Button, ErrorState, LoadingState, Screen } from '@superapp/ui';
import { t } from '@superapp/i18n';
import type { ProductView } from '@superapp/shared';
import { api } from '../../src/lib/api';
import { asArray } from '../../src/lib/types';
import { ScreenHeader } from '../../src/components/screen-header';
import { ProductForm, type ProductFormValues } from '../../src/components/product-form';
import { ConfirmDialog } from '../../src/components/dialogs';

/** M-05 تعديل/حذف منتج */
export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState(false);

  const query = useQuery({
    queryKey: ['vendor-products'],
    queryFn: async () => asArray<ProductView>(await api.get<unknown>('vendor/products'), 'products'),
  });
  const product = query.data?.find((p) => p.id === id);

  const update = useMutation({
    mutationFn: (values: ProductFormValues) => api.patch(`vendor/products/${id}`, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vendor-products'] });
      router.back();
    },
    onError: () => setError(true),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`vendor/products/${id}`),
    onSuccess: () => {
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['vendor-products'] });
      router.back();
    },
    onError: () => {
      setDeleteOpen(false);
      setError(true);
    },
  });

  return (
    <Screen>
      <ScreenHeader title={t('vendor', 'editProduct')} />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError || !product ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View className="gap-4 pb-8">
            {error ? (
              <AppText variant="caption" className="text-status-cancelled">
                {t('common', 'error')}
              </AppText>
            ) : null}
            <ProductForm
              initial={product}
              submitTitle={t('common', 'save')}
              submitting={update.isPending}
              onSubmit={(values) => {
                setError(false);
                update.mutate(values);
              }}
            />
            <Button
              title={t('vendor', 'deleteProduct')}
              variant="danger"
              onPress={() => setDeleteOpen(true)}
            />
          </View>
        </ScrollView>
      )}

      <ConfirmDialog
        visible={deleteOpen}
        title={t('vendor', 'deleteProduct')}
        body={t('vendor', 'deleteProductConfirm')}
        confirmTitle={t('common', 'delete')}
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </Screen>
  );
}
