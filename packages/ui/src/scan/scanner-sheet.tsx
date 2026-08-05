import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { matchScan, type ScanKind } from '@superapp/shared';
import { AppText } from '../text';
import { Button } from '../button';

export interface ScannerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** نوع العملية المتوقَّع — باركود من نوع آخر يُرفض بلا إرسال */
  kind: ScanKind;
  /** معرّف العملية المفتوحة؛ إن مُرِّر رُفض باركود أي عملية أخرى */
  expectedId?: string;
  onScanned: (pin: string) => void;
  labels: {
    title: string;
    hint: string;
    permissionPrompt: string;
    permissionAction: string;
    wrongTarget: string;
    wrongKind: string;
    close: string;
  };
}

/**
 * ماسح الباركود: يقرأ QR فقط، ويرفض ما لا يطابق العملية المفتوحة.
 * لا يُغلق نفسه عند باركود خاطئ — يعرض السبب ويبقى مفتوحاً كي لا يعيد
 * المستخدم فتح الكاميرا في كل محاولة.
 */
export function ScannerSheet({
  visible,
  onClose,
  kind,
  expectedId,
  onScanned,
  labels,
}: ScannerSheetProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  // القراءة تتكرر عشرات المرات في الثانية — نمنع الإرسال المزدوج
  const handled = useRef(false);

  useEffect(() => {
    if (visible) {
      handled.current = false;
      setError(null);
    }
  }, [visible]);

  const handleScan = (raw: string) => {
    if (handled.current) return;
    const result = matchScan(raw, { kind, id: expectedId });
    if (!result.ok) {
      if (result.reason === 'wrong_target') setError(labels.wrongTarget);
      else if (result.reason === 'wrong_kind') setError(labels.wrongKind);
      // unreadable: باركود لا يخصنا أصلاً — تجاهل صامت، الإطار مليء بالباركودات
      return;
    }
    handled.current = true;
    onScanned(result.payload.pin);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View className="flex-1 justify-end bg-black/60">
        <View className="rounded-t-3xl bg-white p-5">
          <AppText variant="title" className="mb-1 text-center">
            {labels.title}
          </AppText>
          <AppText variant="caption" className="mb-4 text-center text-zinc-500">
            {labels.hint}
          </AppText>

          <View className="aspect-square w-full overflow-hidden rounded-2xl bg-zinc-900">
            {permission?.granted ? (
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => handleScan(data)}
              />
            ) : (
              <View className="flex-1 items-center justify-center p-6">
                <AppText className="mb-4 text-center text-white">
                  {labels.permissionPrompt}
                </AppText>
                <Button title={labels.permissionAction} onPress={() => void requestPermission()} />
              </View>
            )}
          </View>

          {error && (
            <View className="mt-3 rounded-xl bg-red-50 px-3 py-2">
              <AppText className="text-center text-red-700">{error}</AppText>
            </View>
          )}

          <Pressable onPress={onClose} className="mt-4 items-center py-3">
            <AppText className="font-medium text-brand-700">{labels.close}</AppText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
