/** دمج أسماء الأصناف مع إسقاط القيم الفارغة */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
