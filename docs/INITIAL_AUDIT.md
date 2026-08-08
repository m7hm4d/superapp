# التدقيق الأولي للبنية والأمان وCI/CD

تاريخ التدقيق: 2026-08-08

نقطة الأساس: `main` عند `6b927093f893f6207d5f03df651692c8f6350c5d`

هذا التقرير يسبق أي تغيير تنفيذي في المستودع. جُمعت نتائجه بقراءة المستودع كاملًا، وتشغيل فحوص محلية آمنة، وقراءة إعدادات GitHub وAWS الحالية. لم يُعدَّل خادم الإنتاج، ولم تُنشأ موارد AWS، ولم تُغيَّر إعدادات GitHub أثناء هذا التدقيق.

## الخلاصة التنفيذية

المستودع ليس نقطة بداية فارغة؛ لديه خط CI واسع، وفحص CodeQL، وتحديثات Dependabot، وبناء صور Docker مكررة وموقعة بلا مفاتيح، وتحقق من التوقيع قبل التشغيل على VPS.

أكبر فجوة في سلسلة الإمداد هي أن `publish.yml` يبدأ فور الدفع إلى `main` بالتوازي مع CI، لذلك يستطيع نشر صورة وتوقيعها قبل أن تنتهي اختبارات commit نفسها. لا يحدث نشر آلي إلى الإنتاج اليوم، لكن `deploy.sh` يختار `latest` افتراضيًا، ولا يجري فحص صحة بعد الإقلاع ولا عودة آلية عند الفشل.

حماية `main` تمنع الحذف وforce push وتفرض PR وفحوصًا صارمة، لكنها تسمح بالدمج بلا أي موافقة بشرية، ولا تفرض `contract`، ولا تفرض linear history. لا توجد GitHub Environments أو أسرار نشر أو سجل deployments.

حساب AWS خالٍ تقريبًا من الموارد في `eu-north-1`. لا يوجد ECR أو Inspector أو CodeConnections أو CloudWatch أو Backup أو S3 أو Secrets Manager أو SSM أو موارد حوسبة. جلسة التدقيق الحالية للجذر، وMFA للجذر غير مفعّل؛ لذلك تُحظر كل تغييرات AWS حتى إنشاء هوية بشرية غير جذرية وتأمين الجذر.

## البنية المكتشفة

- مونوريبو TypeScript يدار بواسطة `pnpm 11.9.0` وTurbo، مع Node.js 22 في CI والصور.
- `apps/api`: NestJS 11 وDrizzle وPostgreSQL 17/PostGIS وSocket.io.
- `apps/admin`: Next.js 15 وReact 19.
- `apps/customer` و`apps/vendor` و`apps/driver`: Expo SDK 54 وReact Native.
- `apps/driver_flutter`: تطبيق Flutter إضافي بعقد مولّد من مخططات Zod.
- `packages/shared`: مخططات Zod وآلات الحالة ومصدر عقد API.
- `packages/api-client` و`packages/ui` و`packages/map` و`packages/i18n` و`packages/config`: حزم مشتركة.
- الإنتاج الحالي: VPS Ubuntu خارجي، وDocker Compose، وPostGIS، وCaddy على المنفذين 80 و443.
- الصور الحالية: `ghcr.io/m7hm4d/superapp-api` و`ghcr.io/m7hm4d/superapp-admin`.

## ما كان موجودًا قبل المهمة

### جودة واختبارات

- تثبيت اعتماديات بقفل مجمّد.
- typecheck لكل workspaces.
- ESLint مع قواعد وعود تعتمد على الأنواع.
- اختبارات API e2e ضد PostgreSQL حقيقي مع عتبات coverage.
- اختبارات الحزم المشتركة وتطبيقات Expo وFlutter.
- بناء لوحة الإدارة وتصدير حزم Expo.
- تحقق من تطابق OpenAPI ونماذج Dart المولدة.
- تحقق خاص من حدود ملكية الوحدات ومن حقن تعبيرات GitHub Actions.

### أمان GitHub وسلسلة الإمداد

