import type { OrderView, VendorCardView, VendorCategory } from '@superapp/shared';
import { OrderStatus } from '@superapp/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConfigStore } from '../stores/config';
import { api } from './api';
import type { AppConfig, StoreView } from './types';

export const TERMINAL_ORDER_STATUSES: readonly string[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];

export function isActiveOrder(order: Pick<OrderView, 'status'>): boolean {
  return !TERMINAL_ORDER_STATUSES.includes(order.status);
}

/** GET config عند الإقلاع + كاش في zustand (مركز المدينة، رسوم التوصيل، الأعلام) */
export function useConfigQuery() {
  const setConfig = useConfigStore((s) => s.setConfig);
  const query = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get<AppConfig>('config'),
    staleTime: 5 * 60_000,
  });
  const { data } = query;
  useEffect(() => {
    if (data) setConfig(data);
  }, [data, setConfig]);
  return query;
}

export function useNearbyQuery(
  center: { lat: number; lng: number } | null,
  category: VendorCategory,
  radiusM: number,
) {
  // تقريب الإحداثيات كي لا يتشظى مفتاح الكاش مع كل حركة خريطة
  const lat = center ? Math.round(center.lat * 10_000) / 10_000 : 0;
  const lng = center ? Math.round(center.lng * 10_000) / 10_000 : 0;
  return useQuery({
    queryKey: ['nearby', lat, lng, category],
    queryFn: () =>
      api.get<VendorCardView[]>('vendors/nearby', { lat, lng, radius: radiusM, category }),
    enabled: center !== null,
    staleTime: 30_000,
  });
}

export function useStoreQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['store', id],
    queryFn: () => api.get<StoreView>(`vendors/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useOrdersQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['orders'],
    queryFn: () => api.get<OrderView[]>('orders'),
    enabled,
    staleTime: 15_000,
  });
}

export function useOrderQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderView>(`orders/${id}`),
    enabled: !!id,
    // fallback عند غياب الـ socket: استعلام كل 15 ثانية ما دام الطلب غير منتهٍ
    refetchInterval: (query) => {
      const order = query.state.data;
      if (!order) return false;
      return isActiveOrder(order) ? 15_000 : false;
    },
  });
}
