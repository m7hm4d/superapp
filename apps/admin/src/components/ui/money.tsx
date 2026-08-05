'use client';

import { formatIQD } from '@superapp/i18n';
import { cn } from '@/lib/cn';

export interface MoneyProps {
  amountIqd: number;
  className?: string;
}

/** «12,500 د.ع.» — أرقام لاتينية بلا كسور (الملف §11). */
export function Money({ amountIqd, className }: MoneyProps) {
  return (
    <span className={cn('whitespace-nowrap tabular-nums', className)}>
      {formatIQD(amountIqd)}
    </span>
  );
}
