'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2 } from 'lucide-react';
import { ApiError } from '@superapp/api-client';
import { formatDate } from '@superapp/i18n';
import { api } from '@/lib/api';
import { passkeySupported, registerPasskey } from '@/lib/passkey';
import { Button, ConfirmDialog, Input } from '@/components/ui';

interface PasskeyRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const ERROR_AR: Record<string, string> = {
  LAST_FACTOR: 'لا يمكن حذف آخر وسيلة دخول — سجّل مفتاحاً آخر أو فعّل المصادقة الثنائية أولاً',
  PASSKEY_NOT_FOUND: 'المفتاح غير موجود',
  PASSKEY_INVALID: 'تعذّر التحقق من المفتاح',
};

function arError(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') return '';
  if (e instanceof DOMException && e.name === 'InvalidStateError') {
    return 'هذا الجهاز مسجَّل بالفعل';
  }
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

/**
 * إدارة مفاتيح المرور: عامل مقاوم للتصيّد، والمفتاح المتزامن (iCloud/Google)
 * يحلّ مشكلة الهاتف الضائع — لأنه يعود مع تسجيل الدخول على الجهاز الجديد.
 */
export function PasskeyCard() {
  const queryClient = useQueryClient();
  const [supported, setSupported] = useState(false);
  const [label, setLabel] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PasskeyRow | null>(null);

  useEffect(() => setSupported(passkeySupported()), []);

  const listQuery = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => api.get<PasskeyRow[]>('auth/admin/passkeys'),
  });

  const addMutation = useMutation({
    mutationFn: (name: string) => registerPasskey(name),
    onSuccess: () => {
      setBanner(null);
      setLabel('');
      void queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    },
    onError: (e) => setBanner(arError(e) || null),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`auth/admin/passkeys/${id}`),
    onSuccess: () => {
      setBanner(null);
      setRemoveTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    },
    onError: (e) => setBanner(arError(e) || null),
  });

  if (!supported) {
    return (
      <p className="text-sm text-zinc-500">
        هذا المتصفح لا يدعم مفاتيح المرور — استخدم Safari أو Chrome حديثاً على جهاز يدعم البصمة.
      </p>
    );
  }

  const keys = listQuery.data ?? [];

  return (
    <div className="space-y-4 text-sm">
      {banner && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          {banner}
        </div>
      )}

      <p className="text-zinc-600">
        مفتاح المرور يدخل ببصمة الجهاز بلا كلمة مرور ولا رمز، ولا يمكن تصيّده لأنه مربوط بنطاق
        اللوحة. المفاتيح المتزامنة تعود تلقائياً على هاتفك الجديد.
      </p>

      {listQuery.isPending ? (
        <div className="h-10 animate-pulse rounded bg-zinc-100" />
      ) : keys.length === 0 ? (
        <p className="text-amber-700">لا توجد مفاتيح مسجّلة على هذا الحساب.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-card border border-zinc-200">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="flex items-center gap-3">
                <KeyRound size={18} className="text-brand-600" aria-hidden />
                <div>
                  <div className="font-medium">{key.label}</div>
                  <div className="text-xs text-zinc-500">
                    أُضيف {formatDate(key.createdAt)}
                    {key.lastUsedAt ? ` · آخر استخدام ${formatDate(key.lastUsedAt)}` : ' · لم يُستخدم بعد'}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(key)}>
                <Trash2 size={16} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="grow">
          <Input
            label="اسم الجهاز"
            placeholder="آيفون محمد"
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 60))}
          />
        </div>
        <Button
          loading={addMutation.isPending}
          onClick={() => addMutation.mutate(label.trim() || 'مفتاح مرور')}
        >
          إضافة مفتاح
        </Button>
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="حذف مفتاح المرور"
        body={
          removeTarget
            ? `سيُحذف «${removeTarget.label}» ولن يعود صالحاً للدخول. تأكد أن لديك وسيلة دخول أخرى.`
            : undefined
        }
        danger
        confirmLabel="تأكيد الحذف"
        onConfirm={async () => {
          if (!removeTarget) return;
          await removeMutation.mutateAsync(removeTarget.id);
        }}
      />
    </div>
  );
}
