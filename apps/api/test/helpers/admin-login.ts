import request from 'supertest';
import { currentTotpStep, totp } from '../../src/modules/auth/totp';

/**
 * دخول الأدمن في الاختبارات: TOTP إلزامي، ولا يُقبل الرمز نفسه مرتين —
 * فينتظر المساعد خطوة زمنية جديدة عند الحاجة بدل أن يفشل عشوائياً.
 */
const ADMIN_EMAIL = 'admin@superapp.local';

let lastUsedStep = -1;

export function adminCredentialsFromEnv(): { email: string; password: string; secret: string } {
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  const secret = process.env.SEED_ADMIN_TOTP_SECRET ?? '';
  if (!password || !secret) {
    throw new Error('SEED_ADMIN_PASSWORD وSEED_ADMIN_TOTP_SECRET مطلوبان لاختبارات الأدمن');
  }
  return { email: ADMIN_EMAIL, password, secret };
}

/**
 * رمز TOTP على خطوة لم تُستهلك بعد.
 *
 * الرمز لا يُقبل مرتين، وملفات الاختبار تتشارك حساب أدمن واحد — فمن يولّد
 * رمزاً بلا انتظار قد يصطدم بخطوة استهلكها غيره ويفشل عشوائياً.
 */
/**
 * جلسة أدمن بلا انتظار خطوة زمنية.
 *
 * `loginAdmin` ينتظر خطوة جديدة لأن الرمز لا يُقبل مرتين — وهو صحيح للحزمة
 * كلها. لكن اختباراً يحتاج جلستين متتاليتين ينتظر ثلاثين ثانية بلا فائدة،
 * فيُصفَّر عدّاد الاستهلاك بدلاً من ذلك: إعداد اختبار لا تغيير منتج، ومنعُ
 * إعادة الاستعمال مُختبَر في `admin-totp.e2e`.
 */
export async function loginAdminNow(
  http: Parameters<typeof request>[0],
  resetStep: () => Promise<unknown>,
): Promise<string> {
  const { email, password, secret } = adminCredentialsFromEnv();
  await resetStep();
  const res = await request(http)
    .post('/api/v1/auth/admin/login')
    .send({ email, password, totp: totp.generate(secret) });
  if (res.status !== 200 || res.body.status !== 'ok') {
    throw new Error(`دخول الأدمن فشل (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.tokens.accessToken as string;
}

export async function freshTotp(secret: string): Promise<string> {
  await waitForNewStep();
  return totp.generate(secret);
}

async function waitForNewStep(): Promise<void> {
  while (currentTotpStep() === lastUsedStep) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  lastUsedStep = currentTotpStep();
}

/**
 * يعيد access token لجلسة أدمن كاملة.
 * ملفات الاختبار تعمل متوازية على حساب أدمن واحد، فقد يسبقنا ملف آخر إلى
 * رمز الخطوة نفسها — الرد حينها TOTP_ALREADY_USED فننتظر الخطوة التالية.
 */
export async function loginAdmin(http: Parameters<typeof request>[0]): Promise<string> {
  const { email, password, secret } = adminCredentialsFromEnv();

  for (let attempt = 0; attempt < 6; attempt++) {
    await waitForNewStep();
    const res = await request(http)
      .post('/api/v1/auth/admin/login')
      .send({ email, password, totp: totp.generate(secret) });

    if (res.status === 200 && res.body.status === 'ok') {
      return res.body.tokens.accessToken as string;
    }
    if (res.status === 401 && res.body.code === 'TOTP_ALREADY_USED') {
      continue; // سبقنا ملف آخر إلى هذه الخطوة
    }
    if (res.status === 429) {
      // اختبار حد المحاولات استهلك الحصة — النافذة قصيرة في الاختبارات
      await new Promise((r) => setTimeout(r, 1500));
      lastUsedStep = -1;
      continue;
    }
    throw new Error(`دخول الأدمن فشل (${res.status}): ${JSON.stringify(res.body)}`);
  }
  throw new Error('تعذّر دخول الأدمن بعد عدة محاولات — تعارض رموز TOTP');
}
