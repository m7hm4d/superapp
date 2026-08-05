import React, { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { AppText, Button, Input } from '@superapp/ui';
import { t } from '@superapp/i18n';

function ModalShell({
  visible,
  onRequestClose,
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <Pressable
        className="flex-1 bg-black/50 justify-center px-6"
        onPress={onRequestClose}
        accessibilityLabel={t('common', 'close')}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View className="bg-surface rounded-sheet p-5 gap-4">{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** حوار تأكيد عام (حذف منتج، إلخ) */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmTitle,
  danger,
  loading,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmTitle?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalShell visible={visible} onRequestClose={onCancel}>
      <AppText variant="heading">{title}</AppText>
      {body ? <AppText variant="body">{body}</AppText> : null}
      <View className="gap-2">
        <Button
          title={confirmTitle ?? t('common', 'confirm')}
          variant={danger ? 'danger' : 'primary'}
          loading={loading}
          onPress={onConfirm}
        />
        <Button title={t('common', 'cancel')} variant="ghost" onPress={onCancel} />
      </View>
    </ModalShell>
  );
}

/** حوار سبب إلزامي (رفض طلب / نزاع تسوية) */
export function ReasonDialog({
  visible,
  title,
  placeholder,
  submitTitle,
  loading,
  error,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  submitTitle?: string;
  loading?: boolean;
  error?: string;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setReason('');
      setTouched(false);
    }
  }, [visible]);

  const trimmed = reason.trim();
  const localError = touched && trimmed.length < 2 ? t('vendor', 'reasonRequired') : undefined;

  return (
    <ModalShell visible={visible} onRequestClose={onCancel}>
      <AppText variant="heading">{title}</AppText>
      <Input
        placeholder={placeholder}
        value={reason}
        onChangeText={setReason}
        multiline
        error={error ?? localError}
      />
      <View className="gap-2">
        <Button
          title={submitTitle ?? t('common', 'confirm')}
          variant="danger"
          loading={loading}
          onPress={() => {
            setTouched(true);
            if (trimmed.length >= 2) onSubmit(trimmed);
          }}
        />
        <Button title={t('common', 'cancel')} variant="ghost" onPress={onCancel} />
      </View>
    </ModalShell>
  );
}
