/**
 * حمولة الباركود لتأكيدات الرموز (تسليم/استلام/تسوية).
 *
 * الشكل: `superapp://confirm/<kind>?id=<uuid>&pin=<4 أرقام>`
 *
 * لماذا يحمل الباركود المعرّف لا الرمز وحده: الماسح يتحقق أنه مسح باركود
 * العملية التي أمامه فعلاً قبل الإرسال — فلا يُسلَّم طلب بباركود طلب آخر
 * (وهو خطأ وارد حين يحمل السائق عدة طلبات). الرمز نفسه يبقى قصيراً كما هو،
 * والتحقق النهائي يبقى عند الخادم دائماً؛ الباركود اختصار إدخال لا إذن.
 */

export const SCAN_SCHEME = 'superapp';

export const ScanKind = {
  DELIVERY: 'delivery',
  PICKUP: 'pickup',
  SETTLEMENT: 'settlement',
} as const;
export type ScanKind = (typeof ScanKind)[keyof typeof ScanKind];

export interface ScanPayload {
  kind: ScanKind;
  /** معرّف الطلب أو الدفعة أو التسوية بحسب النوع */
  id: string;
  pin: string;
}

const PIN_RE = /^\d{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: readonly string[] = Object.values(ScanKind);

/** يبني نص الباركود المعروض */
export function buildScanPayload(payload: ScanPayload): string {
  if (!PIN_RE.test(payload.pin)) throw new Error('رمز غير صالح — 4 أرقام');
  if (!UUID_RE.test(payload.id)) throw new Error('معرّف غير صالح');
  return `${SCAN_SCHEME}://confirm/${payload.kind}?id=${payload.id}&pin=${payload.pin}`;
}

/**
 * يفكّ نص الباركود الممسوح. يعيد null لأي نص لا يطابق الشكل تماماً —
 * الماسح قد يلتقط أي باركود في الإطار، فالرفض الصامت هو السلوك الصحيح.
 */
export function parseScanPayload(raw: string): ScanPayload | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  const match = /^superapp:\/\/confirm\/([a-z]+)\?(.+)$/i.exec(text);
  const rawKind = match?.[1];
  const rawQuery = match?.[2];
  if (!rawKind || !rawQuery) return null;

  const kind = rawKind.toLowerCase();
  if (!KINDS.includes(kind)) return null;

  let id: string | undefined;
  let pin: string | undefined;
  for (const part of rawQuery.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 'id') id = value;
    else if (key === 'pin') pin = value;
  }
  if (!id || !pin || !UUID_RE.test(id) || !PIN_RE.test(pin)) return null;

  return { kind: kind as ScanKind, id, pin };
}

export type ScanMatch =
  | { ok: true; payload: ScanPayload }
  | { ok: false; reason: 'unreadable' | 'wrong_kind' | 'wrong_target' };

/**
 * يطابق الباركود الممسوح مع العملية المفتوحة أمام المستخدم.
 * expectedId اختياري: بعض الشاشات تمسح لتختار العملية لا لتؤكد واحدة بعينها.
 */
export function matchScan(raw: string, expected: { kind: ScanKind; id?: string }): ScanMatch {
  const payload = parseScanPayload(raw);
  if (!payload) return { ok: false, reason: 'unreadable' };
  if (payload.kind !== expected.kind) return { ok: false, reason: 'wrong_kind' };
  if (expected.id && payload.id !== expected.id) return { ok: false, reason: 'wrong_target' };
  return { ok: true, payload };
}
