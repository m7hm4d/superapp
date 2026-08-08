# CI/CD ومراجعة الشيفرة

تاريخ المراجعة: 2026-08-08

## الهدف

المسار المقبول هو فرع ميزة ثم Pull Request ثم بوابات جودة وأمان ومراجعة، وبعد الدمج بناء artifact واحد غير قابل للالتباس، ثم موافقة production، ثم نشر وفحص صحة وعودة عند الفشل.

لا يُسمح لـworkflow يعمل على `pull_request` بالوصول إلى VPS أو أسرار production أو دور AWS ذي كتابة.

## ما كان موجوداً عند نقطة الأساس

### `ci.yml`

- `test`: تثبيت بقفل مجمد، وtypecheck لكل workspaces، وهجرات وseed، واختبارات API e2e مع coverage، واختبارات الحزم، وبناء لوحة الإدارة.

- `lint`: فحص تعبيرات workflows وحدود ملكية الوحدات وESLint.

- `contract`: إعادة توليد OpenAPI وDart ومقارنتهما، ثم Flutter analyze وtests.

- `deploy`: تحقق Caddy وCompose، وبناء الصور، وإثبات non-root وعدم قابلية كتابة الشيفرة، وsmoke test كامل، وفحص عزل البيئتين، وTrivy، وSBOM.

- `expo`: مصفوفة تطبيقات العميل والبائع والسائق، وتشغل tests وAndroid export وتتحقق أن bundle حقيقي.

### `codeql.yml`

يفحص JavaScript/TypeScript عند PR وعند push إلى `main` وأسبوعياً. الصلاحيات محددة إلى قراءة المحتوى وكتابة security events.

### `publish.yml`

كان يبني صورتي API وAdmin ويدفعهما إلى GHCR مع provenance وSBOM، ويوقع digest عبر Cosign keyless، ويتحقق من التوقيع. الخلل أن trigger القديم كان push مباشراً إلى `main` بالتوازي مع CI.

### ضوابط أخرى

- Dependabot يغطي GitHub Actions وDocker وCompose وnpm.

- Actions وbase images مثبتة على commit SHA أو digest.

- Secret Scanning وpush protection وprivate vulnerability reporting مفعّلة.

- ruleset يحمي `main` من الحذف وforce push ويفرض PR وتحديث الفرع وحل المحادثات، لكنه كان يسمح بصفر approvals ولا يفرض `contract` أو linear history.

## ما أضافه هذا الفرع

هذه ضوابط موجودة في ملفات المستودع، وليست دليلاً على أن GitHub نفذها أو جعلها required checks. الإغلاق يحتاج تشغيلات ناجحة وإعدادات يدوية.

### `CI`

تبقى أسماء jobs السبعة كما هي:

```text
test
lint
contract
deploy
expo (customer)
expo (vendor)
expo (driver)
```

صلاحية workflow العليا هي `contents: read`. أضيفت إلى `lint` خطوة `Prettier (changed files only)` على PR وعلى push إلى `main`. تحسب المدى الكامل المناسب للحدث، وتحافظ على أسماء الملفات NUL-delimited ثم تمررها كـargv array؛ لا يتحول اسم ملف إلى shell syntax.

أضيفت داخل `deploy` قبل بناء Docker خطوتان:

```text
ShellCheck deployment scripts
Deployment safety regression tests
```

تشغل الثانية `bash deploy/test-deployment-safety.sh` للتحقق من الوسوم الثابتة، ورفض parser injection، ووقوع backup قبل migration، ووجود rollback hooks، وتقوية Compose.

### `Security`

يعمل workflow عند PR إلى `main`، وpush إلى `main`، وأسبوعياً يوم السبت عند `03:30 UTC`، ويدوياً. صلاحية workflow العليا `contents: read`، وتنقسم مسؤولياته إلى:

- `Repository vulnerabilities and IaC`: يشغل Trivy filesystem على lockfiles وIaC/configuration، ويوقف فقط HIGH/CRITICAL القابلة للإصلاح. يعمل على PR وpush، وصلاحيته `contents: read` فقط.

