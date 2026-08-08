import type { TokenStorage } from './storage';
import { assertUsableApiUrl, stripLeadingSlashes, stripTrailingSlashes } from './url';
import { uuid } from './uuid';

/** خطأ API موحّد: {code, message?, requestId} من الباكند. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly body: unknown;
  /**
   * ثوانٍ حتى انتهاء الحدّ — من `X-RateLimit-Reset` أو `Retry-After`.
   *
   * بدونها لا تملك الواجهة إلا «حاول لاحقاً»، وهي أسوأ إجابة: من لا يعرف
   * متى يعاود يعاود فوراً فيُمدِّد الحدّ على نفسه.
   */
  readonly retryAfterSec?: number;

  constructor(opts: {
    status: number;
    code: string;
    message?: string;
    requestId?: string;
    body?: unknown;
    retryAfterSec?: number;
  }) {
    super(opts.message ?? opts.code);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.body = opts.body;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

export interface CreateApiClientOptions {
  baseUrl: string;
  storage: TokenStorage;
  onUnauthorized?: () => void;
  /**
   * السماح بـ`http://` — يمرّره التطبيق من إشارة التطوير عنده (`__DEV__`
   * في إكسبو، `NODE_ENV` في اللوحة). افتراضه `false` فيفشل مغلقاً.
   */
  allowInsecureHttp?: boolean;
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

/**
 * رموز تعني أن **الرمز نفسه** لم يعد صالحاً — لا أن العملية فشلت.
 *
 * كان كل 401 يُمسح عنده المخزن ويُقذف المستخدم إلى الدخول. لكن مسارات
 * الأمان تردّ 401 لأسباب مجاليّة: رمز استرداد خاطئ، كلمة مرور حالية
 * خاطئة، رمز مصادقة منتهٍ. فمن أخطأ رمزاً واحداً كان يُطرد من جلسة سليمة
 * ويُقال له إن جلسته انتهت — وهو خبر كاذب يدفعه إلى الظنّ أن حسابه أصابه
 * شيء.
 *
 * فالمسح يقع على هذه وحدها: ما يخصّ التوكن لا ما يخصّ الطلب.
 */
const SESSION_DEAD_CODES = new Set([
  'NO_TOKEN',
  'INVALID_TOKEN',
  'SESSION_REVOKED',
  'TOKEN_SCOPE_FORBIDDEN',
]);

function isSessionDead(body: unknown): boolean {
  const code = (body as ErrorBody | undefined)?.code;
  // الغياب يُعامَل كموت جلسة: 401 بلا رمز معروف غالباً من الحارس لا المجال
  return typeof code !== 'string' || SESSION_DEAD_CODES.has(code);
}

function retryAfterFrom(res?: Response): number | undefined {
  const raw = res?.headers.get('x-ratelimit-reset') ?? res?.headers.get('retry-after');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function toApiError(
  status: number,
  body: unknown,
  fallbackRequestId?: string,
  res?: Response,
): ApiError {
  const e = (body ?? {}) as ErrorBody;
  return new ApiError({
    status,
    retryAfterSec: retryAfterFrom(res),
    code: typeof e.code === 'string' && e.code.length > 0 ? e.code : `HTTP_${status}`,
    message: typeof e.message === 'string' ? e.message : undefined,
    requestId:
      typeof e.requestId === 'string' ? e.requestId : fallbackRequestId,
    body,
  });
}

export function createApiClient(opts: CreateApiClientOptions): ApiClient {
  const { baseUrl, storage, onUnauthorized, allowInsecureHttp = false } = opts;

  // عند الإنشاء لا عند أول طلب: العطل يظهر وقت الإقلاع لا بعد أن يكتب
  // المستخدم كلمة مروره.
  assertUsableApiUrl(baseUrl, allowInsecureHttp);

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
        const errBody = await parseJsonSafe(res);
        if (isSessionDead(errBody)) {
          await storage.clear();
          onUnauthorized?.();
        }
        throw toApiError(res.status, errBody, undefined, res);
      }
    }

    const data = await parseJsonSafe(res);
    if (!res.ok) {
      if (res.status === 401 && !isAuthPath(path) && isSessionDead(data)) {
        // التجديد نجح لكن الطلب المعاد ما زال 401 بسبب التوكن → جلسة ميتة.
        // أما 401 مجاليّ (رمز خاطئ مثلاً) فلا يمسّ الجلسة.
        await storage.clear();
        onUnauthorized?.();
      }
      throw toApiError(res.status, data, undefined, res);
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
