# سياسة الأمان — Security Policy

## الإبلاغ عن ثغرة

**لا تفتح Issue عامًا لثغرة أمنية.** الـIssues مرئية للجميع، ونشر التفاصيل قبل
الإصلاح يعرّض المستخدمين للخطر.

استخدم القناة الخاصة:

**[Security ← Report a vulnerability](https://github.com/m7hm4d/superapp/security/advisories/new)**

تبقى المحادثة خاصة بينك وبين المشرفين حتى يصدر الإصلاح.

### ما يفيدنا في البلاغ

- المسار أو الملف المتأثر، ونوع الثغرة.
- خطوات إعادة الإنتاج، أو طلب `curl` يوضّح المشكلة.
- الأثر: ما الذي يستطيع المهاجم فعله فعلًا؟
- أي إعداد خاص يلزم لتحقّقها.

### ما تتوقعه منّا

| | |
|---|---|
| أول ردّ | خلال **72 ساعة** |
| تقييم أولي | خلال **7 أيام** |
| إصلاح الخطورة الحرجة والعالية | خلال **30 يومًا** |
| إصلاح المتوسطة والمنخفضة | في دورة الإصدار التالية |

نُشير إليك في الإفصاح ما لم تطلب خلاف ذلك.

## النطاق

المستودع يضم الواجهة الخلفية (`apps/api`) ولوحة الإدارة (`apps/admin`) وثلاثة
تطبيقات هاتف (`apps/customer` و`apps/vendor` و`apps/driver`) وحزم مشتركة.

**ما يهمّنا خصوصًا**: تجاوز المصادقة أو المصادقة الثنائية، ورفع الصلاحيات بين
الأدوار (عميل/مخبز/سائق/أدمن)، وحقن SQL، والوصول إلى بيانات مستأجر آخر، وأي خلل
في الدفتر المالي يسمح بتحريك مال بلا قيد مقابل.

**خارج النطاق**: هجمات الحرمان من الخدمة بالحجم، والثغرات في اعتماديات لا يصلها
مدخل خارجي عندنا (نوثّق قرارنا في وصف التنبيه)، وتقارير الماسحات الآلية بلا
إثبات أثر.

## الإصدارات المدعومة

المشروع قبل الإصدار الأول. الفرع `main` وحده مدعوم.

## ما هو مفعّل هنا

- ‏CodeQL على كل PR وأسبوعيًا.
- ‏Dependabot: تنبيهات وتحديثات أمنية تلقائية.
- ‏Secret Scanning مع حماية الدفع — سرّ يُدفع بالخطأ يُرفض قبل وصوله.
- ‏`main` محمي: لا دفع مباشر ولا force push، والفحوص شرط للدمج.

---

# Security Policy (English)

**Do not open a public issue for a security vulnerability.** Use
[GitHub's private vulnerability reporting](https://github.com/m7hm4d/superapp/security/advisories/new)
instead; the thread stays private until a fix ships.

Please include the affected path, reproduction steps, and the actual impact.

We aim to acknowledge within **72 hours**, trilage within **7 days**, and fix
critical/high severity issues within **30 days**. We credit reporters unless you
ask us not to.

**In scope**: authentication and 2FA bypass, privilege escalation across roles
(customer / vendor / driver / admin), SQL injection, cross-tenant data access,
and any ledger flaw that moves money without a balancing entry.

**Out of scope**: volumetric denial of service, vulnerabilities in dependencies
no external input reaches (we document that reasoning on the alert), and
automated scanner output with no demonstrated impact.

Only `main` is supported; the project is pre-1.0.