- CodeQL على PR و`main` وأسبوعيًا.
- Dependabot لـnpm وDocker وCompose وGitHub Actions.
- Secret scanning وpush protection مفعّلان.
- Private vulnerability reporting مفعّل.
- Actions مثبتة على commit SHA.
- Docker base images مثبتة على digest.
- Trivy يفحص صورتي API وAdmin ويمنع HIGH/CRITICAL القابلة للإصلاح.
- SBOM بصيغة SPDX لكل صورة.
- صور GHCR تبنى بـBuildKit provenance وSBOM وتوقّع عبر GitHub OIDC وCosign بلا مفتاح دائم.
- `deploy.sh` يتحقق من هوية توقيع workflow ثم يشغّل الصورة بالـdigest لا بالوسم.

### أمان Docker والإنتاج

- صور متعددة المراحل وعمليات تشغيل غير root.
- شيفرة التطبيق غير قابلة للكتابة من مستخدم التشغيل.
- healthchecks للخدمات.
- قاعدة البيانات وAPI ولوحة الإدارة غير مكشوفة مباشرة للإنترنت.
- فصل شبكات الإنتاج وstaging مع Caddy وحيد بينهما.
- هجرة قاعدة البيانات شرط قبل إقلاع API.
- restart policies للخدمات الدائمة.
- أمثلة البيئة بلا أسرار فعلية، وملفات `.env*` الحقيقية متجاهلة.

## حالة GitHub الحية

- المستودع عام وشخصي، و`main` هو الفرع الافتراضي.
- ruleset باسم `protect-main` يمنع الحذف وnon-fast-forward، ويتطلب PR وحل محادثات المراجعة، ويفرض تحديث الفرع.
- الفحوص المطلوبة: `test` و`lint` و`analyze` و`deploy` وثلاث مصفوفات `expo`.
- فحص `contract` موجود وينجح، لكنه ليس required check.
- عدد الموافقات المطلوبة صفر؛ آخر PR مدمج لم يحصل على مراجعة.
- مراجعة CODEOWNERS وتعطيل الموافقات القديمة وموافقة شخص غير آخر دافع غير مفعّلة.
- merge commit وsquash وrebase كلها مسموحة، ولا توجد قاعدة linear history.
- لا توجد GitHub Environments أو repository Actions secrets أو deployment records.
- صلاحية `GITHUB_TOKEN` الافتراضية قراءة، وActions لا تستطيع اعتماد PR؛ وهذا جيد.
- Actions مسموحة بلا allowlist.
- آخر تشغيلات CI وCodeQL وPublish على نقطة الأساس ناجحة.
- يوجد تنبيهان Dependabot متوسطان مفتوحان في `pnpm-lock.yaml`: `uuid` و`esbuild`.
- لا توجد تنبيهات CodeQL أو secret-scanning مفتوحة وقت التدقيق.
- لا يوجد دليل متحقق على تثبيت Amazon Q Developer أو Amazon Inspector.

## حالة AWS الحية

المنطقة المستهدفة: `eu-north-1`.

- هوية الجلسة الحالية هي AWS root؛ لن تستخدم لأي تغيير أو أتمتة.
- MFA للجذر غير مفعّل.
- لا توجد access keys للجذر، وهذا جيد.
- لا يوجد IAM users أو OIDC providers؛ الموجود فقط دوران service-linked للدعم وTrusted Advisor.
- لا توجد مستودعات ECR؛ إعداد registry هو basic scanning الافتراضي.
- Amazon Inspector غير مشترك به.
- GuardDuty وSecurity Hub غير مشترك بهما.
- لا توجد GitHub CodeConnections.
- لا توجد CloudWatch alarms أو log groups أو SNS topics.
- لا توجد S3 buckets أو AWS Backup plans/vaults.
- لا توجد Secrets Manager secrets أو SSM parameters.
- لا توجد EC2 instances أو EBS volumes أو RDS databases في المنطقة.
- لا توجد AWS Budgets ظاهرة، وCost Explorer غير مفعّل بعد، لذلك لا توجد Cost Anomaly monitors قابلة للقراءة.

