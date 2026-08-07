import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import { api, enrollApi } from './api';
import type { AuthTokens, AuthUser } from '@superapp/shared';

/**
 * مفاتيح المرور: المتصفح يوقّع التحدي بمفتاح مربوط بالنطاق، فلا يُصطاد
 * كما يُصطاد رمز TOTP. الخادم يبقى مصدر التحقق في الحالتين.
 */

export const passkeySupported = (): boolean => browserSupportsWebAuthn();

/**
 * عامل ثانٍ لا أول: يلزمه `stepUpToken` الصادر بعد التحقق من كلمة المرور.
 * الخيارات مقصورة على مفاتيح هذا الحساب، فلا يُطلب من المستخدم اختيار حساب.
 */
export async function loginWithPasskey(
  stepUpToken: string,
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const options = await api.post<Record<string, unknown>>('auth/admin/passkey/login/options', {
    stepUpToken,
  });
  const response = await startAuthentication({ optionsJSON: options as never });
  return api.post('auth/admin/passkey/login/verify', { response, stepUpToken });
}

/** يعمل بجلسة كاملة أو بتوكن تسجيل (أول دخول) — لذا يُمرَّر العميل المناسب */
export async function registerPasskey(
  label: string,
  client: typeof api = api,
): Promise<{ id: string; label: string }> {
  const options = await client.post<Record<string, unknown>>(
    'auth/admin/passkey/register/options',
  );
  const response = await startRegistration({ optionsJSON: options as never });
  return client.post('auth/admin/passkey/register/verify', { response, label });
}

export const enrollmentClient = enrollApi;
