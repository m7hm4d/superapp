import { View } from 'react-native';
import type { OrderStatus } from '@superapp/shared';
import { t } from '@superapp/i18n';
import { AppText } from './text';
import { cn } from './cn';

export interface StatusBadgeProps {
  status: OrderStatus;
}

/** لون + نص دائماً — لا نعتمد على اللون وحده (الملف §11) */
const statusClasses: Record<OrderStatus, { container: string; dot: string; text: string }> = {
  PENDING_BAKERY: { container: 'bg-status-pending/10', dot: 'bg-status-pending', text: 'text-status-pending' },
  PREPARING: { container: 'bg-status-preparing/10', dot: 'bg-status-preparing', text: 'text-status-preparing' },
  READY: { container: 'bg-status-ready/10', dot: 'bg-status-ready', text: 'text-status-ready' },
  IN_DELIVERY: { container: 'bg-status-delivery/10', dot: 'bg-status-delivery', text: 'text-status-delivery' },
  DELIVERED: { container: 'bg-status-delivered/10', dot: 'bg-status-delivered', text: 'text-status-delivered' },
  CANCELLED: { container: 'bg-status-cancelled/10', dot: 'bg-status-cancelled', text: 'text-status-cancelled' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const classes = statusClasses[status];
  const label = t('order', `status_${status}` as const);
  return (
    <View className={cn('flex-row items-center gap-1.5 self-start rounded-full px-3 py-1', classes.container)}>
      <View className={cn('h-2 w-2 rounded-full', classes.dot)} />
      <AppText variant="caption" className={cn('font-bold', classes.text)}>
        {label}
      </AppText>
    </View>
  );
}
