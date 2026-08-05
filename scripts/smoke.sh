#!/usr/bin/env bash
# فحص دخان سريع ضد بيئة منشورة: BASE_URL=https://api.example.iq ./scripts/smoke.sh
# يمر عبر: الصحة ← الإعدادات ← دخول الأدمن ← المتاجر القريبة ← إنشاء طلب كامل وإلغاؤه.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API="$BASE_URL/api/v1"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@superapp.local}"
# لا كلمة مرور افتراضية — مرّرها صراحة: ADMIN_PASSWORD=... ./scripts/smoke.sh
ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD مطلوب (لم تعد هناك كلمة مرور افتراضية للأدمن)}"

pass() { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

command -v jq >/dev/null || fail "jq مطلوب لتشغيل هذا السكربت"

# 1) الصحة
curl -fsS "$API/health" | jq -e '.db == "up"' >/dev/null || fail "health"
pass "health: db up"

# 2) الإعدادات العامة
CONFIG=$(curl -fsS "$API/config")
echo "$CONFIG" | jq -e '.flags."category.bakery"' >/dev/null || fail "config flags"
CITY_LAT=$(echo "$CONFIG" | jq -r '.city.centerLat')
CITY_LNG=$(echo "$CONFIG" | jq -r '.city.centerLng')
pass "config: flags + city ($CITY_LAT,$CITY_LNG)"

# 3) دخول الأدمن بالبريد
ADMIN_TOKEN=$(curl -fsS -X POST "$API/auth/admin/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | jq -r '.tokens.accessToken')
[ "$ADMIN_TOKEN" != "null" ] || fail "admin login"
pass "admin login"

# 4) المتاجر القريبة (PostGIS)
NEARBY=$(curl -fsS "$API/vendors/nearby?lat=$CITY_LAT&lng=$CITY_LNG&radius=5000")
VENDOR_ID=$(echo "$NEARBY" | jq -r '[.[] | select(.isOpen)][0].id')
[ "$VENDOR_ID" != "null" ] && [ -n "$VENDOR_ID" ] || fail "no open vendors nearby"
pass "nearby: open vendor $VENDOR_ID"

# 5) عميل جديد + طلب كامل ثم إلغاء (لا يترك أثراً تشغيلياً)
PHONE="+96477$(jq -rn '(now*1000|floor)%100000000' | xargs printf '%08d')"
CUSTOMER_TOKEN=$(curl -fsS -X POST "$API/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"role\":\"customer\",\"phone\":\"$PHONE\",\"password\":\"Smoke#12345\",\"fullName\":\"فحص دخان\"}" \
  | jq -r '.tokens.accessToken')
[ "$CUSTOMER_TOKEN" != "null" ] || fail "customer register"

PRODUCT_ID=$(curl -fsS "$API/vendors/$VENDOR_ID" | jq -r '.products[0].id')
[ "$PRODUCT_ID" != "null" ] || fail "vendor has no products"

ORDER=$(curl -fsS -X POST "$API/orders" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $CUSTOMER_TOKEN" \
  -H "x-idempotency-key: smoke-$PHONE" \
  -d "{\"vendorId\":\"$VENDOR_ID\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}],\"delivery\":{\"location\":{\"lat\":$CITY_LAT,\"lng\":$CITY_LNG},\"addressText\":\"فحص دخان — يُلغى فوراً\",\"contactPhone\":\"$PHONE\"}}")
ORDER_ID=$(echo "$ORDER" | jq -r '.id')
echo "$ORDER" | jq -e '.status == "PENDING_BAKERY" and (.deliveryPin | test("^[0-9]{4}$"))' >/dev/null || fail "order create"
pass "order created: $(echo "$ORDER" | jq -r '.code')"

curl -fsS -X POST "$API/orders/$ORDER_ID/cancel" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $CUSTOMER_TOKEN" \
  -H "x-idempotency-key: smoke-cancel-$PHONE" \
  -d '{"reason":"فحص دخان"}' >/dev/null || fail "order cancel"
pass "order cancelled cleanly"

echo
echo "🎉 كل فحوصات الدخان مرت — $BASE_URL سليم"
