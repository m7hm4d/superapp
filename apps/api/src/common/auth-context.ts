import type { AuthContext } from '../modules/auth/auth-events.service';

interface RequestLike {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, unknown>;
  id?: string;
}

/** IPv4 المغلَّف بـIPv6 (::ffff:1.2.3.4) يُعرض كما هو مألوف */
function normalizeIp(raw?: string | null): string | null {
  if (!raw) return null;
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/**
 * سياق المصادقة من الطلب: العنوان والجهاز ومعرّف الطلب.
 * ملاحظة تشغيلية: خلف وكيل عكسي يجب ضبط trust proxy وإلا كان العنوان
 * هو عنوان الوكيل لا العميل.
 */
export function authContextFrom(req: RequestLike): AuthContext {
  const userAgent = req.headers?.['user-agent'];
  return {
    ip: normalizeIp(req.ip ?? req.socket?.remoteAddress ?? null),
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}
