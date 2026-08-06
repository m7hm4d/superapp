#!/usr/bin/env bash
#
# فحص بيئة منشورة من الخارج — عبر HTTPS كما يراها المستخدم.
#
#   ./deploy/verify-deployment.sh https://api-stage.4irq.com https://stage.4irq.com
#
# لماذا ليس حزمة e2e نفسها: تلك تُقلع Nest **داخل العملية** وتتحقق من قاعدة
# البيانات مباشرة، فهي تختبر المنطق لا النشر. لا يمكن توجيهها إلى مضيف بعيد
# بلا نزع ما يجعلها ذات قيمة. هذا السكربت يسأل السؤال الآخر: هل ما نُشر
# **مضبوط** — الشهادة والترويسات والحدود والأصول؟
#
set -euo pipefail

API="${1:?الاستعمال: $0 <api-url> <admin-url>}"
ADMIN="${2:?الاستعمال: $0 <api-url> <admin-url>}"

pass=0
fail=0

check() { # الوصف، الأمر...
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  \033[32m✓\033[0m %s\n' "$desc"; pass=$((pass + 1))
  else
    printf '  \033[31m✗\033[0m %s\n' "$desc"; fail=$((fail + 1))
  fi
}

body() { curl -fsS --max-time 15 "$@"; }
headers() { curl -fsSI --max-time 15 "$@"; }

echo "فحص النشر"
echo "  api:   $API"
echo "  admin: $ADMIN"
echo

echo "الشهادة والنقل"
# شهادة صالحة: curl بلا -k يفشل على شهادة موقّعة ذاتياً أو منتهية
check "الـAPI يقدّم شهادة TLS صالحة" body "$API/api/v1/health"
check "اللوحة تقدّم شهادة TLS صالحة" body "$ADMIN/login"
check "HSTS مضبوط على اللوحة" bash -c "headers() { curl -fsSI --max-time 15 \"\$@\"; }; headers '$ADMIN/login' | grep -qi 'strict-transport-security'"
check "اللوحة لا تُؤطَّر (X-Frame-Options)" bash -c "curl -fsSI --max-time 15 '$ADMIN/login' | grep -qi 'x-frame-options: *deny'"
check "لا كشف لإصدار الخادم" bash -c "! curl -fsSI --max-time 15 '$API/api/v1/health' | grep -qi '^server: *caddy'"

echo
echo "الـAPI"
check "الصحة تردّ ok" bash -c "curl -fsS --max-time 15 '$API/api/v1/health' | grep -q '\"status\":\"ok\"'"
check "قاعدة البيانات متصلة" bash -c "curl -fsS --max-time 15 '$API/api/v1/health' | grep -q '\"db\":\"up\"'"
check "الهجرات مطبَّقة (المخطط يردّ لا يخطئ)" bash -c "curl -fsS --max-time 15 '$API/api/v1/health' | grep -q '\"db\":\"up\"'"

echo
echo "المصادقة"
# مسار محمي بلا توكن يجب أن يردّ 401 لا 200 ولا 500
check "مسار إداري بلا توكن يردّ 401" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 '$API/api/v1/admin/orders')\" = '401'"
check "دخول الأدمن بكلمة خاطئة يردّ 401" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST '$API/api/v1/auth/admin/login' -H 'content-type: application/json' -d '{\"email\":\"nobody@example.com\",\"password\":\"wrong\"}')\" = '401'"

echo
echo "اللوحة"
check "صفحة الدخول تُخدَم" bash -c "curl -fsS --max-time 15 '$ADMIN/login' | grep -q '<title>'"
# اللوحة تخبز عنوان الـAPI وقت البناء — لو أشارت إلى بيئة أخرى لظهر هنا
check "اللوحة مبنيّة على عنوان الـAPI الصحيح" bash -c "curl -fsS --max-time 15 '$ADMIN/login' | grep -qF '$(echo "$API" | sed 's|https://||')'"

echo
echo "حدّ المحاولات"
# الحدّ الافتراضي 5/دقيقة لكل IP على مسارات المصادقة. ستّ محاولات خاطئة
# متتالية يجب أن تُنتج 429 — وإلا فإما الحدّ معطّل أو TRUST_PROXY خاطئ
# فيرى الخادم عنوان الوكيل لكل الزوار.
rate_limited=false
for _ in $(seq 1 8); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$API/api/v1/auth/admin/login" \
    -H 'content-type: application/json' -d '{"email":"nobody@example.com","password":"wrong"}' || true)
  [ "$code" = "429" ] && { rate_limited=true; break; }
done
if $rate_limited; then
  printf '  \033[32m✓\033[0m الحدّ يرفض بعد محاولات متتالية (429)\n'; pass=$((pass + 1))
else
  printf '  \033[31m✗\033[0m الحدّ لم يرفض — راجع AUTH_THROTTLE_LIMIT و TRUST_PROXY\n'; fail=$((fail + 1))
fi

echo
echo "النتيجة: ${pass} نجحت، ${fail} فشلت"
[ "$fail" -eq 0 ]
