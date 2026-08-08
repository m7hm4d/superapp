'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { Card, ErrorState, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { CityForm, type AdminCity } from './_components/city-form';
import { FlagsCard } from './_components/flags-card';
import { PasskeyCard } from './_components/passkey-card';
import { PasswordCard } from './_components/password-card';
import { RecoveryCodesCard } from './_components/recovery-codes-card';
import { SecurityPosture } from './_components/security-posture';
import { SecurityRow } from './_components/security-row';
import { TotpCard } from './_components/totp-card';

interface TotpStatus {
  enabled: boolean;
  pending: boolean;
}

/**
 * الإعدادات على تبويبين.
 *
 * كانت ستّ بطاقات في عمود واحد تخلط أمرين لا صلة بينهما: ضبط التشغيل
 * (المدن والأعلام) وأمان الحساب (كلمة المرور والعوامل والاسترداد). ومن أراد
 * تدوير كلمة مروره كان يمرّ بحدود المدينة ورسوم التوصيل.
 *
 * والأمان في صفوف مضغوطة لا نماذج مفتوحة: الحالة تُقرأ من سطر، والنموذج
 * يُفتح عند القصد.
 */
export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'operations' | 'security'>('operations');

  const citiesQuery = useQuery({
    queryKey: ['cities'],
    queryFn: () => api.get<AdminCity[]>('admin/cities'),
    enabled: tab === 'operations',
  });

  const totpQuery = useQuery({
    queryKey: ['totp', 'status'],
    queryFn: () => api.get<TotpStatus>('auth/admin/totp/status'),
    enabled: tab === 'security',
  });
  const passkeysQuery = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => api.get<{ id: string }[]>('auth/admin/passkeys'),
    enabled: tab === 'security',
  });
  const recoveryQuery = useQuery({
    queryKey: ['recovery', 'status'],
    queryFn: () => api.get<{ remaining: number }>('auth/admin/recovery-codes'),
    enabled: tab === 'security',
  });

  useSocketEvent('config:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['cities'] });
    void queryClient.invalidateQueries({ queryKey: ['flags'] });
  });

  const totpOn = totpQuery.data?.enabled ?? false;
  const passkeyCount = passkeysQuery.data?.length ?? 0;
  const remaining = recoveryQuery.data?.remaining ?? 0;

  return (
    <div>
      <PageHeader
        title="الإعدادات"
        description="ضبط التشغيل للمدن والميزات، وأمان حساب المشرف"
      />

      <div className="mb-6">
        <Tabs
          tabs={[
            { key: 'operations', label: 'التشغيل' },
            { key: 'security', label: 'الأمان' },
          ]}
          active={tab}
          onChange={(k) => setTab(k as 'operations' | 'security')}
        />
      </div>

      {tab === 'operations' ? (
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
        </div>
      ) : (
        <div>
          <SecurityPosture />

          <Card title="أمان حسابك">
            <div className="-my-4">
              <SecurityRow
                title="كلمة المرور"
                description="تُطلب مع عامل ثانٍ عند التغيير، والتغيير يُنهي جلساتك على كل الأجهزة."
                status={{ label: 'مفعّلة', tone: 'gray' }}
                action="تغيير"
              >
                <PasswordCard />
              </SecurityRow>

              <SecurityRow
                title="تطبيق المصادقة (TOTP)"
                description="رمز سداسي يتغيّر كل ٣٠ ثانية من تطبيق على هاتفك."
                status={
                  totpOn
                    ? { label: 'مفعّل', tone: 'green' }
                    : { label: 'غير مفعّل', tone: 'amber' }
                }
                action={totpOn ? 'تسجيل جهاز جديد' : 'تفعيل'}
                defaultOpen={!totpOn && passkeyCount === 0}
              >
                <TotpCard />
              </SecurityRow>

              <SecurityRow
                title="مفاتيح المرور (Passkeys)"
                description="دخول ببصمة الجهاز، ولا يُصطاد لأنه مربوط بنطاق اللوحة تشفيرياً."
                status={
                  passkeyCount > 0
                    ? { label: `${passkeyCount} مفتاح`, tone: 'green' }
                    : { label: 'لا مفاتيح', tone: 'gray' }
                }
                action={passkeyCount > 0 ? 'إدارة' : 'إضافة مفتاح'}
              >
                <PasskeyCard />
              </SecurityRow>

              <SecurityRow
                title="رموز الاسترداد"
                description="مخرجك لو ضاع هاتفك — عشرة رموز، لكلٍّ استعمال واحد."
                status={
                  remaining === 0
                    ? { label: 'لا رموز', tone: 'red' }
                    : remaining <= 3
                      ? { label: `${remaining} متبقٍّ`, tone: 'amber' }
                      : { label: `${remaining} من ١٠`, tone: 'green' }
                }
                action={remaining > 0 ? 'توليد مجموعة جديدة' : 'توليد الرموز'}
                defaultOpen={remaining === 0 && (totpOn || passkeyCount > 0)}
              >
                <RecoveryCodesCard />
              </SecurityRow>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
