# تصميم الأمان والتقوية

تاريخ المراجعة: 2026-08-08

هذا الملف يصف ضوابط المنصة والبنية. قناة الإبلاغ الخاصة بالثغرات وفترات الاستجابة موجودة في `SECURITY.md` في جذر المستودع.

## حالة التنفيذ

الضوابط الموجودة فعلاً قبل هذه المهمة موثقة في `docs/INITIAL_AUDIT.md`: حماية push للأسرار، وCodeQL، وDependabot، وصور Docker غير root، وفحص Trivy، وSBOM، وتوقيع Cosign، وحماية `main` الأساسية.

لا توجد هوية GitHub OIDC لدى AWS، ولا أدوار نشر AWS، ولا S3 backup bucket، ولا CloudWatch، ولا Secrets Manager، ولا Amazon Inspector integration. لم تُنشئ هذه المهمة أياً منها.

حالة الجهاز المحلي في 2026-08-08 هي: `AWS CLI: INSTALLED`، و`AWS login: WORKING AS ROOT`، و`Agent Toolkit: BLOCKED / NOT CONFIGURED`، و`Catalog verification: NOT RUN`. لا يوجد `AGENTS.md` خاص بالـToolkit في المستودع. تثبيت AWS CLI محلياً لا يفعّل خدمة داخل الحساب، ولا يربط GitHub بـAmazon Q أو Inspector؛ ولا يجوز إكمال Toolkit قبل هوية غير جذرية.

أضاف هذا الفرع ضوابط داخل المستودع: workflow أمان، وبوابة SHA دقيقة قبل النشر إلى GHCR، وworkflow نشر production مغلق افتراضياً، ونسخة DB محلية قبل الهجرة، وفحوص صحة وعودة صور، وتقوية Compose. تبقى فاعليتها التشغيلية رهناً بنجاح GitHub Actions الفعلي وضبط الإعدادات اليدوية وتجربة staging؛ لا يعني وجود الملفات أنها مفعلة في GitHub أو على VPS.

## مبادئ لا تقبل الاستثناء الصامت

- لا access keys دائمة عندما تتوفر هوية مؤقتة.

- لا root في الأتمتة أو العمل اليومي.

- لا سر في Git أو صورة Docker أو log أو artifact.

- لا تنفيذ لشيفرة PR غير موثوقة على خادم الإنتاج، ولا إتاحة أسرار الإنتاج لها.

- لا نشر قبل نجاح بوابات commit نفسه.

- لا تشغيل صورة بوسم متحرك؛ التحقق والتشغيل يكونان بالـdigest نفسه.

- لا مزج لبيانات أو أسرار الإنتاج والتجربة.

- أقل صلاحية ممكنة، وأدوار منفصلة عند اختلاف الغرض.

- كل finding آلي يحتاج تحقق أثر؛ لا يُغلق تنبيه لمجرد أن فحصاً آخر أخضر.

## النتائج حسب الخطورة

الحالة هنا مرتبطة بنقطة الأساس في `docs/INITIAL_AUDIT.md`. لا تُعرض أي قيمة سرية.

### CRITICAL

1. **مفتوح ويتطلب المالك — AWS root بلا MFA.** جلسة التدقيق كانت root وMFA للجذر غير مفعّل. لا تُنفذ أي طفرة AWS قبل تفعيل MFA وإنشاء هوية إدارية غير جذرية.

### HIGH

1. **معالجة في الشيفرة وتحتاج إثباتاً حياً — سلسلة النشر.** كان `publish.yml` يبدأ عند push إلى `main` بالتوازي مع CI وCodeQL. أضاف الفرع `Verify exact-commit gates` الذي ينتظر نجاح CI وCodeQL وSecurity على SHA نفسه قبل البناء. تبنى الصورة كـdigest بلا tag، وتفحص بسياسة لا يتحكم بها checkout، وتوقع، ثم ينشأ وسم SHA guarded؛ لا يوجد `latest` ولا يعيد tag release بناء الصورة. لا تعد الفجوة مغلقة عملياً حتى ينجح تشغيل حقيقي على `main` وتثبت run metadata وdigest والتوقيع مطابقة SHA.

2. **معالجة في الشيفرة وتحتاج إعداداً وتجربة — صحة النشر والعودة.** صار `deploy.sh` يثبت الوسم، ويتحقق من Cosign والـdigests، ويأخذ snapshot واحدة من ملف البيئة، ويثبت أن migration تستهدف DB المحلية المطابقة، وينفذ backup قبل migration والسحب، وينتظر صحة DB وAPI وAdmin، ويثبت source SHA عبر HTTPS، ثم يعيد فقط زوج الصور السابقة الموقعة والمتطابقة عند الفشل. workflow نفسه يرفض completions القديمة، يحتفظ بصف إنتاج، ويشغل النشر البعيد مع PID/status/heartbeat. أُنشئت GitHub Environment محمية ومراجع مطلوب، لكن لا يحمي هذا الإنتاج فعلياً حتى إضافة الأسرار والمتغيرات، وتجربة staging والعودة، ثم تغيير مفتاح الإتاحة من `false` بقرار صريح.

