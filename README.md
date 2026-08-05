# سوبر آب — منصة التوصيل المحلي (طيار المخابز)

منصة توصيل لحي واحد تبدأ بالمخابز: تطبيق عميل وتطبيق مخبز وتطبيق سائق (هواتف فقط) ولوحة إدارة ويب، بالدفع عند الاستلام حصراً.

مواصفات المنتج الكاملة في:
[local-delivery-mvp-screen-map-ar.md](local-delivery-mvp-screen-map-ar.md)

## البنية

```
apps/     api (NestJS + Drizzle + PostGIS + Socket.io)
          customer · vendor · driver (Expo SDK 54 — هاتف فقط)
          admin (Next.js 15 — ويب)
packages/ shared (Zod + آلات الحالة الثلاث) · api-client · map (MapLibre)
          ui (NativeWind) · i18n (عربي/إنجليزي) · config (رموز التصميم)
```

- ثلاث آلات حالة منفصلة: الطلب، دفعة التوصيل، التسوية المالية.
- الخادم ينشئ الدفعات (1–3 طلبات من المخبز نفسه)، قبول ذري، ودفعة نشطة واحدة لكل سائق.
- تحقق PIN في الاستلام والتسليم والتسوية، ودفتر مالي append-only لا يُحذف (تصحيح بقيد عكسي).
- ‏Socket.io للإشعار فقط — الحقيقة دائماً عبر REST مع idempotency keys.

## المتطلبات

- Node 22+ و pnpm 11
- PostgreSQL 17 + PostGIS (محلياً عبر Homebrew، أو `docker compose up db`)
- ‏Xcode / Android Studio لتشغيل التطبيقات (dev build — لا يعمل Expo Go بسبب MapLibre)

## التشغيل المحلي

```bash
pnpm install
```

قاعدة البيانات (مرة واحدة):

```bash
createdb superapp
psql -d superapp -c "CREATE EXTENSION postgis;"
```

ثم من `apps/api` (انسخ `.env.example` إلى `.env` وعدّل الأسرار):

```bash
pnpm --filter @superapp/api db:migrate
```

```bash
pnpm --filter @superapp/api db:seed
```

تشغيل الخدمات:

```bash
pnpm dev:api
```

```bash
pnpm dev:admin
```

لوحة الإدارة: `http://localhost:3001` — الباكند: `http://localhost:3000/api/v1`

> ‏`tsconfig` الخاص بالـAPI يضم `packages/shared/src` (تُستهلك كمصدر TS)، فجذر الإخراج المستنتج هو جذر المستودع ويصبح الناتج `dist/apps/api/src/main.js` لا `dist/main.js`. لذلك يصرّح `nest-cli.json` بـ`entryFile` بمساره الفعلي — وهو المسار نفسه في `start:prod` وفي `Dockerfile`. حذفه يكسر `pnpm dev:api` بخطأ `Cannot find module '.../dist/main'`.

التطبيقات (كل تطبيق بمنفذ Metro خاص):

```bash
pnpm dev:customer
```

```bash
pnpm dev:vendor
```

```bash
pnpm dev:driver
```

وللبناء الأصلي على المحاكي من مجلد التطبيق:

```bash
pnpm exec expo run:ios
```

**قاعدة ذهبية عند تشغيل أكثر من تطبيق معاً**: لا تفتح التطبيق بأيقونته (لوحة dev-client قد تصله بخادم تطبيق آخر فيظهر خطأ `NativeEventEmitter`). استخدم السكربت الذي يوصله بمنفذه الصحيح دائماً:

```bash
./scripts/sim.sh vendor
```

```bash
./scripts/sim.sh customer
```

```bash
./scripts/sim.sh driver
```

## بيانات الدخول التجريبية (من الـ seed)

- أدمن اللوحة: `admin@superapp.local` — كلمة المرور تأتي من `SEED_ADMIN_PASSWORD` عند تشغيل الـ seed، وإن لم تُعيَّن تُولَّد عشوائياً وتُطبع مرة واحدة في مخرجات الـ seed (لا توجد كلمة مرور افتراضية منشورة). دخول الأدمن حصراً من لوحة الويب — مسار الهاتف `/auth/login` يرفض حسابات الأدمن.
  - **المصادقة الثنائية إلزامية**: بعد البريد وكلمة المرور تُطلب رموز TOTP. حساب لم يسجّل جهازه بعد لا يحصل على جلسة إدارية، بل يُنقل إلى شاشة `/enroll` لمسح باركود بتطبيق المصادقة (Google Authenticator أو ما يماثله) وتأكيد أول رمز.
  - للتطوير والاختبارات الآلية فقط: `SEED_ADMIN_TOTP_SECRET` يزرع سراً جاهزاً فيتخطى الـseed خطوة التسجيل. اتركه فارغاً في أي بيئة حقيقية.
  - **مفاتيح المرور (Passkeys)**: بديل أقوى وأسهل من TOTP — بصمة الجهاز بلا كلمة مرور ولا رمز، ولا يمكن تصيّده لأنه مربوط بنطاق اللوحة، ويعود تلقائياً على الهاتف الجديد عبر مزامنة iCloud/Google. يُسجَّل من «الإعدادات ← مفاتيح المرور» أو عند أول دخول بدل TOTP.
    - يتطلب **نطاقاً حقيقياً على HTTPS**: `WEBAUTHN_RP_ID` و`WEBAUTHN_ORIGINS`. عنوان IP لا يصلح إطلاقاً (المواصفة تستثني `localhost` للتطوير فقط).
- مخابز: `+9647701000001..6` / `Vendor#12345`
- سائقون: `+9647702000001..2` / `Driver#12345`
- عملاء: `+9647703000001..3` / `Customer#12345`

## الاختبارات

```bash
pnpm --filter @superapp/api test
```

تغطي: آلة حالات الطلب كاملة، سباق قبول الدفعات، PINات الاستلام/التسليم/التسوية، الدفتر والقيود العكسية، idempotency، وتدوير التوكنات.

## النشر

`docker-compose.yml` يشغّل PostGIS + الـ API (مع healthcheck). ضع Caddy أو أي reverse proxy أمامه للـ TLS، وانشر لوحة الإدارة بـ `next build` على أي مضيف Node. بناء التطبيقات للتوزيع عبر EAS:

```bash
pnpm exec eas build --platform android
```

## ملاحظات مونوريبو مهمة

- ‏`node-linker=hoisted` في `.npmrc` ضروري لتوافق Metro.
- إصدارات Expo/RN مثبتة عبر `overrides` في `pnpm-workspace.yaml` — لا ترفعها يدوياً؛ استخدم `expo install --fix`.
- ‏`apps/api/src/register-paths.ts` يجب أن يبقى أول استيراد في `main.ts` (حلّ `@superapp/shared` في الناتج المجمّع).
