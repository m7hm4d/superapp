import { formatIQD } from '@superapp/i18n';
import { AppText } from './text';

export interface MoneyTextProps {
  amountIqd: number;
  className?: string;
}

/** عرض المبالغ بالدينار العراقي — أرقام لاتينية ثابتة العرض */
export function MoneyText({ amountIqd, className }: MoneyTextProps) {
  return (
    <AppText variant="money" className={className}>
      {formatIQD(amountIqd)}
    </AppText>
  );
}
