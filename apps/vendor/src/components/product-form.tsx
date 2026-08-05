import React, { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Input, Toggle } from '@superapp/ui';
import { t } from '@superapp/i18n';
import type { ProductView } from '@superapp/shared';

export interface ProductFormValues {
  nameAr: string;
  priceIqd: number;
  section?: string;
  descriptionAr?: string;
  isAvailable: boolean;
}

/** نموذج M-05 المشترك بين الإضافة والتعديل */
export function ProductForm({
  initial,
  submitting,
  submitTitle,
  onSubmit,
}: {
  initial?: ProductView;
  submitting?: boolean;
  submitTitle: string;
  onSubmit: (values: ProductFormValues) => void;
}) {
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? '');
  const [price, setPrice] = useState(initial ? String(initial.priceIqd) : '');
  const [section, setSection] = useState(initial?.section ?? '');
  const [descriptionAr, setDescriptionAr] = useState(initial?.descriptionAr ?? '');
  const [isAvailable, setIsAvailable] = useState(initial?.isAvailable ?? true);
  const [touched, setTouched] = useState(false);

  const priceIqd = Number.parseInt(price.replace(/[^0-9]/g, ''), 10);
  const nameError =
    touched && nameAr.trim().length === 0 ? t('common', 'required') : undefined;
  const priceError =
    touched && (!Number.isFinite(priceIqd) || priceIqd <= 0)
      ? t('vendor', 'priceRequired')
      : undefined;

  return (
    <View className="gap-4">
      <Input
        label={t('vendor', 'productNameAr')}
        value={nameAr}
        onChangeText={setNameAr}
        error={nameError}
      />
      <Input
        label={t('vendor', 'productPrice')}
        value={price}
        onChangeText={setPrice}
        keyboardType="number-pad"
        error={priceError}
      />
      <Input label={t('vendor', 'productSection')} value={section} onChangeText={setSection} />
      <Input
        label={t('vendor', 'productDescription')}
        value={descriptionAr}
        onChangeText={setDescriptionAr}
        multiline
      />
      <View className="flex-row items-center justify-between">
        <AppText variant="body">{t('vendor', 'productAvailableToggle')}</AppText>
        <Toggle value={isAvailable} onValueChange={setIsAvailable} />
      </View>
      <Button
        title={submitTitle}
        loading={submitting}
        onPress={() => {
          setTouched(true);
          if (nameAr.trim().length === 0 || !Number.isFinite(priceIqd) || priceIqd <= 0) return;
          onSubmit({
            nameAr: nameAr.trim(),
            priceIqd,
            section: section.trim() || undefined,
            descriptionAr: descriptionAr.trim() || undefined,
            isAvailable,
          });
        }}
      />
    </View>
  );
}