- `New dependency vulnerabilities`: يعمل على PR فقط ويستخدم Dependency Review لمنع اعتماديات HIGH/CRITICAL التي أدخلها diff. لا يفشل بسبب كل دين تاريخي، وصلاحيته `contents: read` فقط.

- `Repository security baseline`: لا يعمل على PR. يعمل على push إلى `main` والجدول والتشغيل اليدوي، ويرفع SARIF غير حاجز للدرجات MEDIUM/HIGH/CRITICAL. هذا job وحده يملك `security-events: write` إضافة إلى `contents: read`.

يبقى GitHub Secret Scanning مع push protection مرجع الأسرار، وCodeQL مرجع SAST، وTrivy داخل `deploy` مرجع الصور المبنية. workflow الجديد لا يكرر صلاحية `security-events: write` داخل PR.

كل استدعاء Trivy يمرر صراحة config وignore YAML فارغين ينشئهما job داخل `RUNNER_TEMP` لا داخل checkout. لذلك لا تستطيع `.trivyignore` أو `trivy.yaml` يضيفهما PR إسكات finding في فحص المستودع أو الصورة المنشورة. يفحص `scripts/check-trivy-workflow-policy.py` وجود هذا الحد في workflows نفسها؛ وتبقى مراجعة تغييرات workflows البشرية مطلوبة لأن سكربتاً داخل الفرع لا يحمي نفسه من مالك يوافق على حذفه.

تنبيها `image-size` العاليان المعروفان بلا إصدار upstream مصلح منشور يبقيان ظاهرين في baseline غير الحاجز، ولا يعني ذلك تجاهلهما. التفاصيل في `docs/SECURITY.md`. Dependency Review يمنع إدخال HIGH/CRITICAL جديدة.

### `Publish`

أضيف job باسم:

```text
Verify exact-commit gates
```

يقرأ GitHub Actions بصلاحيتي `actions: read` و`contents: read` وينتظر تشغيلات push إلى `main` للـSHA نفسه. يطلب صراحة jobs CI السبعة، وCodeQL `analyze`، وSecurity `Repository vulnerabilities and IaC`، ويتطلب نجاح workflows الثلاثة. لا يستطيع وسم `v*` أو `workflow_dispatch` تجاوز الإثبات؛ إذا لم يوجد تشغيل push ناجح للـSHA نفسه فلا ينشر.

بعد نجاح البوابة فقط يبني job كل صورة كـdigest بلا tag، ويدفع provenance وSBOM، ويفحص digest المنشورة، ويطابق OCI revision، ثم يوقعها. بعد ذلك ينشئ وسم `sha-<40-hex>` مرة واحدة. لا ينشر `latest`. إذا أعيد تشغيل workflow وكان وسم SHA موجوداً، يعاد استعماله فقط بعد إثبات revision وتوقيع main نفسه، ولا يعاد البناء أو تحريك الوسم. صلاحيات job البناء هي `contents: read` و`packages: write` و`id-token: write` فقط، ولا تصل صلاحيات الكتابة هذه إلى job البوابة.

إنشاء Git tag لا يشغل `Publish`. إنشاء GitHub Release لـ`vX.Y.Z` تشغيل يدوي موثوق من workflow الحالي على `main`؛ يتحقق من وجود tag ومن أن commit الخاص به ancestor لـ`main` ومن بوابات SHA نفسه، ثم يثبت digest وOCI revision وتوقيع `main` لصورتَي `sha-<40-hex>`. يعيد التحقق من Git tag البعيد مباشرة قبل إنشاء Release، ولا ينشئ أي SemVer alias في GHCR:

```bash
gh workflow run publish.yml --ref main -f release_tag=v1.2.3
```

### `Deploy Production`

يبدأ workflow الجديد عبر `workflow_run` فقط بعد اكتمال `Publish` ناجح مصدره push إلى `main`. اسم job هو:

```text
Deploy immutable image to production
```

