import { useState } from 'react';
import { Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildScanPayload, type ScanKind } from '@superapp/shared';
import { AppText } from './text';
import { cn } from './cn';

export interface PinOrQrProps {
  kind: ScanKind;
  /** معرّف الطلب/الدفعة/التسوية — يمنع تأكيد عملية بباركود عملية أخرى */
  id: string;
  pin: string;
  /** يبدأ على الباركود: الأسرع حين يكون الطرف الآخر جاهزاً للمسح */
  defaultView?: 'qr' | 'pin';
  size?: number;
  className?: string;
  labels?: { qr: string; pin: string };
}

const DEFAULT_LABELS = { qr: 'باركود', pin: 'رمز' };

/**
 * عرض الرمز بشكلين: أرقام تُقرأ صوتاً، أو باركود يُمسح.
 * الطرفان يريان الشيء نفسه — والباركود اختصار إدخال لا إذن، فالتحقق
 * النهائي يبقى عند الخادم في الحالتين.
 */
export function PinOrQr({
  kind,
  id,
  pin,
  defaultView = 'qr',
  size = 180,
  className,
  labels = DEFAULT_LABELS,
}: PinOrQrProps) {
  const [view, setView] = useState<'qr' | 'pin'>(defaultView);

  // معرّف غير صالح (بيانات ناقصة) لا يُنتج باركوداً — تُعرض الأرقام وحدها
  let payload: string | null = null;
  try {
    payload = buildScanPayload({ kind, id, pin });
  } catch {
    payload = null;
  }
  const showQr = view === 'qr' && payload !== null;

  return (
    <View className={cn('items-center', className)}>
      {showQr ? (
        <View className="rounded-2xl bg-white p-3">
          <QRCode value={payload as string} size={size} />
        </View>
      ) : (
        <AppText
          variant="title"
          selectable
          className="my-2 text-5xl tracking-widest text-brand-700"
          style={{ writingDirection: 'ltr' }}
        >
          {pin}
        </AppText>
      )}

      {payload !== null && (
        <View className="mt-3 flex-row overflow-hidden rounded-full border border-zinc-200 bg-white">
          {(['qr', 'pin'] as const).map((option) => {
            const active = view === option;
            return (
              <Pressable
                key={option}
                onPress={() => setView(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className={cn('px-4 py-2', active && 'bg-brand-600')}
              >
                <AppText
                  variant="caption"
                  className={cn('font-medium', active ? 'text-white' : 'text-zinc-600')}
                >
                  {option === 'qr' ? labels.qr : labels.pin}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
