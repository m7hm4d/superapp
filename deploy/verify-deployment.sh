#!/usr/bin/env bash
#
# فحص بيئة منشورة من الخارج عبر HTTPS كما يراها المستخدم.
#
#   ./deploy/verify-deployment.sh \
#     --api-url https://api-stage.4irq.com \
#     --admin-url https://stage.4irq.com \
#     --expected-revision 0123456789abcdef0123456789abcdef01234567
#   ./deploy/verify-deployment.sh --check-rate-limit \
#     --auth-throttle-limit 5 \
#     --api-url https://api-stage.4irq.com \
#     --admin-url https://stage.4irq.com
#
# الصيغة الموضعية القديمة ما زالت مدعومة للتوافق:
#   ./deploy/verify-deployment.sh https://api-stage.4irq.com https://stage.4irq.com
#
# لا يُبنى أي أمر نصي ولا يُمرَّر URL إلى bash -c؛ كل قيمة تصبح وسيطة curl
# مقتبسة بعد التحقق من أنها أصل HTTPS بلا userinfo أو مسار.
#
set -euo pipefail

usage() {
  cat <<'EOF'
الاستعمال:
  verify-deployment.sh [--check-rate-limit [--auth-throttle-limit N]] \
    [--expected-revision FULL_SHA] \
    --api-url HTTPS_ORIGIN --admin-url HTTPS_ORIGIN
  verify-deployment.sh HTTPS_API_ORIGIN HTTPS_ADMIN_ORIGIN

الفحص الافتراضي لا يستهلك عداد محاولات الدخول. الخيار --check-rate-limit
مخصص لفحص يدوي أو مجدول، لأنه يرسل محاولات خاطئة عمداً حتى يثبت انتقال
مسار المصادقة من 401 إلى 429. يجب أن يطابق N قيمة AUTH_THROTTLE_LIMIT المنشورة.
EOF
}

die() {
  printf 'خطأ: %s\n' "$*" >&2
  exit 1
}

require_value() {
  local option="$1"
  local value="${2-}"
  [ -n "$value" ] || die "$option يحتاج قيمة"
  printf '%s' "$value"
}

set_api_url() {
  [ -z "$API" ] || die "عنوان API مكرر"
  API="$1"
}

set_admin_url() {
  [ -z "$ADMIN" ] || die "عنوان admin مكرر"
  ADMIN="$1"
}

validate_https_origin() {
  local option="$1"
  local value="$2"
  [[ "$value" =~ ^https://([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:[0-9]{1,5})?$ ]] || \
    die "$option يجب أن يكون أصل HTTPS مثل https://api.example.com بلا مسار"
}

API=""
ADMIN=""
CHECK_RATE_LIMIT=false
EXPECTED_AUTH_THROTTLE_LIMIT=5
EXPECTED_REVISION=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --api-url)
      set_api_url "$(require_value "$1" "${2-}")"
      shift 2
      ;;
    --admin-url)
      set_admin_url "$(require_value "$1" "${2-}")"
      shift 2
      ;;
    --check-rate-limit)
      CHECK_RATE_LIMIT=true
      shift
      ;;
    --auth-throttle-limit)
      EXPECTED_AUTH_THROTTLE_LIMIT="$(require_value "$1" "${2-}")"
      shift 2
      ;;
    --expected-revision)
      [ -z "$EXPECTED_REVISION" ] || die "--expected-revision مكرر"
      EXPECTED_REVISION="$(require_value "$1" "${2-}")"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      die "خيار غير معروف: $1"
      ;;
    *)
      if [ -z "$API" ]; then
        set_api_url "$1"
      elif [ -z "$ADMIN" ]; then
        set_admin_url "$1"
      else
        die "وُجد أكثر من عنوانين؛ حدّد API وadmin مرة واحدة"
      fi
      shift
      ;;
  esac
done

