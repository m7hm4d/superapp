import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client';
import { InsecureApiUrlError } from '../src/url';
import { memoryStorage } from '../src/storage';

/**
 * انحدار: «الخروج» الذي لا يُخرج.
 *
 * كان كل عميل يمسح التوكنات محلياً ولا يستدعي auth/logout إطلاقاً، فيبقى
 * رمز التحديث صالحاً على الخادم حتى انتهائه — ثلاثون يوماً في لوحة الإدارة.
 * من نسخ الرمز من متصفح مشترك أو نسخة احتياطية يظل داخل الحساب، والمستخدم
 * يظن نفسه خرج. لا شيء في الواجهة يكشف الفرق: الشاشة تعود لصفحة الدخول
 * في الحالتين.
 */
describe('client.logout revokes the session server-side', () => {
  /**
   * توكن وصول موقّع صورياً — التحقق على الخادم، وهنا يهمّ exp فقط.
   * ‏btoa لا Buffer: الحزمة تتجنب @types/node عمداً كي لا تُحمّل مستهلكيها
   * غير العاملين على Node.
   */
  const jwtExpiringIn = (seconds: number): string => {
    const json = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds });
    const payload = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `header.${payload}.signature`;
  };

  const seeded = async (accessTtlSec = 3600) => {
    const storage = memoryStorage();
    await storage.set({ accessToken: jwtExpiringIn(accessTtlSec), refreshToken: 'refresh-0' });
    return storage;
  };

  const jsonOk = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('يستدعي auth/logout حاملاً رمز التحديث ثم يمسح المخزن', async () => {
    const storage = await seeded();
    fetchMock.mockResolvedValue(jsonOk({ ok: true }));
    const client = createApiClient({ baseUrl: 'https://api.test', storage });

    await client.logout();

    const calls = fetchMock.mock.calls;
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/v1/auth/logout');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'refresh-0' });
    // المسار يتطلب مصادقة — بلا الترويسة يعود 401 ولا يُبطل شيئاً
    expect((init.headers as Record<string, string>)['Authorization']).toMatch(/^Bearer /);

    expect(await storage.getAccess()).toBeNull();
    expect(await storage.getRefresh()).toBeNull();
  });

  /**
   * الشبكة تسقط، والمستخدم على جهاز مشترك يريد الخروج الآن. حبسه داخل
   * جلسة مفتوحة أسوأ من رمز يبقى حياً على خادم لا يصله أصلاً.
   */
  it('يمسح المخزن ولا يرمي حتى لو فشلت الشبكة', async () => {
    const storage = await seeded();
    fetchMock.mockRejectedValue(new Error('network down'));
    const client = createApiClient({ baseUrl: 'https://api.test', storage });

    await expect(client.logout()).resolves.toBeUndefined();
    expect(await storage.getRefresh()).toBeNull();
  });

  it('يمسح المخزن ولا يرمي حتى لو رفض الخادم', async () => {
    const storage = await seeded();
    fetchMock.mockResolvedValue(new Response('{"code":"BOOM"}', { status: 500 }));
    const client = createApiClient({ baseUrl: 'https://api.test', storage });

    await expect(client.logout()).resolves.toBeUndefined();
    expect(await storage.getRefresh()).toBeNull();
  });

  it('بلا رمز تحديث لا طلب — ولا شيء يُبطَل', async () => {
    const storage = memoryStorage();
    const client = createApiClient({ baseUrl: 'https://api.test', storage });

    await client.logout();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * ترتيب مقصود: التجديد **قبل** قراءة رمز التحديث.
   *
   * لو قُرئ أولاً لحمل الجسم رمزاً مدوَّراً، ولو أُرسل الطلب بتوكن وصول
   * منتهٍ لعاد 401 فمُسح المخزن محلياً وبقيت العائلة حيّة — وهو العطل عينه
   * يعود من باب آخر.
   */
  it('يجدّد توكن الوصول المنتهي ويرسل رمز التحديث الحيّ', async () => {
    const storage = await seeded(-10); // منتهٍ
    fetchMock
      .mockResolvedValueOnce(
        jsonOk({ tokens: { accessToken: jwtExpiringIn(3600), refreshToken: 'refresh-1' } }),
      )
      .mockResolvedValueOnce(jsonOk({ ok: true }));
    const client = createApiClient({ baseUrl: 'https://api.test', storage });

    await client.logout();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [refreshUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(refreshUrl).toBe('https://api.test/api/v1/auth/refresh');

    const [logoutUrl, logoutInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(logoutUrl).toBe('https://api.test/api/v1/auth/logout');
    expect(JSON.parse(logoutInit.body as string)).toEqual({ refreshToken: 'refresh-1' });
  });
});

/**
 * انحدار: نسخة إصدار بعنوان غير مشفَّر.
 *
 * تطبيقات إكسبو الثلاثة تقرأ `EXPO_PUBLIC_API_URL` وتسقط إلى
 * `http://localhost:3000` افتراضاً، ولم يكن شيء يمنع بناء نسخة إنتاج بعنوان
 * ‏HTTP بعيد: كلمة المرور ورمزا الوصول والتجديد تُرسل على الشبكة بلا تشفير،
 * ولا شيء في التطبيق يُظهر ذلك. تطبيق فلاتر حصل على هذه الحماية، وهذه هي
 * نفسها في الحزمة المشتركة فتغطي الأربعة.
 */
describe('createApiClient يرفض العناوين غير المشفَّرة', () => {
  const storage = memoryStorage();

  it('يرفض HTTP بعيداً في الإصدار — قبل أي طلب', () => {
    expect(() =>
      createApiClient({ baseUrl: 'http://api.example.com', storage }),
    ).toThrow(InsecureApiUrlError);
  });

  it('يرفض حتى localhost في الإصدار', () => {
    expect(() => createApiClient({ baseUrl: 'http://localhost:3000', storage })).toThrow(
      InsecureApiUrlError,
    );
  });

  it('يقبل HTTPS دائماً', () => {
    expect(() => createApiClient({ baseUrl: 'https://api.example.com', storage })).not.toThrow();
  });

  /** الاختبار على جهاز حقيقي يمرّ بعنوان الشبكة المحلية — حظره يدفع لتعطيل الفحص */
  it('يقبل HTTP في التطوير على أي مضيف', () => {
    for (const url of ['http://localhost:3000', 'http://192.168.1.5:3000', 'http://10.0.2.2:3000']) {
      expect(() =>
        createApiClient({ baseUrl: url, storage, allowInsecureHttp: true }),
      ).not.toThrow();
    }
  });

  it('يرفض ما ليس عنواناً أصلاً', () => {
    expect(() => createApiClient({ baseUrl: 'api.example.com', storage })).toThrow(
      InsecureApiUrlError,
    );
  });
});

/**
 * انحدار: خطأ مجاليّ يُطرد المستخدم من جلسة سليمة.
 *
 * كل 401 كان يمسح المخزن ويستدعي `onUnauthorized`. لكن مسارات الأمان تردّ
 * 401 لأسباب مجاليّة — رمز استرداد خاطئ، كلمة مرور حالية خاطئة، رمز مصادقة
 * منتهٍ. فمن أخطأ رمزاً واحداً كان يُقذف إلى صفحة الدخول ويُقال له إن جلسته
 * انتهت: خبر كاذب يدفعه إلى الظنّ أن حسابه أصابه شيء.
 */
describe('401 مجاليّ لا يُنهي الجلسة', () => {
  const seedTokens = async () => {
    const storage = memoryStorage();
    await storage.set({ accessToken: jwtValidFor(3600), refreshToken: 'refresh-0' });
    return storage;
  };
  const jwtValidFor = (seconds: number): string => {
    const json = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds });
    const payload = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `header.${payload}.signature`;
  };
  const unauthorized = (code: string) =>
    new Response(JSON.stringify({ code }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('رمز استرداد خاطئ: يرمي ولا يمسح ولا يستدعي onUnauthorized', async () => {
    const storage = await seedTokens();
    const onUnauthorized = vi.fn();
    // الطلب أولاً فيعود 401، ثم التجديد ينجح، ثم يعود الطلب 401 مجاليّاً
    fetchMock
      .mockResolvedValueOnce(unauthorized('RECOVERY_CODE_INVALID'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ tokens: { accessToken: jwtValidFor(3600), refreshToken: 'r1' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValue(unauthorized('RECOVERY_CODE_INVALID'));

    const client = createApiClient({ baseUrl: 'https://api.test', storage, onUnauthorized });
    await expect(client.post('auth/admin/password', {})).rejects.toMatchObject({
      code: 'RECOVERY_CODE_INVALID',
    });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(await storage.getRefresh()).toBe('r1'); // الجلسة سليمة
  });

  it('وكذلك كلمة مرور حالية خاطئة', async () => {
    const storage = await seedTokens();
    const onUnauthorized = vi.fn();
    fetchMock.mockResolvedValue(unauthorized('INVALID_CREDENTIALS'));

    const client = createApiClient({ baseUrl: 'https://api.test', storage, onUnauthorized });
    await expect(client.post('auth/admin/password', {})).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(await storage.getRefresh()).not.toBeNull();
  });

  /** أما ما يخصّ التوكن فيُنهي الجلسة كما يجب */
  it('SESSION_REVOKED يمسح ويستدعي onUnauthorized', async () => {
    const storage = await seedTokens();
    const onUnauthorized = vi.fn();
    fetchMock.mockResolvedValue(unauthorized('SESSION_REVOKED'));

    const client = createApiClient({ baseUrl: 'https://api.test', storage, onUnauthorized });
    await expect(client.get('auth/me')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(await storage.getRefresh()).toBeNull();
  });

  /** و401 بلا رمز معروف يُعامَل كموت جلسة — الغياب يفشل إلى الجانب الآمن */
  it('401 بلا رمز يُنهي الجلسة', async () => {
    const storage = await seedTokens();
    const onUnauthorized = vi.fn();
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));

    const client = createApiClient({ baseUrl: 'https://api.test', storage, onUnauthorized });
    await expect(client.get('auth/me')).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalled();
  });
});
