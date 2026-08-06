import { describe, expect, it } from 'vitest';
import {
  stripLeadingSlashes,
  stripTrailingSlashes,
} from '../../../packages/api-client/src/url';

/**
 * انحدار ReDoS (‏js/polynomial-redos، تنبيها CodeQL رقم 1 و2).
 *
 * كان `baseUrl.replace(/\/+$/, '')` في client.ts وsocket.ts. التعبير غير
 * مثبَّت من اليسار، فيعيد المحرّك المحاولة من كل موضع ويلتهم سلسلة الشرطات
 * ثم يفشل في `$` — كلفة تربيعية. القياس الفعلي للتعبير القديم:
 *
 *   ‏20k شرطة →   306ms
 *   ‏50k شرطة →  1,818ms
 *   ‏100k شرطة → 7,314ms
 *   ‏200k شرطة → 29,098ms   ← أربعة أضعاف المدخل = ستة عشر ضعف الزمن
 *
 * المسح الخطي ينهي الحالة نفسها في 0.19ms.
 */

/** الشكل الخبيث: سلسلة شرطات طويلة **لا** تقع في آخر النص */
const adversarial = (n: number) => `https://api.example.com${'/'.repeat(n)}a`;

describe('api-client url helpers', () => {
  describe('stripTrailingSlashes', () => {
    it('يحذف شرطة واحدة أو أكثر من الآخر', () => {
      expect(stripTrailingSlashes('https://a.com/')).toBe('https://a.com');
      expect(stripTrailingSlashes('https://a.com///')).toBe('https://a.com');
    });

    it('يترك النص كما هو حين لا شرطة في آخره', () => {
      expect(stripTrailingSlashes('https://a.com')).toBe('https://a.com');
      expect(stripTrailingSlashes('https://a.com/api/v1')).toBe('https://a.com/api/v1');
    });

    it('لا يمسّ الشرطات الداخلية ولا شرطات البروتوكول', () => {
      expect(stripTrailingSlashes('https://a.com//x//y//')).toBe('https://a.com//x//y');
    });

    it('يتعامل مع الحواف: نص فارغ، وشرطات فقط', () => {
      expect(stripTrailingSlashes('')).toBe('');
      expect(stripTrailingSlashes('/')).toBe('');
      expect(stripTrailingSlashes('////')).toBe('');
    });
  });

  describe('stripLeadingSlashes', () => {
    it('يحذف شرطة واحدة أو أكثر من الأول', () => {
      expect(stripLeadingSlashes('/orders')).toBe('orders');
      expect(stripLeadingSlashes('///orders')).toBe('orders');
      expect(stripLeadingSlashes('orders')).toBe('orders');
      expect(stripLeadingSlashes('')).toBe('');
      expect(stripLeadingSlashes('///')).toBe('');
    });
  });

  describe('انحدار ReDoS', () => {
    it('ينهي 200 ألف شرطة في زمن خطي', () => {
      const input = adversarial(200_000);
      const started = performance.now();
      expect(stripTrailingSlashes(input)).toBe(input);
      const elapsed = performance.now() - started;
      // التعبير القديم استغرق ~29,000ms هنا. العتبة فضفاضة عمداً كي لا
      // ترتجف على عدّاد CI، وتبقى أقل من السلوك القديم بمرتين من حيث الرتبة.
      expect(elapsed).toBeLessThan(500);
    });

    it('يبقى خطياً حين تقع الشرطات في الآخر فعلاً', () => {
      const input = `https://api.example.com${'/'.repeat(200_000)}`;
      const started = performance.now();
      expect(stripTrailingSlashes(input)).toBe('https://api.example.com');
      expect(performance.now() - started).toBeLessThan(500);
    });

    // ملاحظة: لا نقيس نسبة النمو (زمن 4n ÷ زمن n). النسخة الخطية تنهي
    // 200 ألف في ~0.2ms، وهو رقم تبتلعه دقة المؤقّت وكنس الذاكرة فتخرج
    // النسبة عشوائية. الحدّ المطلق أدناه يفصل بين السلوكين بمرتبتين من
    // حيث القدر (0.2ms مقابل 29,000ms) فلا يحتاج نسبة أصلاً.

    it('يصمد أمام مدخل ضخم لا تحتمله الكلفة التربيعية', () => {
      // مليونا شرطة: الخطي ~2ms، والتربيعي ~48 دقيقة (يسقط بانتهاء المهلة).
      const input = adversarial(2_000_000);
      const started = performance.now();
      expect(stripTrailingSlashes(input)).toBe(input);
      expect(performance.now() - started).toBeLessThan(500);
    });
  });
});
