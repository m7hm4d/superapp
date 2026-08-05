import { formatDate, formatIQD, formatTime } from '@superapp/i18n';

export { formatDate, formatIQD, formatTime };

/** أرقام لاتينية بمحلّية عربية عراقية — معيار اللوحة كلها. */
const LOCALE = 'ar-IQ-u-nu-latn';

const numberFormatter = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 0,
});

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** «٥ آب، 14:30» بأرقام لاتينية — لصفوف الجداول. */
export function formatDateTime(date: Date | string): string {
  return dateTimeFormatter.format(
    typeof date === 'string' ? new Date(date) : date,
  );
}

const relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, {
  numeric: 'auto',
});

const RELATIVE_STEPS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
];

/** «قبل 5 دقائق» — لأعمدة الحداثة وSLA. */
export function formatRelative(date: Date | string): string {
  const then = typeof date === 'string' ? new Date(date) : date;
  const diff = then.getTime() - Date.now();
  for (const step of RELATIVE_STEPS) {
    if (Math.abs(diff) >= step.ms) {
      return relativeFormatter.format(Math.round(diff / step.ms), step.unit);
    }
  }
  return relativeFormatter.format(Math.round(diff / 1000), 'second');
}

/** يوم + وقت كاملان لرأس الدرج والتفاصيل. */
const fullFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatFullDateTime(date: Date | string): string {
  return fullFormatter.format(typeof date === 'string' ? new Date(date) : date);
}
