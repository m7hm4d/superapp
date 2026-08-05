import { t } from '@superapp/i18n';

const VEHICLE_KEYS = {
  motorcycle: 'vehicle_motorcycle',
  car: 'vehicle_car',
  tuktuk: 'vehicle_tuktuk',
} as const;

export function vehicleLabel(vehicleType: string): string {
  const key = VEHICLE_KEYS[vehicleType as keyof typeof VEHICLE_KEYS];
  return key ? t('driver', key) : vehicleType;
}

const APPROVAL_KEYS = {
  pending: 'approval_pending',
  approved: 'approval_approved',
  rejected: 'approval_rejected',
  suspended: 'approval_suspended',
} as const;

export function approvalLabel(approvalStatus: string): string {
  const key = APPROVAL_KEYS[approvalStatus as keyof typeof APPROVAL_KEYS];
  return key ? t('driver', key) : approvalStatus;
}

const SETTLEMENT_KEYS = {
  UNSETTLED: 'settlement_status_UNSETTLED',
  AWAITING_CONFIRMATION: 'settlement_status_AWAITING_CONFIRMATION',
  SETTLED: 'settlement_status_SETTLED',
  DISPUTED: 'settlement_status_DISPUTED',
} as const;

export function settlementStatusLabel(status: string): string {
  const key = SETTLEMENT_KEYS[status as keyof typeof SETTLEMENT_KEYS];
  return key ? t('driver', key) : status;
}

export const EXCEPTION_OPTIONS = [
  { type: 'customer_unavailable', labelKey: 'exception_customer_unavailable' },
  { type: 'address_unclear', labelKey: 'exception_address_unclear' },
  { type: 'customer_refused', labelKey: 'exception_customer_refused' },
  { type: 'other', labelKey: 'exception_other' },
] as const;

export type DriverExceptionType = (typeof EXCEPTION_OPTIONS)[number]['type'];
