'use client';

import { useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { api } from '@/lib/api';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  Input,
  Skeleton,
  Toggle,
} from '@/components/ui';

interface FlagView {
  key: string;
  enabled: boolean;
  value: unknown;
}

const FLAG_AR: Record<string, string> = {
  'category.bakery': 'فئة المخابز',
  'category.vegetables': 'فئة الخضار والفواكه',
  'category.market': 'فئة السوق والبقالة',
  'category.construction': 'فئة مواد البناء',
  'auth.otp': 'تسجيل الدخول برمز OTP',
  'customer.live_tracking': 'التتبع الحي للزبون',
  'batch.max_size': 'الحد الأقصى لحجم الدفعة',
};

const ERROR_AR: Record<string, string> = {
  EMPTY_UPDATE: 'لا يوجد تغيير للحفظ',
  VALIDATION_ERROR: 'قيمة غير صالحة',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر الحفظ (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

export function FlagsCard() {
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);
  const [pendingCategory, setPendingCategory] = useState<FlagView | null>(null);
  const [maxSizeDraft, setMaxSizeDraft] = useState<string | null>(null);

  const flagsQuery = useQuery({
    queryKey: ['flags'],
    queryFn: () => api.get<FlagView[]>('admin/flags'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, body }: { key: string; body: { enabled?: boolean; value?: unknown } }) =>
      api.patch(`admin/flags/${encodeURIComponent(key)}`, body),
    onSuccess: () => {
      setBanner(null);
      setPendingCategory(null);
      void queryClient.invalidateQueries({ queryKey: ['flags'] });
    },
    onError: (e) => setBanner(arError(e)),
  });

  if (flagsQuery.isPending) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }

  if (flagsQuery.isError) {
    return (
      <ErrorState message="تعذر تحميل أعلام الميزات" onRetry={() => void flagsQuery.refetch()} />
    );
  }

  const flags = flagsQuery.data ?? [];
  const maxSizeFlag = flags.find((f) => f.key === 'batch.max_size');
  const maxSizeCurrent =
    typeof maxSizeFlag?.value === 'number' ? String(maxSizeFlag.value) : '';

  const toggleFlag = (flag: FlagView, enabled: boolean) => {
    if (flag.key.startsWith('category.')) {
      // تعطيل/تفعيل فئة كاملة يؤثر على كل متاجرها — يتطلب تأكيداً
      setPendingCategory({ ...flag, enabled });
      return;
    }
    updateMutation.mutate({ key: flag.key, body: { enabled } });
  };

  return (
    <div>
      {banner && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {banner}
        </div>
      )}

      {flags.length === 0 ? (
        <p className="text-sm text-gray-500">لا توجد أعلام ميزات معرفة بعد</p>
      ) : (
        <ul className="divide-y">
          {flags.map((flag) => (
            <li key={flag.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium">{FLAG_AR[flag.key] ?? flag.key}</p>
                <p className="font-mono text-xs text-gray-400" dir="ltr">
                  {flag.key}
                </p>
              </div>

              {flag.key === 'batch.max_size' ? (
                <div className="flex items-center gap-2">
                  <div className="w-24">
                    <Input
                      type="number"
                      value={maxSizeDraft ?? maxSizeCurrent}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setMaxSizeDraft(e.target.value)
                      }
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
                      maxSizeDraft === null ||
                      maxSizeDraft.trim() === '' ||
                      maxSizeDraft === maxSizeCurrent
                    }
                    loading={updateMutation.isPending}
                    onClick={() => {
                      const num = Number(maxSizeDraft);
                      if (!Number.isInteger(num) || num < 1) {
                        setBanner('حجم الدفعة يجب أن يكون عدداً صحيحاً موجباً');
                        return;
                      }
                      updateMutation.mutate({
                        key: flag.key,
                        body: { value: num },
                      });
                      setMaxSizeDraft(null);
                    }}
                  >
                    حفظ
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  {flag.enabled ? (
                    <Badge tone="green">مفعّل</Badge>
                  ) : (
                    <Badge tone="gray">معطّل</Badge>
                  )}
                  <Toggle
                    checked={flag.enabled}
                    onChange={(checked: boolean) => toggleFlag(flag, checked)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingCategory !== null}
        onClose={() => setPendingCategory(null)}
        title={pendingCategory?.enabled ? 'تفعيل الفئة' : 'تعطيل الفئة'}
        body={
          pendingCategory
            ? pendingCategory.enabled
              ? `ستظهر «${FLAG_AR[pendingCategory.key] ?? pendingCategory.key}» لكل الزبائن فوراً.`
              : `ستختفي «${FLAG_AR[pendingCategory.key] ?? pendingCategory.key}» من التطبيق ولن يستقبل بائعوها طلبات جديدة.`
            : undefined
        }
        danger={pendingCategory !== null && !pendingCategory.enabled}
        confirmLabel={pendingCategory?.enabled ? 'تفعيل' : 'تعطيل'}
        onConfirm={async () => {
          if (!pendingCategory) return;
          await updateMutation.mutateAsync({
            key: pendingCategory.key,
            body: { enabled: pendingCategory.enabled },
          });
        }}
      />
    </div>
  );
}
