import { ar, TranslationKeys } from './locales/ar';
import { en } from './locales/en';

export * from './format';
export type { TranslationKeys };

export type Locale = 'ar' | 'en';

const locales: Record<Locale, TranslationKeys> = { ar, en };

let currentLocale: Locale = 'ar';

export function setLocale(locale: Locale) {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

type Namespace = keyof TranslationKeys;
type KeyOf<N extends Namespace> = keyof TranslationKeys[N] & string;

/** t('order', 'status_READY') — مفاتيح مفحوصة الأنواع، مع استبدال {var} بسيط */
export function t<N extends Namespace>(
  ns: N,
  key: KeyOf<N>,
  vars?: Record<string, string | number>,
): string {
  let text = (locales[currentLocale][ns][key] ?? locales.ar[ns][key]) as string;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