3. **مفتوح — لا توجد نسخة خارج VPS ولا restore drill.** خطة S3 موثقة في `docs/DISASTER_RECOVERY.md` فقط ولم تُنشأ أو تُشغّل.

4. **KNOWN UPSTREAM / UNFIXED — `image-size`.** بقي `pnpm audit` يعرض HIGH للمعرفين `GHSA-w3rx-r6r6-pgpr` و`GHSA-5p2g-fcmc-qvqq` عبر مسار Expo/Metro وقت البناء. تقترح مخرجات `pnpm audit` أن الإصلاح يبدأ من `2.0.3`، لكن GitHub Advisory API لا يحدد أول إصدار مصلح، وأحدث إصدار npm منشور المتحقق منه في 2026-08-08 هو `2.0.2`؛ لا توجد `2.0.3` منشورة. كما أن Metro الحالي ما زال يطلب سلسلة `1.x`، لذلك لا يجوز ادعاء الإصلاح أو فرض override رئيسي غير متوافق. الأثر المثبت هو إمكانية تعليق build/CI عند معالجة أصل خبيث، لا وصول الثغرة إلى runtime النهائي. يبقى التنبيه ظاهراً في baseline غير الحاجز، وتمنع بوابة dependency review إدخال HIGH/CRITICAL جديدة. يعاد التحقق عند نشر upstream fix متوافق، أو يعتمد patch مراجع مع اختبار PoC بدلاً من override أعمى.

[GitHub Advisory: GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)

[GitHub Advisory: GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)

### MEDIUM

1. **مفتوح في إعدادات GitHub — صفر موافقات بشرية.** ruleset يتطلب PR وحل المحادثات لكنه لا يتطلب موافقة. يحتاج تغييراً يدوياً بعد توفر مراجع ثانٍ حتى لا يُقفل المستودع على مالك وحيد.

2. **أُغلق في إعدادات GitHub — حماية العقد.** بعد نجاح `contract` على PR حي أضيف إلى required checks، مع بقاء strict/up-to-date مفعلاً. يؤجل فحصا Security الجديدان إلى ما بعد دمج workflow نفسه كي لا تُقفل PRs الحالية بسياق لا يستطيع `main` إنتاجه.

3. **جزئياً مغلق — حماية بيئة `production`.** أُنشئت Environment وقُيّدت بالفروع المحمية وأضيف المالك مراجعاً مطلوباً، وأُعيد التحقق من عدم وجود أسرار أو deployments ومن بقاء `PRODUCTION_DEPLOY_ENABLED=false`. لأن المالك هو المتعاون الوحيد بقي `Prevent self-review` معطلاً، وما زال bypass الإداري متاحاً. أضف مراجعاً موثوقاً ثانياً ثم فعّل منع المراجعة الذاتية قبل تفعيل الإنتاج.

4. **أُصلحت في lockfile وتحتاج إثبات CI — `uuid` و`esbuild`.** كانت تنبيهات الاعتماديات المتوسطة مفتوحة عند التدقيق، وأصلحها تحديث الاعتماديات في هذا الفرع. لا تُعد مغلقة خارج الفرع حتى يمر `pnpm install --frozen-lockfile` والفحوص على GitHub وتظهر التنبيهات الحية مغلقة.

5. **مفتوح — لا توجد مراقبة مستقلة أو تنبيهات.** تصميم SSM hybrid وCloudWatch لا يعني تثبيتهما.

### LOW

1. **أُغلق في إعدادات GitHub — linear history.** أضيفت القاعدة إلى ruleset، وعُطلت merge commits، وبقي Squash وRebase فقط، مع تفعيل Update Branch والحذف الآلي للفرع بعد الدمج.

2. **ضجيج تشغيلي.** check suites قديمة وفارغة من تكاملات غير مطلوبة تجعل قراءة الحالة أصعب؛ تُراجع التطبيقات المثبتة قبل حذف أي تكامل.

3. **دين formatting سابق.** فحص Prettier الشامل يفشل على ملفات كثيرة سابقة، لذلك يجب أن تكون البوابة على الملفات المتغيرة إلى أن يُعالج الدين في PR منفصل.

## هوية AWS

### الإجراء الإلزامي للجذر

1. سجل الدخول إلى AWS Console كـroot لهذه الخطوة فقط.

