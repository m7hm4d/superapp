import { randomBytes } from 'node:crypto';

/**
 * مولّد معرفات عشوائية آمن بلا اعتماد خارجي (بديل nanoid/customAlphabet).
 * rejection sampling لتوزيع منتظم على الأبجدية.
 */
export function customAlphabet(alphabet: string, size: number): () => string {
  if (alphabet.length < 2 || alphabet.length > 256) throw new Error('alphabet size out of range');
  const max = 256 - (256 % alphabet.length);
  return () => {
    let out = '';
    while (out.length < size) {
      const bytes = randomBytes(size * 2);
      for (const b of bytes) {
        if (b < max) {
          out += alphabet[b % alphabet.length];
          if (out.length === size) break;
        }
      }
    }
    return out;
  };
}
