import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@superapp/i18n';
import type { ScanKind } from '@superapp/shared';
import { AppText } from '../text';
import { cn } from '../cn';
import { ScannerSheet } from './scanner-sheet';

export interface ScanPinButtonProps {
  kind: ScanKind;
  /** العملية المفتوحة — باركود غيرها يُرفض قبل الإرسال */
  expectedId?: string;
  /** يُستدعى بالرمز المستخرج؛ الشاشة ترسله كما لو أُدخل يدوياً */
  onScanned: (pin: string) => void;
  className?: string;
}

/**
 * أيقونة مسح بجانب إدخال الرمز: الطريق السريع، والإدخال اليدوي يبقى
 * كما هو للحالات التي يتعذر فيها المسح (كاميرا معطّلة، شاشة مكسورة، إضاءة).
 */
export function ScanPinButton({ kind, expectedId, onScanned, className }: ScanPinButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <View className={cn('items-center', className)}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('common', 'scanButton')}
        className="flex-row items-center gap-2 rounded-full bg-brand-600 px-5 py-3"
      >
        <Ionicons name="qr-code-outline" size={20} color="#ffffff" />
        <AppText className="font-medium text-white">{t('common', 'scanButton')}</AppText>
      </Pressable>
      <AppText variant="caption" className="mt-2 text-neutral-500">
        {t('common', 'scanOrType')}
      </AppText>

      <ScannerSheet
        visible={open}
        onClose={() => setOpen(false)}
        kind={kind}
        expectedId={expectedId}
        onScanned={(pin) => {
          setOpen(false);
          onScanned(pin);
        }}
        labels={{
          title: t('common', 'scanTitle'),
          hint: t('common', 'scanHint'),
          permissionPrompt: t('common', 'scanPermission'),
          permissionAction: t('common', 'scanPermissionAction'),
          wrongTarget: t('common', 'scanWrongTarget'),
          wrongKind: t('common', 'scanWrongKind'),
          close: t('common', 'cancel'),
        }}
      />
    </View>
  );
}
