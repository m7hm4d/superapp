import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client';
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
