'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { Card, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { CityForm, type AdminCity } from './_components/city-form';
import { FlagsCard } from './_components/flags-card';
import { TotpCard } from './_components/totp-card';

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const citiesQuery = useQuery({
    queryKey: ['cities'],
    queryFn: () => api.get<AdminCity[]>('admin/cities'),
  });

  useSocketEvent('config:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['cities'] });
    void queryClient.invalidateQueries({ queryKey: ['flags'] });
  });

  return (
    <div>
      <PageHeader
        title="إعدادات التشغيل"
        description="حدود المدينة والرسوم والمُهل، أعلام الميزات، وأمان حساب المشرف"
      />

      <div className="space-y-8">
        {citiesQuery.isPending ? (
          <Skeleton className="h-64" />
        ) : citiesQuery.isError ? (
          <ErrorState
            message="تعذر تحميل إعدادات المدن"
            onRetry={() => void citiesQuery.refetch()}
          />
        ) : (
          (citiesQuery.data ?? []).map((city) => (
            <Card key={city.id} title={`إعدادات مدينة ${city.nameAr}`}>
              <CityForm city={city} />
            </Card>
          ))
        )}

        <Card title="أعلام الميزات">
          <FlagsCard />
        </Card>

        <Card title="المصادقة الثنائية (MFA)">
          <TotpCard />
        </Card>
      </div>
    </div>
  );
}
