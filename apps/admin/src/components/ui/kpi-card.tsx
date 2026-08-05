'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'success' | 'danger' | 'warning';
}

const TONES: Record<NonNullable<KpiCardProps['tone']>, string> = {
  default: 'text-zinc-900',
  success: 'text-emerald-700',
  danger: 'text-red-700',
  warning: 'text-amber-700',
};

export function KpiCard({ label, value, hint, tone = 'default' }: KpiCardProps) {
  return (
    <div className="rounded-card border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className={cn('mt-1 text-2xl font-bold tabular-nums', TONES[tone])}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-zinc-400">{hint}</div>}
    </div>
  );
}
