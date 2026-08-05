/**
 * توحيد أرقام الهاتف العراقية إلى صيغة E.164 (+964XXXXXXXXXX).
 * تُستخدم في كل مكان: التسجيل، الدخول، الـ seed، والبحث.
 *
 * صيغ مقبولة: 07XXXXXXXXX، 7XXXXXXXXX، 9647XXXXXXXXX، +9647XXXXXXXXX،
 * مع أرقام عربية-هندية (٠١٢٣٤٥٦٧٨٩) أو لاتينية، وفواصل/مسافات اختيارية.
 */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_INDIC = '۰۱۲۳۴۵۶۷۸۹';

function toLatinDigits(input: string): string {
  return [...input]
    .map((ch) => {
      const a = ARABIC_INDIC.indexOf(ch);
      if (a >= 0) return String(a);
      const e = EXTENDED_INDIC.indexOf(ch);
      if (e >= 0) return String(e);
      return ch;
    })
    .join('');
}

export class InvalidIraqiPhoneError extends Error {
  constructor(public readonly input: string) {
    super(`Invalid Iraqi phone number: ${input}`);
    this.name = 'InvalidIraqiPhoneError';
  }
}

export function normalizeIraqiPhone(raw: string): string {
  const digitsOnly = toLatinDigits(raw).replace(/[\s\-().]/g, '').replace(/^\+/, '');
  let national: string;
  if (/^964\d{10}$/.test(digitsOnly)) {
    national = digitsOnly.slice(3);
  } else if (/^0\d{10}$/.test(digitsOnly)) {
    national = digitsOnly.slice(1);
  } else if (/^\d{10}$/.test(digitsOnly)) {
    national = digitsOnly;
  } else {
    throw new InvalidIraqiPhoneError(raw);
  }
  // الشبكات العراقية للموبايل تبدأ بـ 7 (75/77/78/79...)
  if (!national.startsWith('7')) {
    throw new InvalidIraqiPhoneError(raw);
  }
  return `+964${national}`;
}

export function isValidIraqiPhone(raw: string): boolean {
  try {
    normalizeIraqiPhone(raw);
    return true;
  } catch {
    return false;
  }
}
