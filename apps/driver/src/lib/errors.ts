/** استخراج code من ApiError دون الاعتماد على instanceof عبر حدود الحزم */
export function errorCode(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

/** CASH_MISMATCH يحمل expected في جسم الخطأ */
export function errorExpectedIqd(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'body' in e) {
    const body = (e as { body?: unknown }).body;
    if (typeof body === 'object' && body !== null && 'expected' in body) {
      const expected = (body as { expected?: unknown }).expected;
      if (typeof expected === 'number') return expected;
    }
  }
  return undefined;
}