يطلب Environment باسم `production`، ولا يعمل إلا إذا كانت repository variable `PRODUCTION_DEPLOY_ENABLED` تساوي `true` تماماً. يستعمل `concurrency.queue: max` كي لا يلغي completion متأخر run أحدث ينتظر الإنتاج، ثم يرفض source SHA لم يعد رأس `main` قبل بناء الحزمة ومرة ثانية قرب launcher كي لا يعيد اكتمال workflow متأخر الإنتاج إلى commit أقدم. يستخدم وسم `sha-<40-hex>`، ويثبت SSH host key، ثم يبني من checkout ذلك الـSHA bundle checksummed محدودة المسارات. ينقلها إلى VPS، ويثبتها في `.releases/<sha>`، ويشغلها مع `.env.prod` و`.deploy` الثابتين و`--expected-stack prod` وعناوين HTTPS الخارجية. العملية البعيدة durable عبر status/PID/heartbeat ومراقبة liveness، فلا يقطع سقوط اتصال SSH مسار rollback داخل VPS. لا تنفذ PRات هذا المسار ولا تستلم أسرار الإنتاج.

[GitHub: concurrency queue and `queue: max`](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

الأسرار والمتغيرات الدقيقة وإعداد VPS وحدود العودة موثقة في `docs/DEPLOYMENT.md`.

## بوابة Pull Request

كل PR يجب أن يثبت، بقدر ما يمس المستودع:

1. lockfile صالح عبر `pnpm install --frozen-lockfile`.

2. formatting للملفات المتغيرة فقط إلى أن ينظف الدين السابق في PR مستقل.

3. ESLint وTypeScript typecheck.

4. اختبارات API والحزم وتطبيقات الهاتف.

5. العقد المولد وFlutter analyze/tests.

6. بناء Admin وتصدير Expo.

7. صحة Docker وCompose وCaddy والهجرة وhealthchecks وعزل البيئات.

8. فحص الاعتماديات والأسرار وfilesystem/IaC والشيفرة والصور، مع منع HIGH/CRITICAL الجديدة أو القابلة للإصلاح.

9. إنشاء SBOM مع retention واضح، من دون أسرار.

لا تُنشأ fake tests لتجاوز بوابة. إذا فشل فحص موجود قبل الفرع، يثبت ذلك بتشغيل baseline نفسه أو رابط تشغيل سابق، ولا يعطل الفحص أو يخفض شدته داخل إصلاح غير متعلق.

## فصل الفحوص

- CodeQL مسؤول عن SAST العميق للـTypeScript.

- dependency review أو audit مسؤول عن CVEs التي يدخلها diff.

- secret scanner يفحص الشيفرة والتاريخ المتاح؛ GitHub push protection يبقى خط الدفاع قبل الوصول.

- Trivy filesystem يغطي misconfiguration وIaC والملفات، وTrivy image يغطي ما دخل الصورة فعلاً. كل فحص يستعمل config وignore policy موثوقتين خارج checkout كي لا يسكت PR نفسه النتائج. baseline SARIF غير الحاجز يحفظ التنبيهات المتوسطة والعالية غير القابلة للإصلاح مرئية بدلاً من إخفائها.

- Inspector، إن فُعّل، يضيف عرض AWS موحداً وSAST/SCA/IaC، لكنه لا يبرر حذف CodeQL أو فحص الصورة المنشورة.

الهدف هو تداخل دفاعي له قيمة، لا تشغيل أدوات متطابقة بأسماء مختلفة. أي فحص جديد يمر أسبوعاً في وضع report-only إذا كان ضجيجه غير معروف، ثم يُشدّد HIGH/CRITICAL بعد triage.

## بوابة النشر

الخاصية الأمنية الأساسية هي مطابقة SHA:

```text
tested SHA = security-scanned SHA = built SHA = signed digest source SHA = deployed SHA
```

لا يكفي أن يكون آخر تشغيل CI أخضر إذا كان لصورة أو commit مختلف. job `Verify exact-commit gates` يتحقق من تشغيلات push إلى `main` للـSHA نفسه في CI وCodeQL وSecurity قبل البناء. كذلك لا يجوز استخدام نجاح workflow من fork أو ref آخر كإذن نشر.

صور الإنتاج تبنى من push إلى `main` كـdigests بلا tags. بعد فحص digest المنشورة ومطابقة `org.opencontainers.image.revision` وتوقيعها، ينشئ workflow وسم `sha-<40-hex>` guarded مرة واحدة؛ إعادة التشغيل تعيد استعمال الموجود بعد التحقق ولا تحركه، ولا يوجد `latest`. VPS يشغّل digest الناتجة بعد التحقق من هوية `publish.yml@refs/heads/main` و`--certificate-github-workflow-sha`، ثم يثبت SHA نفسها من API وAdmin عبر المسار الخارجي. Git tag نفسه لا يشغّل Actions؛ التشغيل اليدوي من `main` ينشئ GitHub Release حتمياً يسجل الـdigestين ولا يضيف أي وسم GHCR جديد، بينما `deploy.sh` يرفض كل شيء عدا SHA الكامل.

التفاصيل التشغيلية والأسرار في `docs/DEPLOYMENT.md`.

## إعدادات GitHub اليدوية

لا يستطيع commit وحده فرض هذه الإعدادات. يجب تنفيذها في GitHub ثم إعادة قراءتها عبر API أو الواجهة.

### Ruleset لـ`main`

المسار:

```text
Settings -> Rules -> Rulesets -> protect-main
```

احتفظ بالضوابط الموجودة وأضف:

- Require a pull request before merging.

- Required approvals: `1` بعد توفر مراجع ثانٍ. تفعيلها فوراً مع مالك وحيد قد يمنع كل دمج، لأن صاحب PR لا يعتمد نفسه.

- Dismiss stale pull request approvals when new commits are pushed.

- Require approval of the most recent reviewable push من شخص غير آخر دافع، عند توفر أكثر من مساهم.

- Require review from Code Owners عند توفر مراجع ثانٍ؛ ملف `.github/CODEOWNERS` موجود لكن لا يفرض نفسه.

- Require conversation resolution.

- Require branches to be up to date.

- Block force pushes and deletion.

- Require linear history، ثم اترك Squash merge كأسلوب الفريق المفضل.

- لا تسمح bypass إلا لحساب break-glass مراقب، وإن أمكن اجعل القاعدة مطبقة على administrators.

أضف required checks بعد أن تعمل مرة على PR ويظهر اسمها النهائي، لا بكتابة اسم متوقع. الحد الأدنى:

```text
test
lint
contract
deploy
expo (customer)
expo (vendor)
expo (driver)
analyze
Repository vulnerabilities and IaC
New dependency vulnerabilities
```

لا تضف `Repository security baseline` إلى required checks للـPR لأنه لا يعمل على PR. أضف الاسمين الأمنيين السابقين فقط بعد أول تشغيل ناجح وظهور الأسماء النهائية. لا تستعمل check name متكرراً بين workflows؛ GitHub يحذر من أن الأسماء غير الفريدة تجعل required status غامضاً.

[GitHub: protected branches and required checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

### Ruleset لوسوم الإصدار

أنشئ ruleset يستهدف Git tags بالنمط `v*`، وفعّل منع update وdelete وforce-push. لا تسمح bypass إلا لحساب break-glass مراقب. يعتمد إنشاء GitHub Release على أن tag لا يتحرك بعد تحقق workflow؛ لا توجد GHCR SemVer aliases يمكن تصحيحها أو تحريكها لاحقاً.

### Environment للإنتاج

المسار:

```text
Settings -> Environments -> New environment -> production
```

اضبط:

- Required reviewers: مراجع واحد على الأقل عند توفر مراجع ثانٍ.

- Prevent self-review.

- Deployment branches and tags: Selected branches and tags، ثم `main` فقط، أو release tags محددة إذا كان workflow يستخدمها فعلاً.

- منع administrator bypass إن كانت الخطة تسمح.

- ضع أسرار SSH في environment لا repository-level.

GitHub لا يسلّم environment secrets إلى job قبل الموافقة. لكنها تظل أسراراً على runner، لذلك لا تطبع env ولا تشغل مدخل PR داخل job الإنتاج.

أسماء أسرار Environment الدقيقة:

```text
PRODUCTION_SSH_PRIVATE_KEY
PRODUCTION_SSH_KNOWN_HOSTS
```

أسماء متغيرات Environment الدقيقة:

```text
PRODUCTION_HOST
PRODUCTION_SSH_PORT
PRODUCTION_SSH_USER
PRODUCTION_APP_PATH
PRODUCTION_API_URL
PRODUCTION_ADMIN_URL
```

ومتغير build على مستوى repository:

```text
NEXT_PUBLIC_API_URL
```

هو fallback يبنى داخل صورة Admin، ويجب أن يطابق `PRODUCTION_API_URL`. أما `.env.prod` فيمرر عنوان التشغيل إلى Compose باسم `API_URL`؛ لا تخلط القيمتين أو تعتبر ملف VPS بديلاً عن build variable.

ومفتاح الإتاحة repository variable منفصل:

```text
PRODUCTION_DEPLOY_ENABLED
```

يبقى غائباً أو لا يساوي `true` حتى اكتمال staging وقائمة قبول `docs/DEPLOYMENT.md`.

[GitHub: deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

## Agent Toolkit for AWS

Agent Toolkit إعداد محلي لأداة الترميز، وليس GitHub App ولا CI scanner. في 2026-08-08 ثُبّت AWS CLI الرسمي محلياً بالإصدار `2.36.19` وضُبطت المنطقة الافتراضية `eu-north-1`. لم يُنفذ ربط Toolkit أو استدعاء catalog لأن هوية `aws login` المتحققة كانت AWS root؛ الحالة `BLOCKED ON NON-ROOT LOGIN`.

الأوامر المرجعية الدقيقة من تعليمات AWS:

```bash
aws configure set region eu-north-1
```

```bash
aws login --region eu-north-1
```

```bash
aws sts get-caller-identity
```

يجب أن تكون قيمة ARN غير منتهية بـ`:root`. توقف إذا كانت root، ثم فعّل MFA وسجل بهوية IAM Identity Center غير جذرية قبل متابعة أي أمر Toolkit.

```bash
aws configure agent-toolkit --yes --region us-east-1
```

إذا لم يعرف CLI الخيار `--yes`:

```bash
aws configure agent-toolkit --region us-east-1
```

والتحقق:

```bash
aws agent-toolkit list-available-skills --region us-east-1
```

بعد نجاح catalog، احفظ قواعد AWS الرسمية في جذر المستودع. لا تنفذ هذا الأمر فوق ملف `AGENTS.md` قائم من دون دمج ومراجعة:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/rules/aws-agent-rules.md \
  -o AGENTS.md
```

ثم راجع الملف وابدأ جلسة Codex جديدة كي تحمل القواعد والمهارات الجديدة. هذه الخطوات لم تنفذ في هذا الفرع بسبب حاجز root، و`AGENTS.md` غير منشأ هنا.

منطقة Agent Toolkit حالياً هي `us-east-1` حتى لو كانت منطقة المشروع `eu-north-1`. جلسة `aws login` صالحة 12 ساعة، ويمكن تجديدها مدة تصل إلى 90 يوماً دون إعادة browser authentication بحسب تعليمات الإعداد. لا تطلب التعليمات access key أو secret key.

[AWS Agent Toolkit setup instructions](https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/setup-instructions/setup.md)

نجاح `list-available-skills` مستقبلاً سيثبت تركيب Toolkit واتصال catalog فقط. لا يثبت تفعيل Amazon Q على GitHub ولا إنشاء مورد AWS. لا يجوز استعمال نجاح الأمر لتبرير جلسة root.

## Amazon Q Developer for GitHub

### الحالة

`NOT ENABLED / NOT VERIFIED`.

Amazon Q Developer for GitHub ما زال Preview وقابلاً للتغيير، ويعالج بيانات تكامل GitHub في الولايات المتحدة. لا يوجد دليل متحقق على تثبيت التطبيق للمستودع، لذلك لا يدخل required checks ولا يُذكر كحاجز نشط.

[AWS: Amazon Q Developer for GitHub Preview](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/amazon-q-for-github.html)

### التثبيت اليدوي

1. افتح صفحة Amazon Q Developer for GitHub في GitHub Marketplace بحساب يملك صلاحية تثبيت GitHub Apps.

2. اختر Install.

3. اختر `Only select repositories` وحدد `m7hm4d/superapp`، لا `All repositories`.

4. راجع الصلاحيات وثبت التطبيق.

5. تحقق أولاً أن شاشة تثبيت GitHub App تعرض المستودع الشخصي `m7hm4d/superapp`. وثائق AWS تصف متطلبات organization ولا تضمن بوضوح كل مستودع شخصي؛ إن لم يظهر يبقى التكامل `NOT VERIFIED` ولا توسع التثبيت إلى كل المستودعات.

6. اختيارياً، سجل installation في Amazon Q Developer console في `us-east-1` لرفع الحصة المجانية وإدارة feature settings. Stockholm ليست منطقة Q Developer profile، وملف Frankfurt لا يدعم Q for GitHub. هذا يحتاج تفويض AWS/GitHub بشرياً.

[AWS: GitHub quickstart and app authorization](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/github-quickstart.html)

[AWS: register the GitHub installation](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/github-register-app-install.html)

[AWS: Amazon Q Developer profile regions](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/q-admin-setup-subscribe-regions.html)

### الأوامر والحدود الدقيقة

في Issue جديد أو موجود:

```text
/q dev
```

ينفذ feature development ويفتح PR. يمكن كذلك استعمال label بالاسم الدقيق:

```text
Amazon Q development agent
```

في تعليق جديد أعلى PR:

```text
/q review
```

يعيد فحص diff الحالي. الأمر لا يعمل إذا وضع reply داخل thread موجود.

للسؤال أو طلب تعديل في محادثة PR:

```text
/q explain the importance of this finding
```

وللمساعدة:

```text
/q help
```

المراجعة التلقائية تعمل عند فتح PR جديد أو إعادة فتح PR مغلق. لا يعاد تشغيلها تلقائياً عند push لاحق إلى PR موجود؛ بعد كل revision مطلوب يجب كتابة `/q review` في تعليق جديد.

مطلق المراجعة يحتاج GitHub role من `Write` أو `Maintain` أو `Admin`. خدمة Preview تعطي عدداً محدوداً من feature invocations وعدداً محدوداً من أسطر code review شهرياً؛ وثائق AWS العامة الحالية لا تنشر رقماً ثابتاً، لذلك لا نخترع حصة. التسجيل بحساب AWS يزيد free usage وفق الحصة التي تعرضها console.

[AWS: Amazon Q reviews, triggers, commands, and limits](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/github-code-reviews.html)

[AWS: Amazon Q feature development](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/github-feature-development.html)

### اختبار القبول

1. افتح PR آمن يوثق اختبار التكامل فقط.

2. تحقق أن Amazon Q نشر summary وthreaded findings أو نتيجة واضحة.

3. ادفع commit توثيقياً آخر؛ لا تتوقع auto-review.

4. اكتب `/q review` في تعليق جديد وتحقق أن SHA/diff الأحدث هو المفحوص.

5. راجع أي patch يقترحه كأي مساهم آخر؛ لا تمنحه auto-merge أو bypass.

حتى اكتمال هذه الخطوات تبقى الحالة `NOT VERIFIED`.

## Amazon Inspector Code Security

### الحالة والدعم

`NOT ENABLED / NOT VERIFIED`.

أصبح Code Security GA في 2025-06-17 ويدعم SAST وSCA وIaC. قائمة المناطق الرسمية تشمل Europe (Stockholm)، أي `eu-north-1`.

[AWS announcement: Inspector Code Security GA and Regions](https://aws.amazon.com/about-aws/whats-new/2025/06/amazon-inspector-code-security-shift-security-development/)

### التفعيل اليدوي المقترح

بعد تأمين root والموافقة على التكلفة:

1. افتح Amazon Inspector في `eu-north-1` بهوية غير جذرية.

2. اختر Code Security ثم Activate.

3. اختر Connect to ثم GitHub.

4. أكمل نافذة Authorize؛ إغلاقها يمنع إتمام الربط.

5. ثبّت GitHub App وحدد `m7hm4d/superapp` فقط، ثم أدخل installation ID عند الطلب.

6. أنشئ general scan configuration لهذا المستودع، لا default عاماً لكل repositories.

7. اختر Complete analysis: SAST وSCA وIaC.

8. اختر change-based على PR المفتوح أول مرة وعلى merge/push إلى default branch، مع periodic scan أسبوعي.

[AWS: connect Amazon Inspector to GitHub](https://docs.aws.amazon.com/inspector/latest/user/code-security-assessments-connect-github.html)

[AWS: create a Code Security scan configuration](https://docs.aws.amazon.com/inspector/latest/user/code-security-assessments-create-configuration.html)

### القيود التشغيلية

- Inspector يراقب default branch فقط. عند تغيير default branch ينتقل إليه.

- event trigger يعمل عند فتح PR أول مرة ضد default branch، وعند merge أو push إلى default branch.

- لا يعاد scan تلقائياً على revisions لاحقة داخل PR نفسه. لإعادة الحدث أغلق PR وأعد فتحه، أو نفذ scan مناسباً يدوياً وفق console.

- إذا كانت configuration تحتوي PR triggers فقط، يظهر أعلى 25 finding من CRITICAL/HIGH داخل SCM فقط ولا يظهر شيء في Inspector console. لذلك نحتاج push/periodic أيضاً.

- periodic scan يتخطى commit لم يتغير خلال أسبوع، وon-demand قد يتخطى commit نفسه خلال 24 ساعة.

- الحد الأقصى هو scan configuration افتراضية واحدة للحساب/المنظمة، و500 general configurations، وأربع configurations للمشروع الواحد.

### التكلفة والقبول

سعر `eu-north-1` المتحقق من AWS Price List هو `0.18 USD` لكل scan type ولكل وحدة repository حتى 10 MB. ثلاثة أنواع تعني `0.54 USD` لكل حدث scan. المستودعات الأكبر تحسب وحدات 10 MB متعددة.

مثال أعلى وضوحاً لخمس PRs تُفتح ثم تُدمج، مع أربعة فحوص أسبوعية وفحص أولي، هو 15 حدثاً: خمسة PR + خمسة merge/push + أربعة periodic + واحد initial. النتيجة `15 x 0.54 = 8.10 USD/month` لمستودع ضمن وحدة 10 MB واحدة. إذا لم تُدمج كل PRs أو تخطى Inspector commits غير المتغيرة ينخفض الفعلي. توجد تجربة Inspector مجانية 15 يوماً للحسابات الجديدة.

[Amazon Inspector pricing](https://aws.amazon.com/inspector/pricing/)

اختبار القبول:

1. تظهر integration بحالة Active والمشروع بحالة Scanning في `eu-north-1`.

2. يظهر scan للـdefault branch وتظهر النتائج في Inspector console.

3. PR آمن جديد يستقبل نتيجة في GitHub.

4. يُثبت عملياً أن revision لاحقة لا تعيد trigger، وتوثق طريقة إعادة الفحص للفريق.

5. تراجع findings أسبوعاً قبل جعل أي GitHub check حاجزاً. لا يُسمح بدمج finding حرج قابل للوصول لمجرد أن CodeQL أخضر.

## أوامر تحقق محلية

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm exec prettier --check docs/AWS_ARCHITECTURE.md docs/SECURITY.md docs/CI_CD.md docs/DEPLOYMENT.md docs/DISASTER_RECOVERY.md
```

```bash
pnpm run typecheck
pnpm run lint
```

```bash
python3 scripts/check-workflow-injection.py
python3 scripts/check-module-boundaries.py
```

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet
```

آخر أمر يحتاج ملف بيئة محلياً بقيم اختبارية ولا يجوز تشغيله ضد الإنتاج من جهاز غير مصرح. يبقى GitHub Actions هو الإثبات النهائي لبناء Docker لأن Docker غير متوفر على جهاز التدقيق الحالي.

## ما لا يجوز ادعاؤه قبل الإثبات

- وجود ملف workflow لا يعني أن ruleset يطلبه.

- الإشارة إلى `environment: production` لا تعني أن required reviewer أو secrets ضُبطت.

- نجاح Agent Toolkit لا يعني تثبيت Amazon Q GitHub.

- توفر Inspector في المنطقة لا يعني ربط المستودع.

- نجاح CI على PR لا يعني نجاح workflow بعد الدمج أو وصول النشر إلى VPS.

- enqueue أو بدء workflow ليس نجاحاً؛ ننتظر terminal conclusion والـSHA المطابق.
