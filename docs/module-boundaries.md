# حدود الوحدات — الملكية والتقدّم

لكل جدول وحدة واحدة تملكه. المالك **من يشغّل** — استُخرج من الشيفرة.

## الملكية

| الوحدة | جداولها |
|---|---|
| `admin` | `adminAuditLog` |
| `auth` | `adminCredentials` · `adminPasskeys` · `authEvents` · `refreshTokens` · `users` · `webauthnChallenges` |
| `common` | `idempotencyKeys` · `pinAttempts` |
| `deliveries` | `batchOrders` · `batches` · `driverProfiles` · `exceptions` |
| `flags` | `cities` · `featureFlags` · `tenants` |
| `ledger` | `ledgerEntries` · `settlements` |
| `orders` | `orderEvents` · `orderItems` · `orders` |
| `push` | `pushTokens` |
| `vendors` | `products` · `vendorProfiles` |

## المنافذ

| المنفذ | الوحدة |
|---|---|
| `VendorDirectoryService` | `vendors` |
| `DriverDirectoryService` | `deliveries` |
| `UserDirectoryService` | `auth` |
| `OrderDirectoryService` | `orders` |

**المنافذ أوراق في شجرة الاعتماد** — في وحدات خفيفة لا تستورد إلا ما تحتاجه
للقراءة، فيعتمد عليها الجميع بلا دورة. و`forwardRef` يُسكت المترجم ولا يُصلح
الشكل.

## نمط ثانٍ: كل مجال يملك استعلاماته الإدارية

اللوحة نموذج قراءة فوق المجالات كلها، وتلمس اثني عشر جدولاً ولا تملك إلا
سجلّ تدقيقها. فبدل أن تنادي منافذ لكل شيء، ينتقل الاستعلام الإداري إلى وحدة
المالك وتفوّض إليه اللوحة — كما في `ExceptionQueriesService`.

## الخروق الباقية

**39** خرقاً (كانت 48).

| الوحدة | خروقها |
|---|---|
| `admin` | 16 |
| `deliveries` | 7 |
| `common` | 4 |
| `ledger` | 4 |
| `orders` | 4 |
| `auth` | 3 |
| `realtime` | 2 |
| `push` | 1 |
| `vendors` | 1 |

## عوائق موثّقة

**`admin/ops.service.ts`**: 82 موضعاً عبر تسعة جداول — نموذج قراءة مالي كامل.
يحتاج دفعة خاصة به، ونقلاً تدريجياً لاستعلاماته إلى مُلّاكها.

**عائق `ledger` رُفع**: كان يُصفّي بـ`orders.vendorId` عبر انضمام. تبيّن أن
`ledger_entries.vendor_id` موجود منذ البداية بفهرسه، وأن مسار الكتابة وحده
كان يتركه فارغاً في قيود النقد المحصَّل. فلا إلغاء تطبيع ولا تغيير مخطط —
تعبئة عمود قائم.

## كيف يُفرَّغ سطر

1. منفذ في وحدة المالك — أو انقل الاستعلام إليها  2. استبدال  3. `--update`

**الانضمامات تحتاج حذراً**: نداء لكل صف يحوّل استعلاماً واحداً إلى N+1.
استعمل المنفذ الدفعي واضمم في الذاكرة، وأبقِ التصفية والترقيم على جدولك.
