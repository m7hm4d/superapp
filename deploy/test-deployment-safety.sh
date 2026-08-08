#!/usr/bin/env bash
# اختبارات سريعة لا تحتاج Docker أو Compose أو شبكة. هدفها تثبيت حدود الأمان
# التي يسهل كسرها بتعديل صغير في parser أو ترتيب خطوات النشر.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_fails() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail "$description"
  fi
}

for script in deploy/*.sh; do
  bash -n "$script" || fail "bash -n: $script"
done

valid_db_config='{"services":{"db":{"environment":{"POSTGRES_USER":"app","POSTGRES_PASSWORD":"p%40ss","POSTGRES_DB":"appdb"}},"migrate":{"environment":{"DATABASE_URL":"postgres://app:p%2540ss@db:5432/appdb"}}}}'
printf '%s' "$valid_db_config" | python3 deploy/validate-db-target.py >/dev/null || \
  fail "validator يرفض DATABASE_URL المحلية المطابقة"
external_db_config='{"services":{"db":{"environment":{"POSTGRES_USER":"app","POSTGRES_PASSWORD":"secret","POSTGRES_DB":"appdb"}},"migrate":{"environment":{"DATABASE_URL":"postgres://app:secret@db.example.com:5432/appdb"}}}}'
if printf '%s' "$external_db_config" | python3 deploy/validate-db-target.py >/dev/null 2>&1; then
  fail "validator يقبل DATABASE_URL خارجية بلا backup مطابق"
fi
wrong_db_config='{"services":{"db":{"environment":{"POSTGRES_USER":"app","POSTGRES_PASSWORD":"secret","POSTGRES_DB":"appdb"}},"migrate":{"environment":{"DATABASE_URL":"postgres://app:secret@db:5432/other"}}}}'
if printf '%s' "$wrong_db_config" | python3 deploy/validate-db-target.py >/dev/null 2>&1; then
  fail "validator يقبل قاعدة migration مختلفة عن POSTGRES_DB"
fi

# يجب أن يسقط parser قبل أن يصل إلى فحص الملفات أو Docker.
full_sha_tag='sha-0123456789abcdef0123456789abcdef01234567'
assert_fails "deploy يقبل TAG مفقوداً" ./deploy/deploy.sh
assert_fails "deploy يقبل latest" ./deploy/deploy.sh latest
assert_fails "deploy يقبل SHA قصيراً قابلاً للتصادم" ./deploy/deploy.sh sha-1234567
assert_fails "deploy يقبل وسم major متحركاً" ./deploy/deploy.sh v1
assert_fails "deploy يقبل وسم minor متحركاً" ./deploy/deploy.sh v1.2
assert_fails "deploy يقبل SemVer كبديل عن SHA المصدر" ./deploy/deploy.sh v1.2.3
assert_fails "deploy يقبل أكثر من TAG" ./deploy/deploy.sh sha-1234567 v1.2.3
assert_fails "deploy يقبل expected stack غير صالح" \
  ./deploy/deploy.sh --expected-stack 'Prod!' "$full_sha_tag"
assert_fails "deploy يقبل api-url بلا admin-url" \
  ./deploy/deploy.sh --api-url https://api.example.com sha-1234567
assert_fails "deploy يقبل root كمسار حالة" \
  env DEPLOY_STATE_DIR=/ ./deploy/deploy.sh "$full_sha_tag"
assert_fails "deploy يقبل مجلد نظام واسع كمسار حالة" \
  env DEPLOY_STATE_DIR=/lib ./deploy/deploy.sh "$full_sha_tag"
# قيمة حرفية مقصودة لإثبات أن parser يرفض محاولة حقن، لا لتشغيلها.
# shellcheck disable=SC2016
malicious_url='https://api.example.com/$(id)'
assert_fails "verify يقبل URL قابلاً لحقن أمر" \
  ./deploy/verify-deployment.sh --api-url "$malicious_url" \
    --admin-url https://admin.example.com
assert_fails "verify يقبل حد throttle بلا تفعيل الاختبار المتعمد" \
  ./deploy/verify-deployment.sh --auth-throttle-limit 6 \
    --api-url https://api.example.com --admin-url https://admin.example.com
assert_fails "verify يقبل حد throttle صفراً" \
  ./deploy/verify-deployment.sh --check-rate-limit --auth-throttle-limit 0 \
    --api-url https://api.example.com --admin-url https://admin.example.com
assert_fails "verify يقبل revision قصيرة" \
  ./deploy/verify-deployment.sh --expected-revision 1234567 \
    --api-url https://api.example.com --admin-url https://admin.example.com

if grep -Fq "TAG=\"\${TAG:-latest}\"" deploy/deploy.sh; then
  fail "عاد default latest"
fi

# نبحث عن النص الحرفي لا عن متغير هذا السكربت.
# shellcheck disable=SC2016
grep -Fq 'if [[ "$candidate" =~ ^sha-[0-9a-f]{40}$ ]]; then' deploy/deploy.sh || \
  fail "TAG المبني على commit لا يتطلب SHA كاملاً"
# نبحث عن وسيطة التحقق الحرفية في deploy.sh.
# shellcheck disable=SC2016
grep -Fq -- '--certificate-github-workflow-sha "$EXPECTED_SOURCE_SHA"' deploy/deploy.sh || \
  fail "cosign لا يربط التوقيع بـcommit المصدر"
grep -Fq 'org.opencontainers.image.revision' deploy/deploy.sh || \
  fail "النشر لا يربط TAG بـrevision الموقّع داخل الصورة"
if grep -Fq 'REPO_OWNER:-' deploy/deploy.sh; then
  fail "جذر ثقة GHCR/Cosign قابل للتبديل من البيئة"
fi

if grep -Eq '^[[:space:]]*(eval|source|\.)[[:space:]]' deploy/*.sh; then
  fail "وجد eval/source في سكربتات النشر"
fi

if grep -Ev '^[[:space:]]*#' deploy/verify-deployment.sh | grep -Eq 'bash[[:space:]]+-c'; then
  fail "verify-deployment يعيد تقييم المدخلات عبر bash -c"
fi
grep -Fq "CURL_COMMON=(-q --noproxy '*' --proto" deploy/verify-deployment.sh || \
  fail "curl قد يقرأ curlrc أو proxy موروثاً"
if grep -Ev '^[[:space:]]*#' deploy/verify-deployment.sh | grep -Eq 'curl[[:space:]]+-'; then
  fail "استدعاء curl يضع خياراً قبل -q"
fi

backup_line="$(grep -n 'BACKUP_PATH=.*backup-db\.sh' deploy/deploy.sh | cut -d: -f1)"
migrate_line="$(grep -n -- '--exit-code-from migrate' deploy/deploy.sh | cut -d: -f1)"
[ -n "$(grep -n 'validate-db-target.py' deploy/deploy.sh | cut -d: -f1)" ] || \
  fail "النشر لا يتحقق من تطابق هدف migration مع backup"
[ -n "$backup_line" ] && [ -n "$migrate_line" ] || fail "تعذّر إثبات ترتيب backup/migrate"
[ "$backup_line" -lt "$migrate_line" ] || fail "الهجرة تسبق النسخة الاحتياطية"
# نصوص حرفية مقصودة؛ لا نوسع متغيرات سكربت الاختبار.
# shellcheck disable=SC2016
snapshot_line="$(grep -n 'snapshot_environment "\$ENV_SOURCE_FILE"' deploy/deploy.sh | cut -d: -f1)"
db_validation_line="$(grep -n 'validate-db-target.py' deploy/deploy.sh | tail -1 | cut -d: -f1)"
[ -n "$snapshot_line" ] && [ "$snapshot_line" -lt "$db_validation_line" ] || \
  fail "فحص DB لا يستخدم snapshot ثابتة من ملف البيئة"

grep -Fq "\"\$ADMIN_DIGEST\"" deploy/deploy.sh || fail "سجل النشر لا يحوي admin digest"
grep -Fq 'handle_post_deploy_failure "فشل فحص صحة db/api/admin"' deploy/deploy.sh || \
  fail "لا توجد عودة على فشل صحة الخدمات"
# shellcheck disable=SC2016
grep -Fq -- '--api-url "$API_URL"' deploy/deploy.sh || \
  fail "التحقق الخارجي لا يقتبس API_URL"
# shellcheck disable=SC2016
grep -Fq -- '--admin-url "$ADMIN_URL"' deploy/deploy.sh || \
  fail "التحقق الخارجي لا يقتبس ADMIN_URL"

grep -Fq '127.0.0.1:5432:5432' docker-compose.yml || \
  fail "منفذ PostgreSQL التطويري ليس محصوراً في loopback"
grep -Fq '127.0.0.1:3000:3000' docker-compose.yml || \
  fail "منفذ API التطويري ليس محصوراً في loopback"

if grep -Eq '^(API_IMAGE|ADMIN_IMAGE)=.*:latest$' .env.prod.example .env.stage.example; then
  fail "ملف بيئة منشورة ما زال يهيئ صورة latest ملتبسة"
fi
grep -Fq 'configured_service_digest api' deploy/compose.sh || \
  fail "compose اليدوي لا يثبت صورة api العاملة على digest"
grep -Fq 'configured_service_digest admin' deploy/compose.sh || \
  fail "compose اليدوي لا يثبت صورة admin العاملة على digest"
# نبحث عن نصوص حرفية ولا نريد توسعة متغيرات compose.sh هنا.
# shellcheck disable=SC2016
grep -Fq 'local_image_revision "$API_IMAGE"' deploy/compose.sh || \
  fail "compose اليدوي لا يشتق APP_REVISION من صورة api المثبتة"
# shellcheck disable=SC2016
grep -Fq '[ "$API_REVISION" = "$ADMIN_REVISION" ]' deploy/compose.sh || \
  fail "compose اليدوي لا يرفض صورتين من commitين مختلفين"
for compose_caller in deploy/deploy.sh deploy/compose.sh; do
  # نبحث عن النصوص الحرفية، ولا نريد توسعة متغيرات سكربت الاختبار.
  # shellcheck disable=SC2016
  grep -Fq -- '-p "$PROJECT_NAME"' "$compose_caller" || \
    fail "$compose_caller لا يثبت Compose project المتوقع"
  # shellcheck disable=SC2016
  grep -Fq 'COMPOSE_*) unset "$inherited_variable"' "$compose_caller" || \
    fail "$compose_caller يسمح لمتغير COMPOSE_* موروث بتغيير الدلالة"
  grep -Fq 'unset POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB NEXT_PUBLIC_API_URL API_IMAGE ADMIN_IMAGE' \
    "$compose_caller" || \
    fail "$compose_caller يسمح لمتغير استيفاء حساس موروث بتجاوز env file"
done
# shellcheck disable=SC2016
grep -Fq 'APP_REVISION: ${APP_REVISION:?APP_REVISION مطلوب}' docker-compose.prod.yml || \
  fail "Compose لا يمرر revision الموثقة إلى الخدمات"
# shellcheck disable=SC2016
grep -Fq 'verify_external_deployment "$EXPECTED_SOURCE_SHA"' deploy/deploy.sh || \
  fail "التحقق الخارجي لا يثبت source SHA المنشورة"

[ "$(grep -c 'no-new-privileges:true' docker-compose.prod.yml)" -ge 4 ] || \
  fail "no-new-privileges غير مطبق على خدمات الإنتاج"
[ "$(grep -c 'cap_drop: \[ALL\]' docker-compose.prod.yml)" -ge 3 ] || \
  fail "cap_drop غير مطبق على خدمات التطبيق"
[ "$(grep -c 'max-size:' docker-compose.prod.yml)" -ge 4 ] || \
  fail "تدوير السجل غير مطبق على خدمات الإنتاج"
grep -Fq 'no-new-privileges:true' deploy/docker-compose.edge.yml || \
  fail "حافة Caddy بلا no-new-privileges"

printf 'deployment safety static tests: PASS\n'