[ -n "$API" ] && [ -n "$ADMIN" ] || die "عنوانا API وadmin مطلوبان"
validate_https_origin "API URL" "$API"
validate_https_origin "admin URL" "$ADMIN"
[[ "$EXPECTED_AUTH_THROTTLE_LIMIT" =~ ^[1-9][0-9]{0,2}$ ]] || \
  die "--auth-throttle-limit يجب أن يكون عدداً من 1 إلى 999"
if ! $CHECK_RATE_LIMIT && [ "$EXPECTED_AUTH_THROTTLE_LIMIT" != 5 ]; then
  die "--auth-throttle-limit لا يُستخدم بلا --check-rate-limit"
fi
if [ -n "$EXPECTED_REVISION" ]; then
  [[ "$EXPECTED_REVISION" =~ ^[0-9a-f]{40}$ ]] || \
    die "--expected-revision يجب أن يكون Git SHA كاملاً وصغيراً"
fi
command -v curl >/dev/null 2>&1 || die "curl غير مثبَّت"
command -v grep >/dev/null 2>&1 || die "grep غير مثبَّت"

# -q أول وسيطة دائماً: لا ~/.curlrc يستطيع إضافة insecure أو connect-to.
# نعطل proxy ونزيل مسارات CA الموروثة كي نفحص النطاق وشهادة النظام فعلياً.
unset CURL_CA_BUNDLE CURL_HOME SSL_CERT_DIR SSL_CERT_FILE SSLKEYLOGFILE
CURL_COMMON=(-q --noproxy '*' --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 15)
pass=0
fail=0

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf '  \033[32m✓\033[0m %s\n' "$desc"
    pass=$((pass + 1))
  else
    printf '  \033[31m✗\033[0m %s\n' "$desc"
    fail=$((fail + 1))
  fi
}

body() {
  curl "${CURL_COMMON[@]}" -fsS "$1"
}

headers() {
  curl "${CURL_COMMON[@]}" -fsSI "$1"
}

body_contains_fixed() {
  local url="$1"
  local expected="$2"
  local response
  response="$(body "$url")" || return 1
  grep -qF -- "$expected" <<< "$response"
}

headers_match() {
  local url="$1"
  local expected_regex="$2"
  local response
  response="$(headers "$url")" || return 1
  grep -Eqi -- "$expected_regex" <<< "$response"
}

headers_do_not_match() {
  local url="$1"
  local forbidden_regex="$2"
  local response
  response="$(headers "$url")" || return 1
  ! grep -Eqi -- "$forbidden_regex" <<< "$response"
}

http_code_is() {
  local expected="$1"
  local method="$2"
  local url="$3"
  local data="${4-}"
  local code
  local request=(curl "${CURL_COMMON[@]}" -sS -o /dev/null -w '%{http_code}' -X "$method" "$url")

  if [ -n "$data" ]; then
    request+=(-H 'content-type: application/json' --data "$data")
  fi
  code="$("${request[@]}")" || return 1
  [ "$code" = "$expected" ]
}

printf 'فحص النشر\n'
printf '  api:   %s\n' "$API"
printf '  admin: %s\n\n' "$ADMIN"

printf 'الشهادة والنقل\n'
# curl بلا -k يفشل على شهادة موقعة ذاتياً أو منتهية.
check "الـAPI يقدّم شهادة TLS صالحة" body "$API/api/v1/health"
check "اللوحة تقدّم شهادة TLS صالحة" body "$ADMIN/login"
check "HSTS مضبوط على اللوحة" headers_match "$ADMIN/login" '^strict-transport-security:[[:space:]]*max-age='
check "اللوحة لا تُؤطَّر (X-Frame-Options)" headers_match "$ADMIN/login" '^x-frame-options:[[:space:]]*deny([[:space:]]|$)'
check "لا كشف لإصدار Caddy" headers_do_not_match "$API/api/v1/health" '^server:[[:space:]]*caddy([[:space:]]|$)'

