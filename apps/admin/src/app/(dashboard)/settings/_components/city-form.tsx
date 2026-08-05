'use client';

import { useState, type ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { api } from '@/lib/api';
import { Button, Input } from '@/components/ui';

export interface AdminCity {
  id: string;
  nameAr: string;
  centerLat: number;
  centerLng: number;
  serviceRadiusKm: number;
  visibilityRadiusKm: number;
  deliveryFeeIqd: number;
  vendorAcceptTimeoutMin: number;
  batchWindowSec: number;
  batchOfferTtlSec: number;
  isActive: boolean;
  createdAt: string;
}

const ERROR_AR: Record<string, string> = {
  CITY_NOT_FOUND: 'المدينة غير موجودة',
  EMPTY_UPDATE: 'لا يوجد تغيير للحفظ',
  VALIDATION_ERROR: 'قيمة خارج الحدود المسموحة',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر الحفظ (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

interface FieldDef {
  key: keyof CityFormState;
  label: string;
  hint?: string;
}

interface CityFormState {
  nameAr: string;
  deliveryFeeIqd: string;
  serviceRadiusKm: string;
  visibilityRadiusKm: string;
  vendorAcceptTimeoutMin: string;
  batchWindowSec: string;
  batchOfferTtlSec: string;
}

const NUMERIC_FIELDS: FieldDef[] = [
  { key: 'deliveryFeeIqd', label: 'أجرة التوصيل (د.ع)' },
  { key: 'serviceRadiusKm', label: 'نصف قطر الخدمة (كم)' },
  { key: 'visibilityRadiusKm', label: 'نصف قطر الرؤية (كم)' },
  { key: 'vendorAcceptTimeoutMin', label: 'مهلة قبول المتجر (دقيقة)' },
  { key: 'batchWindowSec', label: 'نافذة التجميع (ثانية)' },
  { key: 'batchOfferTtlSec', label: 'مهلة عرض الدفعة (ثانية)' },
];

export function CityForm({ city }: { city: AdminCity }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CityFormState>({
    nameAr: city.nameAr,
    deliveryFeeIqd: String(city.deliveryFeeIqd),
    serviceRadiusKm: String(city.serviceRadiusKm),
    visibilityRadiusKm: String(city.visibilityRadiusKm),
    vendorAcceptTimeoutMin: String(city.vendorAcceptTimeoutMin),
    batchWindowSec: String(city.batchWindowSec),
    batchOfferTtlSec: String(city.batchOfferTtlSec),
  });
  const [banner, setBanner] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch(`admin/cities/${city.id}`, patch),
    onSuccess: () => {
      setBanner(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      void queryClient.invalidateQueries({ queryKey: ['cities'] });
    },
    onError: (e) => {
      setSaved(false);
      setBanner(arError(e));
    },
  });

  const setField = (key: keyof CityFormState) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = () => {
    const patch: Record<string, unknown> = {};
    if (form.nameAr.trim() && form.nameAr.trim() !== city.nameAr) {
      patch.nameAr = form.nameAr.trim();
    }
    for (const field of NUMERIC_FIELDS) {
      const raw = form[field.key].trim();
      if (raw === '') continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      if (num !== city[field.key as keyof AdminCity]) {
        patch[field.key] = num;
      }
    }
    if (Object.keys(patch).length === 0) {
      setBanner('لا يوجد تغيير للحفظ');
      return;
    }
    saveMutation.mutate(patch);
  };

  return (
    <div>
      {banner && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {banner}
        </div>
      )}
      {saved && (
        <div className="mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          حُفظت إعدادات {city.nameAr} بنجاح
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Input label="اسم المدينة" value={form.nameAr} onChange={setField('nameAr')} />
        {NUMERIC_FIELDS.map((field) => (
          <Input
            key={field.key}
            label={field.label}
            type="number"
            value={form[field.key]}
            onChange={setField(field.key)}
          />
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="primary" loading={saveMutation.isPending} onClick={save}>
          حفظ إعدادات المدينة
        </Button>
      </div>
    </div>
  );
}
