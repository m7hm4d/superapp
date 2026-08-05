/**
 * تنسيق الدينار العراقي: أرقام لاتينية بلا كسور — «12,500 د.ع.»
 * (عرف تطبيقات التوصيل العراقية، والفلوس ميتة عملياً)
 *
 * بعض المحركات (Hermes على iOS) تتجاهل لاحقة ‎-u-nu-latn وتعيد أرقاماً
 * هندية — لذلك نحوّل الأرقام للاتينية حتمياً بعد التنسيق.
 */
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

function forceLatinDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const i = ARABIC_INDIC.indexOf(ch);
    out += i >= 0 ? String(i) : ch;
  }
  return out;
}

const iqdFormatter = new Intl.NumberFormat('ar-IQ-u-nu-latn', {
  style: 'currency',
  currency: 'IQD',
  maximumFractionDigits: 0,
});

export function formatIQD(amount: number): string {
  return forceLatinDigits(iqdFormatter.format(amount));
}

const timeFormatter = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
  hour: '2-digit',
  minute: '2-digit',
});

export function formatTime(date: Date | string): string {
  return forceLatinDigits(timeFormatter.format(typeof date === 'string' ? new Date(date) : date));
}

const dateFormatter = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function formatDate(date: Date | string): string {
  return forceLatinDigits(dateFormatter.format(typeof date === 'string' ? new Date(date) : date));
}

/** إخفاء رقم الهاتف بين الأطراف: +9647701234567 ← 077XX...67 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/^\+964/, '0');
  if (digits.length < 6) return '****';
  return `${digits.slice(0, 4)}XX...${digits.slice(-2)}`;
}
