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
    - في الإنتاج: `WEBAUTHN_RP_ID=admin.4irq.com` و`WEBAUTHN_ORIGINS=https://admin.4irq.com`. يُفضَّل نطاق فرعي مخصص لا الجذر — فالمفتاح المسجَّل على الجذر يصلح لكل نطاق فرعي تحته.
- مخابز: `+9647701000001..6` / `Vendor#12345`
- سائقون: `+9647702000001..2` / `Driver#12345`
- عملاء: `+9647703000001..3` / `Customer#12345`

## الاختبارات

```bash
pnpm --filter @superapp/api test
```

تغطي: آلة حالات الطلب كاملة، سباق قبول الدفعات، PINات الاستلام/التسليم/التسوية، الدفتر والقيود العكسية، idempotency، وتدوير التوكنات.

## النشر على VPS

`docker-compose.prod.yml` يشغّل الحزمة كاملة: PostGIS + الـAPI + لوحة الإدارة + Caddy
للـTLS. المنافذ المكشوفة هي 80 و443 فقط — القاعدة والـAPI واللوحة على شبكة داخلية
لا تُرى من الإنترنت.

الحد الأدنى المجرَّب: نواتان و4 GiB. مع 8 GiB فأكثر يمكن البناء على الخادم نفسه؛
دون ذلك ابنِ الصور في CI وادفعها إلى مسجّل.

### ١. تهيئة الخادم

```bash
curl -fsSL https://get.docker.com | sh
```

### ٢. الـDNS قبل كل شيء

سجلّا `A` يشيران إلى عنوان الخادم — `admin.4irq.com` و`api.4irq.com`. لا يصدر Caddy
شهادة قبل أن ينتشر السجلّ، فتحقق أولاً:

```bash
dig +short admin.4irq.com api.4irq.com
```

### ٣. الأسرار

```bash
cp .env.prod.example .env.prod && chmod 600 .env.prod
```

```bash
openssl rand -base64 36
```

عبّئ `JWT_ACCESS_SECRET` و`JWT_REFRESH_SECRET` و`POSTGRES_PASSWORD` بقيم مولّدة،
واضبط `DATABASE_URL` بكلمة المرور نفسها.

> ‏`NEXT_PUBLIC_API_URL` يُخبَز في حزمة المتصفح وقت البناء، وتغييره لاحقاً يستلزم
> `--build` لا `restart`. وقيمته الأصل وحده — عميل الـAPI يضيف `/api/v1` بنفسه.

### ٤. أدوات التحقق

الخادم يشغّل صوراً **موقَّعة** يبنيها CI وينشرها على GHCR — لا يبني شيئاً بنفسه.
والتحقق من التوقيع يحتاج `cosign`:

```bash
curl -sSLo cosign https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64
```

```bash
sudo install -m 755 cosign /usr/local/bin/cosign && rm cosign
```

### ٥. الإقلاع

```bash
./deploy/deploy.sh
```

يسحب آخر صور منشورة، **ويتحقق من توقيعها قبل تشغيلها**، ثم يُقلع الحزمة.
صورة لم تخرج من `publish.yml` في هذا المستودع لا تعمل — ولو دُفعت إلى الوسم
نفسه. والتشغيل يتم بالـ`digest` لا بالوسم، فما جرى التحقق منه هو بالضبط ما
يعمل.

خدمة `migrate` تطبّق الهجرات وتخرج، ولا يقلع الـAPI قبل نجاحها — فلا تعمل نسخة
جديدة على مخطط قديم.

### ٦. الـseed مرة واحدة

ينشئ حساب الأدمن والمدينة والأدوار:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api \
  node -r ./dist/apps/api/src/register-paths.js dist/apps/api/src/db/seed/seed.js
```

ثم افرغ `SEED_ADMIN_PASSWORD` من `.env.prod`. أول دخول إلى `https://admin.4irq.com`
يطلب تسجيل TOTP أو مفتاح مرور.

### العودة إلى إصدار سابق

كل نشرة تحمل وسم `sha-<short>` من الكوميت الذي أنتجها:

```bash
./deploy/deploy.sh sha-a1b2c3d
```

بلا إعادة بناء وبلا `git revert` — والتوقيع يُتحقَّق منه كما في أي نشرة.

### التشغيل اليومي

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api
```

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
  pg_dump -U superapp superapp | gzip > backup-$(date +%F).sql.gz
```

للتحديث: ادمج في `main` فينشر CI صوراً جديدة موقَّعة، ثم على الخادم
`./deploy/deploy.sh`. لا بناء على الخادم إطلاقاً.

للبناء محلياً (تطوير أو تجربة قبل الدفع):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.build.yml --env-file .env.prod build
```

### ملاحظات تشغيلية

- **`TRUST_PROXY=1` إلزامي خلف Caddy**. بدونه يرى الـAPI عنوان الوكيل لكل
  الزوار: حدّ محاولات الدخول يصير مشتركاً بين الجميع، وسجل الجلسات يقيّد عنواناً
  واحداً لا عنوان الأدمن. يقابله `header_up X-Forwarded-For {remote_host}` في
  `deploy/Caddyfile` — استبدال لا إلحاق، وإلا زوّر العميل الترويسة وأسقط الحدّ.
  إن أُضيف وكيل آخر أمام Caddy (‏Cloudflare مثلاً) ارفع القيمة إلى 2 واضبط
  `trusted_proxies` في Caddy.
- **حجم `caddy_data` يحمل الشهادات**. حذفه يعني إعادة إصدار من Let's Encrypt
  واصطداماً بحدود المعدل عند التكرار.
- **الصور تُبنى في CI لا على الخادم.** ‏`docker-compose.prod.yml` لا يحوي أي
  `build:` عمداً: ما يعمل في الإنتاج هو بالضبط ما بناه CI ووقّعه. البناء
  المحلي عبر تراكب `docker-compose.build.yml`.
- **‏`NEXT_PUBLIC_API_URL` يُخبَز في صورة اللوحة وقت بنائها في CI**، وقيمته
  من متغيّر المستودع على GitHub لا من `.env.prod`. تغييره يستلزم إعادة نشر.
- **تغيير `WEBAUTHN_RP_ID` يبطل كل مفاتيح المرور المسجّلة** — النطاق جزء من
  المفتاح تشفيرياً. اختر النطاق النهائي قبل أن يسجّل أحد مفتاحه.

### تطبيقات الهاتف

خارج Docker — التوزيع عبر EAS:

```bash
pnpm exec eas build --platform android
```

## ملاحظات مونوريبو مهمة

- ‏`node-linker=hoisted` في `.npmrc` ضروري لتوافق Metro.
- إصدارات Expo/RN مثبتة عبر `overrides` في `pnpm-workspace.yaml` — لا ترفعها يدوياً؛ استخدم `expo install --fix`.
- ‏`apps/api/src/register-paths.ts` يجب أن يبقى أول استيراد في `main.ts` (حلّ `@superapp/shared` في الناتج المجمّع).

## المساهمة والأمان والترخيص

- المساهمة وسير العمل وشروط الدمج: [CONTRIBUTING.md](CONTRIBUTING.md)
- الإبلاغ عن ثغرة (لا تفتح Issue عاماً): [SECURITY.md](SECURITY.md)
- الترخيص: [LICENSE](LICENSE) — **مرئي للاطلاع فقط، وليس مفتوح المصدر**. جميع الحقوق محفوظة، ولا يمنح النشر على GitHub أي ترخيص استخدام.
