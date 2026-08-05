import { customAlphabet } from '../vendor/nanoid';

const digits = customAlphabet('0123456789', 4);
const codeAlphabet = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 4);

/** كود طلب قصير قابل للنطق هاتفياً مثل BG-7K2M */
export function generateOrderCode(prefix = 'BG'): string {
  return `${prefix}-${codeAlphabet()}`;
}

/** PIN من 4 أرقام للتسليم/الاستلام/التسوية */
export function generatePin(): string {
  return digits();
}
