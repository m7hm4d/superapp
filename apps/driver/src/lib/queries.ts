import { useQuery } from '@tanstack/react-query';
import type { DriverBatchView, DriverLedgerView } from '../types';
import { client } from './api';

export const batchKeys = {
  all: ['batches'] as const,
  available: ['batches', 'available'] as const,
  active: ['batches', 'active'] as const,
};

export const ledgerKey = ['ledger'] as const;

export function useAvailableBatches(enabled: boolean) {
  return useQuery({
    queryKey: batchKeys.available,
    queryFn: async () => {
      const data = await client.get<DriverBatchView[]>('driver/batches/available');
      return data ?? [];
    },
    enabled,
    // polling احتياطي عند تعطل البث الحي (الملف §10)
    refetchInterval: 10_000,
  });
}

export function useActiveBatch(refetchInterval: number | false = 15_000) {
  return useQuery({
    queryKey: batchKeys.active,
    queryFn: async () => {
      const data = await client.get<DriverBatchView | null>('driver/batches/active');
      return data ?? null;
    },
    refetchInterval,
  });
}

export function useDriverLedger(refetchInterval: number | false = false) {
  return useQuery({
    queryKey: ledgerKey,
    queryFn: () => client.get<DriverLedgerView>('driver/ledger'),
    refetchInterval,
  });
}
