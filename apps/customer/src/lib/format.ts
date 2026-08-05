import { t } from '@superapp/i18n';

/** مسافة بالأمتار → «650 م» أو «2.4 كم» */
export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) {
    return t('customer', 'meters', { n: Math.max(1, Math.round(distanceM)) });
  }
  return t('customer', 'kilometers', { n: (distanceM / 1000).toFixed(1) });
}

/** عرض محلي لرقم عراقي E.164: ‎+9647701234567 → 07701234567 */
export function toLocalPhone(phone: string): string {
  return phone.startsWith('+964') ? `0${phone.slice(4)}` : phone;
}
