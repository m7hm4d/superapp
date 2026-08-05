'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'purple';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
}

const TONES: Record<BadgeTone, string> = {
  gray: 'bg-zinc-100 text-zinc-700',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800',
  purple: 'bg-purple-100 text-purple-800',
};

export function Badge({ children, tone = 'gray' }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