printf '\nالـAPI\n'
check "الصحة تردّ ok" body_contains_fixed "$API/api/v1/health" '"status":"ok"'
check "قاعدة البيانات متصلة" body_contains_fixed "$API/api/v1/health" '"db":"up"'

printf '\nالمصادقة\n'
# مسار محمي بلا token يجب أن يرد 401 لا 200 ولا 500.
check "مسار إداري بلا token يردّ 401" http_code_is 401 GET "$API/api/v1/admin/orders"

printf '\nاللوحة\n'
check "صفحة الدخول تُخدَم" body_contains_fixed "$ADMIN/login" '<title>'
# اللوحة تحقن عنوان API في HTML عند كل طلب؛ القيمة ثابتة لا regex.
check "اللوحة تشير إلى عنوان API الصحيح" body_contains_fixed "$ADMIN/login" \
  "__SUPERAPP_API_URL__\"]=\"$API\""

printf '\nهوية الإصدار عبر الحافة\n'
if [ -n "$EXPECTED_REVISION" ]; then
  check "الـAPI الخارجي يخدم commit المطلوب" body_contains_fixed \
    "$API/api/v1/health" "\"revision\":\"$EXPECTED_REVISION\""
  check "اللوحة الخارجية تخدم commit المطلوب" body_contains_fixed \
    "$ADMIN/login" "__SUPERAPP_REVISION__\"]=\"$EXPECTED_REVISION\""
else
  printf '  - لم يُمرر --expected-revision؛ لم تُثبت هوية commit الخارجية.\n'
fi

if $CHECK_RATE_LIMIT; then
  printf '\nحدّ المحاولات (فحص متعمّد يغيّر العداد)\n'
  # يلزم IP غير محدود مسبقاً حتى نثبت انتقال auth نفسه من 401 إلى 429، لا
  # مجرد 429 صادر من طبقة أخرى أو عداد قديم.
  rate_limited=false
  seen_unauthorized=false
  unexpected_code=""
  max_attempts=$((EXPECTED_AUTH_THROTTLE_LIMIT + 2))
  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    code="$(
      curl "${CURL_COMMON[@]}" -sS -o /dev/null -w '%{http_code}' \
        -X POST "$API/api/v1/auth/admin/login" \
        -H 'content-type: application/json' \
        --data '{"email":"nobody@example.com","password":"wrong"}'
    )" || code="000"
    case "$code" in
      401) seen_unauthorized=true ;;
      429)
        if $seen_unauthorized; then
          rate_limited=true
        else
          unexpected_code="429-before-401"
        fi
        break
        ;;
      *)
        unexpected_code="$code"
        break
        ;;
    esac
  done

  if $rate_limited; then
    printf '  \033[32m✓\033[0m الحدّ يرفض بعد محاولات متتالية (429)\n'
    pass=$((pass + 1))
  else
    if [ "$unexpected_code" = "429-before-401" ]; then
      printf '  \033[31m✗\033[0m الـIP محدود مسبقاً؛ انتظر TTL أو استخدم IP staging معزولاً ثم أعد الفحص\n'
    elif [ -n "$unexpected_code" ]; then
      printf '  \033[31m✗\033[0m مسار الدخول أعاد HTTP %s بدلاً من 401/429\n' "$unexpected_code"
    else
      printf '  \033[31m✗\033[0m الحدّ لم يرفض بعد %s محاولة — طابق AUTH_THROTTLE_LIMIT وراجع TRUST_PROXY\n' \
        "$max_attempts"
    fi
    fail=$((fail + 1))
  fi
else
  printf '\nحدّ المحاولات\n'
  printf '  - لم يُستهلك العداد في بوابة النشر؛ شغّل --check-rate-limit يدوياً أو مجدولاً.\n'
fi

printf '\nالنتيجة: %s نجحت، %s فشلت\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
