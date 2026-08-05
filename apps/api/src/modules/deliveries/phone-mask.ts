/**
 * إخفاء رقم هاتف العميل عن السائق (الملف §خصوصية):
 * تُحفظ أول 4 خانات وآخر خانتين بالصيغة المحلية، والبقية X.
 * مثال: +9647701234567 → 0770XXXXX67
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // E.164 عراقي 9647XXXXXXXXX → الصيغة المحلية 07XXXXXXXXX
  const local = /^964\d{10}$/.test(digits) ? `0${digits.slice(3)}` : digits;
  if (local.length <= 6) return local;
  return `${local.slice(0, 4)}${'X'.repeat(local.length - 6)}${local.slice(-2)}`;
}
