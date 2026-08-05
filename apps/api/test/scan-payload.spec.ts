import { describe, expect, it } from 'vitest';
import {
  ScanKind,
  buildScanPayload,
  matchScan,
  parseScanPayload,
} from '@superapp/shared';

/**
 * حمولة الباركود (packages/shared): الماسح يلتقط أي باركود في الإطار،
 * فالرفض الصارم لكل ما لا يطابق الشكل هو ما يمنع تأكيد العملية الخطأ.
 */

const ORDER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';

describe('scan payload', () => {
  it('round-trips a valid payload', () => {
    const text = buildScanPayload({ kind: ScanKind.DELIVERY, id: ORDER, pin: '1234' });
    expect(text).toBe(`superapp://confirm/delivery?id=${ORDER}&pin=1234`);
    expect(parseScanPayload(text)).toEqual({ kind: 'delivery', id: ORDER, pin: '1234' });
  });

  it('builds only from well-formed input', () => {
    expect(() => buildScanPayload({ kind: ScanKind.PICKUP, id: ORDER, pin: '12' })).toThrow();
    expect(() => buildScanPayload({ kind: ScanKind.PICKUP, id: ORDER, pin: 'abcd' })).toThrow();
    expect(() => buildScanPayload({ kind: ScanKind.PICKUP, id: 'not-a-uuid', pin: '1234' })).toThrow();
  });

  it('rejects anything that is not our exact format', () => {
    const rejected = [
      '',
      '1234',
      'https://example.com/?id=1',
      'superapp://confirm/delivery',
      `superapp://confirm/unknown?id=${ORDER}&pin=1234`,
      `superapp://confirm/delivery?id=${ORDER}`,
      'superapp://confirm/delivery?id=not-a-uuid&pin=1234',
      `superapp://confirm/delivery?id=${ORDER}&pin=12345`,
      `superapp://confirm/delivery?id=${ORDER}&pin=abcd`,
      `superapp://other/delivery?id=${ORDER}&pin=1234`,
    ];
    for (const raw of rejected) {
      expect(parseScanPayload(raw), raw).toBeNull();
    }
  });

  it('tolerates surrounding whitespace and extra params, not missing ones', () => {
    expect(parseScanPayload(`  superapp://confirm/pickup?id=${ORDER}&pin=4321  `)).toEqual({
      kind: 'pickup',
      id: ORDER,
      pin: '4321',
    });
    expect(parseScanPayload(`superapp://confirm/pickup?v=2&id=${ORDER}&pin=4321`)).toEqual({
      kind: 'pickup',
      id: ORDER,
      pin: '4321',
    });
  });

  it('matches only the operation in front of the user', () => {
    const delivery = buildScanPayload({ kind: ScanKind.DELIVERY, id: ORDER, pin: '1234' });

    expect(matchScan(delivery, { kind: ScanKind.DELIVERY, id: ORDER })).toEqual({
      ok: true,
      payload: { kind: 'delivery', id: ORDER, pin: '1234' },
    });
    // باركود طلب آخر — الخطأ الوارد فعلاً حين يحمل السائق عدة طلبات
    expect(matchScan(delivery, { kind: ScanKind.DELIVERY, id: OTHER })).toEqual({
      ok: false,
      reason: 'wrong_target',
    });
    // باركود تسوية أمام شاشة تسليم
    expect(matchScan(delivery, { kind: ScanKind.SETTLEMENT, id: ORDER })).toEqual({
      ok: false,
      reason: 'wrong_kind',
    });
    expect(matchScan('random-qr-on-the-wall', { kind: ScanKind.DELIVERY })).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    // بلا معرّف متوقَّع: الشاشة تمسح لتختار العملية
    expect(matchScan(delivery, { kind: ScanKind.DELIVERY }).ok).toBe(true);
  });
});