## نتائج الخطورة

### CRITICAL

1. حساب AWS root بلا MFA. يجب تفعيل MFA مقاوم للتصيد إن أمكن، وعدم استعمال root بعد إجراءات bootstrap الضرورية.

### HIGH

1. `publish.yml` لا ينتظر نجاح CI وCodeQL للـcommit نفسه على `main`؛ قد ينشر ويوقّع artifact غير مجتاز للاختبارات.
2. النشر الحالي بلا post-deployment health gate أو عودة آلية؛ `docker compose up -d` الناجح لا يثبت صحة التطبيق.
3. لا توجد نسخة احتياطية آلية أو نسخة خارج الخادم أو اختبار restore موثق، مع أن PostgreSQL وملفات الإعداد على VPS هي نقطة الاستعادة الوحيدة.

### MEDIUM

1. الدمج إلى `main` ممكن بلا موافقة بشرية، و`contract` ليس required check.
2. لا توجد GitHub production environment أو required reviewer أو deployment policy.
3. تنبيها Dependabot متوسطان مفتوحان لـ`uuid` و`esbuild`.
4. لا توجد مراقبة أو تنبيهات مستقلة لصحة API والحاويات والقرص والنسخ والنشر.
5. `deploy.sh` يختار `latest` افتراضيًا بدل أن يطلب وسم commit غير قابل للالتباس.

### LOW

1. يسمح المستودع بثلاث طرق دمج ولا يفرض linear history رغم أن التوثيق يطلب squash.
2. توجد check suites فارغة معلقة من Vercel وRender وCursor وClaude؛ ليست مطلوبة لكنها تخلق ضجيجًا.
3. يوجد تشغيلان قديمان لـCI بحالة queued بلا jobs.
4. فحص Prettier للمستودع كاملًا يفشل مسبقًا على 340 ملفًا؛ لا يجوز إضافة بوابة عامة قبل تسوية الدين أو قصرها على الملفات المتغيرة.

## قرارات التنفيذ الأولية

1. الحفاظ على VPS وDocker Compose وعدم ترحيل runtime إلى AWS.
2. الحفاظ على GHCR بدل إضافة ECR الآن؛ GHCR الحالي يوفّر صورًا موقعة وimmutable digests بلا تكلفة AWS أو ازدواج مسجل.
3. ربط النشر بنجاح workflow النشر الذي ينتظر بدوره CI/CodeQL، واستعمال وسم `sha-*` لا `latest`.
4. إضافة GitHub production environment في workflow، مع تعطيل النشر افتراضيًا حتى يهيئ المالك البيئة والأسرار والحماية.
5. إضافة فحص صحة بعد النشر واستعادة صور الإصدار السابق تلقائيًا عند فشل الصحة، مع توثيق حد الهجرات غير القابلة للعكس.
6. إضافة فحوص dependency وsecret وfilesystem/IaC دون تكرار CodeQL أو image scans الموجودة.
7. إضافة تحقق formatting للملفات المتغيرة فقط كي لا يحوّل الدين السابق إلى فشل شامل غير متعلق بالـPR.
8. تصميم IAM OIDC وmonitoring وbackup كملفات وسياسات قابلة للمراجعة، لكن عدم إنشائها ما دامت الجلسة root أو قبل قرار التكلفة.

## حدود التدقيق

- لم يُقرأ خادم الإنتاج ولم يُعدّل؛ لا توجد بيانات SSH أو موافقة تشغيلية آمنة له في GitHub.
- تعذّر إثبات Amazon Q/Inspector من GitHub App installations بواسطة توكن المستخدم الحالي؛ يلزم تحقق يدوي أو تثبيت مصرح به ثم PR تجريبي.
- تعذّر تقييم تكلفة AWS تاريخيًا لأن Cost Explorer غير مفعّل والحساب لا يحوي موارد فعلية.
- فحص Docker المحلي غير ممكن على هذا الـMac لعدم وجود Docker؛ سيعتمد التحقق النهائي على CI الموجود أو runner يدعم Docker.
