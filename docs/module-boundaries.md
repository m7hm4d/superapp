# حدود الوحدات — الملكية والتقدّم

لكل جدول وحدة واحدة تملكه. من أراد بياناته نادى وحدته بدل الاستعلام المباشر.
المالك **من يشغّل** لا من يكتب أكثر — استُخرج من الشيفرة: `auth` يكتب إنشاءً عند
التسجيل، و`admin` يكتب قراراً إدارياً على بيانات غيره، ووحدة المجال تكتب تشغيلاً
يومياً. فالأولان يصيران منافذ معلنة.

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

## الخروق الباقية

**48** خرقاً في `scripts/module-boundaries-baseline.json`.
القائمة تُفرَّغ ولا تُملأ: كل سطر يُحذف تقدّم، وأي خرق جديد يُسقط CI.

| الوحدة | خروقها |
|---|---|
| `admin` | 17 |
| `deliveries` | 7 |
| `ledger` | 7 |
| `common` | 4 |
| `orders` | 4 |
| `auth` | 3 |
| `realtime` | 3 |
| `push` | 2 |
| `vendors` | 1 |

| الجدول المطلوب | كم وحدة تلمسه بلا ملكية |
|---|---|
| `vendorProfiles` | 11 |
| `driverProfiles` | 8 |
| `users` | 7 |
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

## كيف يُفرَّغ سطر

1. أضف منفذاً معلناً في وحدة المالك (`vendors.summaryFor(id)`)
2. استبدل الاستعلام المباشر بندائه
3. `python3 scripts/check-module-boundaries.py --update`

لتغيير مالك: عدّل `scripts/module-ownership.json` — لا شيء آخر يعرف بالملكية.
