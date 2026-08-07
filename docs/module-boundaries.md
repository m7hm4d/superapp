# حدود الوحدات — الملكية والتقدّم

لكل جدول وحدة واحدة تملكه. من أراد بياناته نادى وحدته بدل الاستعلام المباشر.
المالك **من يشغّل** لا من يكتب أكثر — استُخرج من الشيفرة.

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

| المنفذ | الوحدة | يغني عن |
|---|---|---|
| `VendorDirectoryService` | `vendors` | استعلام `vendorProfiles` |
| `DriverDirectoryService` | `deliveries` | استعلام `driverProfiles` (+ اسم صاحبه) |
| `UserDirectoryService` | `auth` | استعلام `users` للاسم |

**المنافذ أوراق في شجرة الاعتماد.** `DriverDirectoryService` في وحدة خفيفة
(`DriverDirectoryModule`) لا في `DeliveriesModule`، لأن تلك تستورد `LedgerModule`
ولو طلبها الدفتر لانغلقت حلقة `deliveries ⇄ ledger`. و`forwardRef` يُسكت المترجم
ولا يُصلح الشكل.

## الخروق الباقية

**43** خرقاً (كانت 48).

| الوحدة | خروقها |
|---|---|
| `admin` | 17 |
| `deliveries` | 7 |
| `common` | 4 |
| `ledger` | 4 |
| `orders` | 4 |
| `auth` | 3 |
| `realtime` | 2 |
| `push` | 1 |
| `vendors` | 1 |

| الجدول المطلوب | لمسات |
|---|---|
| `vendorProfiles` | 8 |
| `driverProfiles` | 7 |
| `users` | 6 |
| `orders` | 5 |
| `cities` | 4 |
| `featureFlags` | 3 |
| `batchOrders` | 2 |
| `batches` | 2 |
| `authEvents` | 1 |
| `exceptions` | 1 |
| `ledgerEntries` | 1 |
| `settlements` | 1 |
| `refreshTokens` | 1 |
| `products` | 1 |

## ما يعترض `ledger.service.ts`

موضعان فيه يضمّان `orders` **للتصفية** لا للإثراء: `WHERE orders.vendorId = ?`.
بلا الانضمام لا يستطيع الدفتر تصفية قيوده بالبائع، فيضطر لجلب كل قيود النقد
وتصفيتها في الذاكرة — غير محدود وينمو مع الزمن.

العلاج الصحيح ليس منفذاً بل **إلغاء تطبيع**: أن يحمل `ledger_entries` معرّف
البائع والسائق. قيدٌ مالي يجب أن يعرف من يخصّ بلا سؤال جدول آخر. وهو تغيير
مخطط بهجرة — دفعة مستقلة.

## كيف يُفرَّغ سطر

1. منفذ معلن في وحدة المالك  2. استبدال  3. `--update`

**الانضمامات تحتاج حذراً**: استبدال `innerJoin` بنداء لكل صف يحوّل استعلاماً
واحداً إلى N+1. استعمل المنفذ الدفعي ثم اضمم في الذاكرة.