2. فعّل جهاز MFA مقاوم للتصيد، ويفضل passkey أو FIDO security key، ثم أضف جهازاً احتياطياً محفوظاً في مكان منفصل.

3. تحقق من عدم وجود root access keys، ولا تنشئ واحداً.

4. فعّل IAM Identity Center وأنشئ هوية إدارية يومية مع MFA وبيانات مؤقتة.

5. اخرج من جلسة root، وسجل CLI بالهوية الجديدة، ثم تحقق أن ARN الناتج لا يحتوي `root` من دون نسخ Account ID إلى تقرير أو log عام.

```bash
aws login --region eu-north-1
```

```bash
aws sts get-caller-identity
```

6. احتفظ ببيانات استعادة root خارج AWS نفسه، وراقب أي استعمال لاحق للجذر.

[AWS: root user best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html)

[AWS: phishing-resistant MFA and temporary credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

## تصميم GitHub OIDC إلى AWS

لا ينشأ provider أو role ما لم يضف workflow مورداً AWS يحتاجه. خط النشر الحالي إلى GHCR وVPS لا يحتاج AWS credentials.

عند الحاجة المستقبلية، تكون الثقة مقيدة بـaudience وsubject معاً. مثال دور لjob يستخدم GitHub Environment باسم `production`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:m7hm4d/superapp:environment:production"
        }
      }
    }
  ]
}
```

لا تستعمل:

```text
repo:m7hm4d/superapp:*
```

لدور كتابة، ولا تمنح `pull_request` أو forks قدرة AWS. إذا احتاج PR فحصاً سحابياً، يستخدم بيانات عامة أو دور قراءة محدود عبر workflow موثوق لا ينفذ شيفرة PR.

[AWS: configure a GitHub OIDC identity provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html#idp_oidc_Create_GitHub)

[GitHub: OIDC concepts](https://docs.github.com/en/actions/concepts/security/openid-connect)

### فصل الأدوار المستقبلي

- `SuperappVpsManagedNodeRole`: تثق به خدمة SSM فقط. يسمح بقنوات SSM وCloudWatch المحددة وكتابة prefix النسخ المحدد. لا يسمح بحذف S3 أو قراءة نسخ الإنتاج.

- `SuperappBackupRestoreRole`: لهوية بشرية عبر Identity Center؛ يقرأ نسخ S3 للاستعادة ولا يكتب التطبيق.

- `SuperappEcrPublisherRole`: لا ينشأ إلا عند اعتماد ECR؛ يثق بـ`main` ويكتب إلى repository ARNs المحددة فقط.

- `SuperappProductionAwsRole`: لا ينشأ إلا إذا صار للنشر إجراء AWS؛ يثق ببيئة `production` ولا يشارك صلاحيات backup أو security administration.

- إدارة Inspector وGitHub App تبقى صلاحية إدارية بشرية، لا role دائم داخل workflow.

## الأسرار

### ما يعمل اليوم

- `.gitignore` يحجب ملفات `.env*` الحقيقية ويستثني ملفات المثال فقط.

- أمثلة البيئة تحمل placeholders ولا يجب ملؤها داخل Git.

- GitHub Secret Scanning وpush protection مفعّلان حسب التدقيق الحي.

- صور GHCR تستخدم `GITHUB_TOKEN` قصير العمر، وتوقيع Cosign يستخدم GitHub OIDC بلا private signing key.

- إنتاج VPS يقرأ ملف البيئة المحلي خارج Git. يرفض workflow وسكربتات النشر الملف إذا كان symlink أو لم يملكه مستخدم النشر أو كانت للمجموعة/الآخرين أي صلاحية؛ استعمل `chmod 600` أو `400`.

### قواعد GitHub Environments

توضع أسرار النشر في Environment باسم `production`، لا repository secrets العامة، لأن environment secrets لا تصبح متاحة قبل اجتياز حماية البيئة.

لا يُحفظ server password. يستخدم SSH private key مقيداً بمستخدم نشر غير root، مع host key مثبت في `known_hosts` وليس `StrictHostKeyChecking=no`.

الأسماء الدقيقة التي يستهلكها workflow موثقة في `docs/DEPLOYMENT.md`. لا تضع محتوى أي سر في وصف PR أو Actions summary.

[GitHub: environment secrets and protection rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

### إذا ظهر سر في التاريخ

غطى فحص Gitleaks كامل تاريخ الفرع الأساسي، وعدده 71 commit وقت التدقيق. ظهرت ثلاث مطابقات فقط في ملفات أمثلة environment وبيانات TOTP ثابتة خاصة باختبارات CI؛ تحقق أنها false positives ولم يظهر credential فعلي. لا تسجل الوثيقة القيم نفسها، ويجب إعادة فحص التاريخ في CI عند تغيره.

1. لا تطبعه ولا تنسخه إلى Issue أو PR.

2. سجل نوع السر والمسار والـcommit فقط في قناة خاصة.

3. دوّر السر لدى المزوّد أولاً؛ حذف النص من Git لا يبطل credential.

4. حدّث المستهلكين، وألغ القديم، ثم تحقق من logs بلا إظهار القيمة.

5. نظف التاريخ فقط بخطة منسقة لأن force push يغير SHAs ويفسد الفروع المفتوحة.

## أمان Docker وVPS

الضوابط المثبتة في المستودع:

- multi-stage Dockerfiles وbase images مثبتة على digests.

- تشغيل التطبيق كمستخدم غير root، مع فحص CI للـUID وعدم قابلية كتابة الشيفرة.

- لا ports عامة لقاعدة البيانات أو API أو لوحة الإدارة.

- healthchecks وrestart policies وحاجز هجرة قبل API.

- شبكات production وstaging منفصلة، وCaddy هو نقطة العبور الوحيدة.

- Trivy يمنع HIGH/CRITICAL القابلة للإصلاح في الصور المبنية في CI وفي digest المنشورة قبل توقيعها. تمرر workflows config وignore YAML فارغين من `RUNNER_TEMP` صراحة، فلا تستطيع سياسة تجاهل داخل checkout إسكات الفحص.

- يضيف Compose `init` و`no-new-privileges` وlog rotation. حاويتا API وAdmin تسقطان capabilities، وتستخدمان root filesystem للقراءة فقط و`tmpfs` للمسارات المؤقتة.

- لا يفرض الفرع `read_only` أو إسقاط كل capabilities على PostgreSQL بلا اختبار؛ قاعدة البيانات تحتاج كتابة volume وسلوكاً أكثر تحفظاً.

- يشغل CI `ShellCheck` و`deploy/test-deployment-safety.sh` لإثبات رفض الوسوم المتحركة، وترتيب backup قبل migration، ووجود مسار العودة، وتقوية Compose.

- النسخة المحلية قبل النشر custom-format ومفهرسة وذات SHA-256 وصلاحيات مقيدة، لكنها ليست مشفرة خارجياً ولا تغادر VPS.

القيود المتبقية:

- فحص صورة CI لا يكفي إلا إذا كانت الصورة المنشورة من source SHA نفسه واجتازت البوابات نفسها.

- Docker socket ومنح sudo على VPS يعادلان تقريباً root؛ مستخدم النشر يجب ألا يستقبل أوامر حرة من PR.

- SSH ليس بديلاً عن patch management أو مراقبة القرص والنسخ.

- لا تفرض ملفات Compose حدود CPU أو RAM حالياً. يؤجل ذلك حتى قياس سعة VPS واستهلاك PostgreSQL والـAPI والـAdmin تحت حمل واقعي؛ إضافة حدود عشوائية قد تسبب OOM أو outage. يجب تسجيل القياسات ثم اعتماد limits وreservations وتجربة الفشل في staging.

- workflow الإنتاج يبني bundle محدودة ومفهرسة من source SHA نفسه، ويرفض paths الزائدة، ويثبتها تحت `.releases/<sha>`. يبقى ضبط Environment وSSH ومساحة release/state ونجاح تجربة staging مسؤولية تشغيلية يدوية.

## سياسة findings

- `CRITICAL`: يوقف الدمج والنشر، ويحتاج triage فورياً وإصلاحاً أو استثناءً موثقاً محدود المدة من مالك أمني.

- `HIGH`: يوقف الدمج إذا كان قابلاً للوصول أو له إصلاح متاح. finding بلا fix لا يُخفى؛ يوثق التعويض والموعد.

- `MEDIUM`: يصلح في دورة قريبة، ويُرفع إذا كان على auth أو tenant boundary أو deployment path.

- `LOW`: يدخل backlog مع سبب واضح، ولا يستخدم لتغطية ضجيج scanner.

استثناء scanner يجب أن يحدد finding identifier والمسار والسبب والمالك وتاريخ الانتهاء واختباراً يثبت عدم الوصول. لا توجد allowlist دائمة بلا انتهاء.

## تحقق دوري

شهرياً أو بعد تغيير كبير:

```bash
git ls-files | rg '(^|/)\.env($|\.)|\.(pem|key|p12)$'
```

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
```

```bash
python3 scripts/check-workflow-injection.py
python3 scripts/check-module-boundaries.py
```

تراجع كذلك تنبيهات Dependabot وCodeQL وSecret Scanning الحية، وruleset، وGitHub Apps المثبتة، وAWS IAM credential report. نتيجة قديمة لا تثبت الحالة الحالية.
