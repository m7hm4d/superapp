import { formatMMSS } from '../src/lib/countdown';
import { errorCode, errorExpectedIqd } from '../src/lib/errors';

describe('formatMMSS', () => {
  it('يبني mm:ss بصفر بادئ', () => {
    expect(formatMMSS(0)).toBe('00:00');
    expect(formatMMSS(5)).toBe('00:05');
    expect(formatMMSS(65)).toBe('01:05');
    expect(formatMMSS(600)).toBe('10:00');
  });

  it('يتجاوز الساعة بلا انهيار — العرض بالدقائق لا بالساعات', () => {
    expect(formatMMSS(3661)).toBe('61:01');
  });
});

describe('errorCode', () => {
  it('يستخرج code من كائن الخطأ عبر حدود الحزم', () => {
    expect(errorCode({ code: 'CASH_MISMATCH' })).toBe('CASH_MISMATCH');
  });

  it('يرجع undefined لكل ما ليس خطأ ذا code نصّي', () => {
    expect(errorCode({ code: 42 })).toBeUndefined();
    expect(errorCode({})).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode('CASH_MISMATCH')).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });
});

describe('errorExpectedIqd', () => {
  it('يقرأ expected من جسم CASH_MISMATCH', () => {
    expect(errorExpectedIqd({ body: { expected: 12000 } })).toBe(12000);
  });

  it('يرفض ما ليس رقماً — الصفر مبلغ صالح ويجب ألا يُبتلع', () => {
    expect(errorExpectedIqd({ body: { expected: 0 } })).toBe(0);
    expect(errorExpectedIqd({ body: { expected: '12000' } })).toBeUndefined();
    expect(errorExpectedIqd({ body: {} })).toBeUndefined();
    expect(errorExpectedIqd({})).toBeUndefined();
    expect(errorExpectedIqd(null)).toBeUndefined();
  });
});
