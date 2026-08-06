# المساهمة

## التهيئة

المتطلبات وأوامر التشغيل في [README](README.md#المتطلبات). باختصار:

```bash
pnpm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
pnpm --filter @superapp/api db:migrate && pnpm --filter @superapp/api db:seed
```

## سير العمل

`main` محمي: **لا دفع مباشر إليه ولا force push**. كل تغيير يمرّ بفرع وPR.

```bash
git checkout -b fix/short-description
```

```bash
git push -u origin fix/short-description
```

بادئات الفروع المستخدمة: `feat/` و`fix/` و`chore/` و`docs/` و`deploy/`.

## شروط الدمج

يفرضها الـruleset على `main` — الزر الأخضر لا يظهر قبل تحققها:

- **‏`test` تنجح** — typecheck على الحزم العشر، ثم الهجرات والـseed، ثم اختبارات
  e2e، ثم بناء لوحة الإدارة.
- **‏`analyze` تنجح** — تحليل CodeQL.
- **الفرع محدَّث من `main`** — ادمج أو أعد الأساس قبل الدمج.
- **كل محادثات المراجعة محلولة.**

الدمج بـ**Squash and merge**: فرع واحد لكل تغيير، فيصير كوميتًا واحدًا في `main`
يحمل رقم الـPR.

## الاختبارات

```bash
pnpm --filter @superapp/api test
```

تحتاج قاعدة بيانات تعمل. لقاعدة مؤقتة:

```bash
docker run -d --name superapp-test-db -e POSTGRES_USER=superapp \
  -e POSTGRES_PASSWORD=superapp -e POSTGRES_DB=superapp \
  -p 5433:5432 postgis/postgis:17-3.5
```

### ما نتوقعه من اختبار

الاختبارات هنا **e2e ضد قاعدة حقيقية**، لا وحدات بمحاكيات. القاعدة العملية:

> **شغّل الاختبار الجديد على الكود قبل الإصلاح وتأكد أنه يسقط.**

اختبار لم يسقط قبل الإصلاح لا يثبت شيئًا عنه. وهذا مطلوب خصوصًا في إصلاحات
السباق الزمني والتزامن — وهي كثيرة في هذا المشروع (‏idempotency، وقبول الدفعات،
والتسويات).

وتجنّب تأكيدات الأداء على أرقام صغيرة: قياس دون المللي ثانية يقيس ضجيج المؤقّت لا
الخوارزمية، فاستعمل حدًّا مطلقًا يفصل بين السلوكين بمرتبة من حيث القدر.

## الأسلوب

- **العربية لغة التوثيق والتعليقات** — الـREADME والتعليقات في الكود بالعربية،
  وأسماء المعرّفات بالإنجليزية.
- **علّل السبب لا الفعل.** التعليق يشرح *لماذا* هذا الحلّ، لأن *ماذا* يقرأه أي
  أحد من الكود.
- اتبع أسلوب الملف الذي تعدّله: كثافة التعليقات نفسها، والتسمية نفسها.

## رسائل الكوميت

نمط [Conventional Commits](https://www.conventionalcommits.org/):

```
fix(api-client): replace ReDoS-prone slash trimming with a linear scan
```

النطاقات المستعملة: `api` و`admin` و`api-client` و`shared` و`ui` و`deps` و`deploy`
و`auth`.

اشرح في المتن **لماذا** كان التغيير ضروريًا وما الذي يثبت صحته. أرقام القياس
والفشل قبل الإصلاح أنفع من وصف الأسطر.

## تنبيهات المستودع

- **الهجرات**: عدّل `apps/api/src/db/schema/` ثم ولّد الهجرة بـdrizzle-kit — لا
  تكتب SQL يدويًا ولا تعدّل هجرة مدموجة.
- **إصدارات Expo/RN** مثبتة عبر `overrides` في `pnpm-workspace.yaml`. لا ترفعها
  يدويًا؛ استخدم `expo install --fix`.
- **`apps/api/src/register-paths.ts`** يجب أن يبقى أول استيراد في `main.ts`.
- **`node-linker=hoisted`** في `.npmrc` ضروري لتوافق Metro.
- **لا تبنِ لوحة الإدارة وخادم التطوير يعمل** — `next build` يستبدل `.next` فيسقط
  الخادم بخطأ وحدة مفقودة.
- **أسرار**: لا تضع سرًا في كوميت. حماية الدفع في Secret Scanning ترفضه، لكن
  التدوير بعد التسريب أصعب من تجنّبه.

## الأمان

ثغرة أمنية؟ لا تفتح Issue — راجع [SECURITY.md](SECURITY.md).
