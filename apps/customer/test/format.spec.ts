import { formatDistance, toLocalPhone } from '../src/lib/format';

describe('formatDistance', () => {
  it('تعرض الأمتار دون الكيلومتر', () => {
    expect(formatDistance(650)).toContain('650');
    expect(formatDistance(999)).toContain('999');
  });

  /** صفر متر يصير «1 م» لا «0 م» — الصفر يقرأ كخطأ في القياس لا كقرب */
  it('لا تعرض صفر متر', () => {
    expect(formatDistance(0)).toContain('1');
    expect(formatDistance(0.2)).toContain('1');
  });

  it('تنتقل إلى الكيلومتر عند الألف بخانة عشرية واحدة', () => {
    expect(formatDistance(1000)).toContain('1.0');
    expect(formatDistance(2400)).toContain('2.4');
    expect(formatDistance(12345)).toContain('12.3');
  });
});

describe('toLocalPhone', () => {
  it('تحوّل E.164 العراقي إلى الشكل المحلي', () => {
    expect(toLocalPhone('+9647701234567')).toBe('07701234567');
  });

  it('تترك ما ليس عراقياً كما هو', () => {
    expect(toLocalPhone('07701234567')).toBe('07701234567');
    expect(toLocalPhone('+9627701234567')).toBe('+9627701234567');
    expect(toLocalPhone('')).toBe('');
  });
});
