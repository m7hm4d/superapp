import type { TokenStorage } from './storage';
import { stripLeadingSlashes, stripTrailingSlashes } from './url';
import { uuid } from './uuid';

/** خطأ API موحّد: {code, message?, requestId} من الباكند. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly body: unknown;

  constructor(opts: {
    status: number;
    code: string;
    message?: string;
    requestId?: string;
    body?: unknown;
  }) {
    super(opts.message ?? opts.code);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.body = opts.body;
  }
}

export interface CreateApiClientOptions {
  baseUrl: string;
  storage: TokenStorage;
  onUnauthorized?: () => void;
}

export interface ApiClient {
  get<T>(path: string, query?: Record<string, unknown>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
  /**
   * توكن وصول صالح الآن — يجدد تلقائياً إن كان منتهياً أو على وشك الانتهاء.
   * مخصص لاتصال الـ socket (مرره كـ getToken في createSocket).
   */
  getFreshAccessToken(): Promise<string | null>;
  /**
   * خروج يُبطل الجلسة على **الخادم** ثم يمسح المخزن محلياً.
   *
   * مسح المخزن وحده لا يُبطل شيئاً: رمز التحديث يبقى صالحاً حتى انتهائه
   * (ثلاثون يوماً للوحة الإدارة)، فمن نسخه من جهاز مشترك أو نسخة احتياطية
   * يبقى داخل الحساب بعد «الخروج» — والمستخدم يظنّ نفسه خرج.
   *
   * الإبطال أفضل جهد: انقطاع الشبكة لا يجوز أن يحبس أحداً داخل جلسة،
   * فالمسح المحلي يقع في كل الأحوال.
   */
  logout(): Promise<void>;
  readonly baseUrl: string;
  readonly storage: TokenStorage;
}

const API_PREFIX = '/api/v1';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface ErrorBody {
  code?: unknown;
  message?: unknown;
  requestId?: unknown;
}

/**
 * معاملات الاستعلام أوّلية فقط. المصفوفة تُضمّ بفواصل، وأي شيء آخر يُهمَل
 * بدل أن يُرسَل "[object Object]" — الإهمال يُلاحَظ، والقيمة المشوّهة لا.
 */
function serialiseQueryValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const parts = value.map(serialiseQueryValue).filter((v): v is string => v !== null);
    return parts.length > 0 ? parts.join(',') : null;
  }
  return null;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, unknown>,
): string {
  const base = stripTrailingSlashes(baseUrl);
  let p = stripLeadingSlashes(path);
  if (p.startsWith('api/v1/')) {
    p = p.slice('api/v1/'.length);
  }
  let url = `${base}${API_PREFIX}/${p}`;
  if (query) {
    const params: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      // كائن يمرّ عبر String() يصير "[object Object]" في الرابط بصمت —
      // معامل استعلام لا معنى له يصل الخادم بلا أي خطأ يُنبّه.
      const serialised = serialiseQueryValue(value);
      if (serialised === null) continue;
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(serialised)}`);
    }
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
  }
  return url;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toApiError(status: number, body: unknown, fallbackRequestId?: string): ApiError {
  const e = (body ?? {}) as ErrorBody;
  return new ApiError({
    status,
    code: typeof e.code === 'string' && e.code.length > 0 ? e.code : `HTTP_${status}`,
    message: typeof e.message === 'string' ? e.message : undefined,
    requestId:
      typeof e.requestId === 'string' ? e.requestId : fallbackRequestId,
    body,
  });
}

export function createApiClient(opts: CreateApiClientOptions): ApiClient {
  const { baseUrl, storage, onUnauthorized } = opts;

  /** وعد تجديد واحد مشترك بين كل طلبات 401 المتزامنة. */
  let refreshPromise: Promise<boolean> | null = null;

  async function doRefresh(): Promise<boolean> {
    try {
      const refreshToken = await storage.getRefresh();
      if (!refreshToken) return false;
      const res = await fetch(buildUrl(baseUrl, 'auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await parseJsonSafe(res)) as
        | { tokens?: { accessToken?: unknown; refreshToken?: unknown } }
        | undefined;
      const tokens = data?.tokens;
      if (
        !tokens ||
        typeof tokens.accessToken !== 'string' ||
        typeof tokens.refreshToken !== 'string'
      ) {
        return false;
      }
      await storage.set({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
      return true;
    } catch {
      return false;
    }
  }

  function refreshOnce(): Promise<boolean> {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  /** قراءة exp من الـ JWT محلياً بلا تحقق توقيع (للجدولة فقط) */
  function jwtExpMs(token: string): number | null {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      // atob متوفر في Hermes والمتصفح وNode 16+ — يكفي دون Buffer
      if (typeof atob !== 'function') return null;
      const json = atob(b64);
      const exp = (JSON.parse(json) as { exp?: number }).exp;
      return typeof exp === 'number' ? exp * 1000 : null;
    } catch {
      return null;
    }
  }

  async function getFreshAccessToken(): Promise<string | null> {
    const access = await storage.getAccess();
    if (access) {
      const expMs = jwtExpMs(access);
      // صالح لأكثر من دقيقة؟ استخدمه كما هو
      if (expMs !== null && expMs - Date.now() > 60_000) return access;
    }
    const refreshed = await refreshOnce();
    if (!refreshed) return access; // آخر محاولة: الموجود (قد يرفضه الخادم فيعاد لاحقاً)
    return storage.getAccess();
  }

  async function send(
    method: HttpMethod,
    path: string,
    query?: Record<string, unknown>,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    const access = await storage.getAccess();
    if (access) {
      headers['Authorization'] = `Bearer ${access}`;
    }
    // استجابات auth تحمل توكنات/أسرار TOTP — الخادم يستثنيها من الكاش ولا نرسل مفتاحاً لها أصلاً
    if ((method === 'POST' || method === 'PATCH' || method === 'DELETE') && !isSensitivePath(path)) {
      headers['x-idempotency-key'] = uuid();
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(buildUrl(baseUrl, path, query), init);
  }

  function isAuthPath(path: string): boolean {
    const p = path.replace(/^\/+/, '').replace(/^api\/v1\//, '');
    return p === 'auth/login' || p === 'auth/register' || p === 'auth/refresh';
  }

  /** كل ما تحت auth/ (يشمل admin/totp) — لا idempotency له */
  function isSensitivePath(path: string): boolean {
    const p = path.replace(/^\/+/, '').replace(/^api\/v1\//, '');
    return p === 'auth' || p.startsWith('auth/');
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    query?: Record<string, unknown>,
    body?: unknown,
  ): Promise<T> {
    let res = await send(method, path, query, body);

    if (res.status === 401 && !isAuthPath(path)) {
      const refreshed = await refreshOnce();
      if (refreshed) {
        // إعادة المحاولة مرة واحدة فقط بعد تجديد ناجح.
        res = await send(method, path, query, body);
      } else {
        await storage.clear();
        onUnauthorized?.();
        const errBody = await parseJsonSafe(res);
        throw toApiError(res.status, errBody);
      }
    }

    const data = await parseJsonSafe(res);
    if (!res.ok) {
      if (res.status === 401 && !isAuthPath(path)) {
        // التجديد نجح لكن الطلب المعاد ما زال 401 → جلسة غير صالحة.
        await storage.clear();
        onUnauthorized?.();
      }
      throw toApiError(res.status, data);
    }
    return data as T;
  }

  async function logout(): Promise<void> {
    try {
      // توكن وصول صالح أولاً: المسار يتطلب مصادقة، ولولا ذلك لانتهى بـ401
      // فيُمسح المخزن محلياً وتبقى العائلة حيّة على الخادم — وهو العطل عينه.
      // وقراءة رمز التحديث **بعد** التجديد كي يحمل الجسم الرمز الحيّ.
      await getFreshAccessToken();
      const refreshToken = await storage.getRefresh();
      if (refreshToken) {
        await request<unknown>('POST', 'auth/logout', undefined, { refreshToken });
      }
    } catch {
      // متروك عمداً: الفشل هنا لا يمنع الخروج المحلي.
    } finally {
      // بلا onUnauthorized: معناه «سقطت الجلسة فجأة» لا «خرج المستخدم عمداً»،
      // واللوحة تعلّق عليه تنقلاً كاملاً للصفحة. كل تطبيق يعيد حالته بنفسه.
      await storage.clear();
    }
  }

  return {
    baseUrl,
    storage,
    getFreshAccessToken,
    logout,
    get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
      return request<T>('GET', path, query);
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return request<T>('POST', path, undefined, body);
    },
    patch<T>(path: string, body?: unknown): Promise<T> {
      return request<T>('PATCH', path, undefined, body);
    },
    delete<T>(path: string, body?: unknown): Promise<T> {
      return request<T>('DELETE', path, undefined, body);
    },
  };
}
