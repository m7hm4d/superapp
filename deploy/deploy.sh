#!/usr/bin/env bash
#
# نشر إصدار موقّع ومحدد بلا التباس على الخادم الحالي.
#
#   ./deploy/deploy.sh sha-0123456789abcdef0123456789abcdef01234567
#   ./deploy/deploy.sh --env .env.stage --api-url https://api-stage.4irq.com \
#     --admin-url https://stage.4irq.com sha-0123456789abcdef0123456789abcdef01234567
#
# لا توجد قيمة افتراضية، ولا تُقبل أي وسوم سوى sha-<40-hex> من main.
# الصور تُسحب بالوسم، ثم يُتحقق من توقيع digest بعينه ويعمل Compose بذلك
# الـdigest نفسه. قبل الهجرة تؤخذ نسخة PostgreSQL محمية؛ وإذا كانت حاوية
# القاعدة السابقة متوقفة تُشغّل كما هي أولاً. عند فشل صحة النسخة الجديدة
# تعود صور التطبيق السابقة فقط؛
# هجرات قاعدة البيانات إلى الأمام ولا يعكسها هذا السكربت تلقائياً.
#
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
الاستعمال:
  deploy.sh [--env FILE] [--expected-stack NAME] \
    [--api-url HTTPS_ORIGIN --admin-url HTTPS_ORIGIN] SHA_TAG
  deploy.sh [--env FILE] [--expected-stack NAME] \
    [--api-url HTTPS_ORIGIN --admin-url HTTPS_ORIGIN] --tag SHA_TAG

SHA_TAG يجب أن يكون sha-<git-sha الكامل>. لا تقبل وسوم الإصدارات أو latest.
تمرير عنواني HTTPS اختياري، لكن يجب تمريرهما معاً لتشغيل الفحص الخارجي.
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

set_release_tag() {
  local candidate="$1"
  [ -z "$TAG" ] || die "وُجد أكثر من TAG؛ حدّد إصداراً واحداً فقط"
  TAG="$candidate"
}

validate_release_tag() {
  local candidate="$1"

  if [[ "$candidate" =~ ^sha-[0-9a-f]{40}$ ]]; then
    return 0
  fi

  die "TAG غير ثابت أو غير صالح: $candidate (استعمل sha-<git-sha الكامل> فقط)"
}

validate_https_origin() {
  local option="$1"
  local value="$2"

  # أصل HTTPS فقط: بلا userinfo أو مسار أو query أو fragment. إضافة المسارات
  # المطلوبة تتم داخل verify-deployment.sh ولا يعاد تقييم النص كأمر shell.
  [[ "$value" =~ ^https://([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:[0-9]{1,5})?$ ]] || \
    die "$option يجب أن يكون أصل HTTPS مثل https://api.example.com بلا مسار"
}

ENV_FILE=".env.prod"
TAG=""
API_URL=""
ADMIN_URL=""
EXPECTED_STACK=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env)
      ENV_FILE="$(require_value "$1" "${2-}")"
      shift 2
      ;;
    --tag)
      set_release_tag "$(require_value "$1" "${2-}")"
      shift 2
      ;;
    --expected-stack)
      [ -z "$EXPECTED_STACK" ] || die "--expected-stack مكرر"
      EXPECTED_STACK="$(require_value "$1" "${2-}")"
      shift 2
      ;;
    --api-url)
      [ -z "$API_URL" ] || die "--api-url مكرر"
      API_URL="$(require_value "$1" "${2-}")"
      shift 2
      ;;
    --admin-url)
      [ -z "$ADMIN_URL" ] || die "--admin-url مكرر"
      ADMIN_URL="$(require_value "$1" "${2-}")"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while [ "$#" -gt 0 ]; do
        set_release_tag "$1"
        shift
      done
      ;;
    -*)
      die "خيار غير معروف: $1"
      ;;
    *)
      set_release_tag "$1"
      shift
      ;;
  esac
done

[ -n "$TAG" ] || die "TAG مطلوب؛ لا يُنشر latest افتراضياً"
validate_release_tag "$TAG"
if [ -n "$EXPECTED_STACK" ]; then
  [[ "$EXPECTED_STACK" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || \
    die "--expected-stack غير صالح"
fi

if [ -n "$API_URL" ] || [ -n "$ADMIN_URL" ]; then
  if [ -z "$API_URL" ] || [ -z "$ADMIN_URL" ]; then
    die "يجب تمرير --api-url و--admin-url معاً"
  fi
  validate_https_origin "--api-url" "$API_URL"
  validate_https_origin "--admin-url" "$ADMIN_URL"
fi

# هاتان القيمتان root of trust وليستا إعداد بيئة. السماح بوراثتهما يتيح
# توجيه السحب والهوية معاً إلى مستودع مهاجم موقّع توقيعاً صحيحاً له.
REPO_OWNER="m7hm4d"
REPO_NAME="superapp"

REGISTRY="ghcr.io/${REPO_OWNER}"
API_REPOSITORY="${REGISTRY}/superapp-api"
ADMIN_REPOSITORY="${REGISTRY}/superapp-admin"
API_TAGGED_IMAGE="${API_REPOSITORY}:${TAG}"
ADMIN_TAGGED_IMAGE="${ADMIN_REPOSITORY}:${TAG}"

# الإنتاج يقبل artifact بناه publish.yml من main فقط. وسوم Git release قد
# تشير إلى digest نفسه للعرض، لكنها لا تدخل مسار النشر ولا تعيد بناء الصورة.
EXPECTED_SOURCE_SHA="${TAG#sha-}"
SIGNER_IDENTITY="https://github.com/${REPO_OWNER}/${REPO_NAME}/.github/workflows/publish.yml@refs/heads/main"
OIDC_ISSUER="https://token.actions.githubusercontent.com"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# عند تشغيل bundle إصدار منفصل، تبقى الأقفال والنسخ والسجل في مجلد ثابت
# يحدده المشغّل. الافتراضي يحافظ على سلوك التشغيل من checkout المعتاد.
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-${REPO_ROOT}/.deploy}"
[[ "$DEPLOY_STATE_DIR" = /* ]] || die "DEPLOY_STATE_DIR يجب أن يكون مساراً مطلقاً"
[[ "$DEPLOY_STATE_DIR" != *$'\n'* && "$DEPLOY_STATE_DIR" != *$'\r'* ]] || \
  die "DEPLOY_STATE_DIR يحوي محرف سطر غير صالح"
case "/${DEPLOY_STATE_DIR#/}/" in
  */../*|*/./*) die "DEPLOY_STATE_DIR لا يقبل مقاطع . أو .." ;;
esac
case "$DEPLOY_STATE_DIR" in
  /*/.deploy) ;;
  *) die "DEPLOY_STATE_DIR يجب أن ينتهي بمجلد .deploy مخصص" ;;
esac
[ ! -L "$DEPLOY_STATE_DIR" ] || die "DEPLOY_STATE_DIR لا يقبل symlink"
export DEPLOY_STATE_DIR

for required_command in awk docker cosign flock id install mktemp python3 sha256sum stat; do
  command -v "$required_command" >/dev/null 2>&1 || die "$required_command غير مثبَّت"
done
[ "$(id -u)" -ne 0 ] || die "لا تشغّل النشر كمستخدم root"
if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  die "$ENV_FILE يجب أن يكون ملفاً عادياً لا symlink"
fi
ENV_OWNER="$(stat -c '%u' "$ENV_FILE")" || die "تعذّرت قراءة مالك $ENV_FILE"
ENV_MODE="$(stat -c '%a' "$ENV_FILE")" || die "تعذّرت قراءة صلاحيات $ENV_FILE"
[[ "$ENV_OWNER" =~ ^[0-9]+$ && "$ENV_MODE" =~ ^[0-7]{3,4}$ ]] || \
  die "تعذّر التحقق من مالك/صلاحيات $ENV_FILE"
[ "$ENV_OWNER" = "$(id -u)" ] || die "$ENV_FILE ليس مملوكاً لمستخدم النشر"
(( (8#$ENV_MODE & 077) == 0 )) || die "$ENV_FILE مكشوف للمجموعة أو الآخرين؛ استعمل chmod 600"

mkdir -p "$DEPLOY_STATE_DIR"
DEPLOY_STATE_DIR="$(cd "$DEPLOY_STATE_DIR" && pwd -P)"
case "$DEPLOY_STATE_DIR" in
  /*/.deploy) ;;
  *) die "المسار الحقيقي لـDEPLOY_STATE_DIR ليس مجلد .deploy مخصصاً" ;;
esac
export DEPLOY_STATE_DIR
STATE_OWNER="$(stat -c '%u' "$DEPLOY_STATE_DIR")" || die "تعذّرت قراءة مالك DEPLOY_STATE_DIR"
[ "$STATE_OWNER" = "$(id -u)" ] || die "DEPLOY_STATE_DIR ليس مملوكاً لمستخدم النشر"
chmod 700 "$DEPLOY_STATE_DIR"

# نستخدم snapshot واحدة 0600 طوال النسخ وCompose والهجرة. نقارن metadata
# والـhash قبل/بعد النسخ كي يفشل النشر إذا تغير الملف الحي أثناء الالتقاط.
ENV_SOURCE_FILE="$ENV_FILE"
ENV_SNAPSHOT_FILE=""
ENV_SNAPSHOT_SHA=""
snapshot_environment() {
  local source="$1"
  local before after source_hash_before source_hash_after snapshot_hash snapshot

  before="$(stat -c '%d:%i:%s:%Y:%Z:%u:%a' "$source")" || die "تعذّرت قراءة metadata ملف البيئة"
  source_hash_before="$(sha256sum "$source" | awk '{print $1}')" || die "تعذّر حساب hash ملف البيئة"
  [[ "$source_hash_before" =~ ^[0-9a-f]{64}$ ]] || die "hash ملف البيئة غير صالح"
  snapshot="$(mktemp "${DEPLOY_STATE_DIR}/.env-${EXPECTED_SOURCE_SHA}.XXXXXXXX")"
  ENV_SNAPSHOT_FILE="$snapshot"
  install -m 600 -- "$source" "$snapshot"
  snapshot_hash="$(sha256sum "$snapshot" | awk '{print $1}')" || die "تعذّر حساب hash snapshot البيئة"
  source_hash_after="$(sha256sum "$source" | awk '{print $1}')" || die "تعذّر إعادة حساب hash ملف البيئة"
  after="$(stat -c '%d:%i:%s:%Y:%Z:%u:%a' "$source")" || die "تعذّرت إعادة قراءة metadata ملف البيئة"

  if [ ! -f "$source" ] || [ -L "$source" ]; then
    die "تغيّر نوع ملف البيئة أثناء snapshot"
  fi
  [ "$before" = "$after" ] || die "تغيّر ملف البيئة أثناء snapshot؛ أعد النشر"
  if [ "$source_hash_before" != "$snapshot_hash" ] || \
    [ "$snapshot_hash" != "$source_hash_after" ]; then
    die "تغيّر محتوى ملف البيئة أثناء snapshot؛ أعد النشر"
  fi

  ENV_SNAPSHOT_SHA="$snapshot_hash"
}

cleanup_environment_snapshot() {
  if [ -n "$ENV_SNAPSHOT_FILE" ]; then
    rm -f -- "$ENV_SNAPSHOT_FILE"
  fi
}
trap cleanup_environment_snapshot EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
snapshot_environment "$ENV_SOURCE_FILE"
ENV_FILE="$ENV_SNAPSHOT_FILE"

read_stack_name() {
  local file="$1"
  local line value="" count=0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      STACK_NAME=*)
        value="${line#STACK_NAME=}"
        count=$((count + 1))
        ;;
    esac
  done < "$file"

  [ "$count" -eq 1 ] || die "يجب أن يحتوي $file على STACK_NAME واحد فقط"
  [[ "$value" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || die "STACK_NAME غير صالح في $file"
  printf '%s' "$value"
}

STACK_NAME="$(read_stack_name "$ENV_FILE")"
[ -z "$EXPECTED_STACK" ] || [ "$STACK_NAME" = "$EXPECTED_STACK" ] || \
  die "STACK_NAME=$STACK_NAME لا يطابق --expected-stack=$EXPECTED_STACK"
PROJECT_NAME="superapp-${STACK_NAME}"
EDGE_NETWORK="superapp-edge-${STACK_NAME}"
HEALTH_TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-180}"
[[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[1-9][0-9]{0,3}$ ]] || \
  die "DEPLOY_HEALTH_TIMEOUT_SECONDS يجب أن يكون عدداً من 1 إلى 9999"

# بيئة shell تتغلب على قيم --env-file وtop-level name في Compose. نمسح كل
# COMPOSE_* الموروثة ومتغيرات الاستيفاء الحساسة، ثم نعيد فقط القيم التي
# استخرجها السكربت أو تحقق منها. وإلا يستطيع shell سابق تغيير project/volume
# أو كلمة مرور PostgreSQL رغم تمرير --env-file صحيح.
while IFS= read -r inherited_variable; do
  case "$inherited_variable" in
    COMPOSE_*) unset "$inherited_variable" ;;
  esac
done < <(compgen -A export)
unset POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB NEXT_PUBLIC_API_URL API_IMAGE ADMIN_IMAGE APP_REVISION
APP_REVISION="$EXPECTED_SOURCE_SHA"
export STACK_NAME ENV_FILE APP_REVISION

lock_file="${DEPLOY_STATE_DIR}/${STACK_NAME}.deploy.lock"
if [ -e "$lock_file" ] || [ -L "$lock_file" ]; then
  if [ ! -f "$lock_file" ] || [ -L "$lock_file" ]; then
    die "ملف lock غير آمن"
  fi
fi
exec 9> "$lock_file"
chmod 600 "$lock_file"
flock -n 9 || die "يوجد نشر آخر قيد التنفيذ للحزمة ${STACK_NAME}"

docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1 || {
  printf 'شبكة %s غير موجودة. أنشئها مرة واحدة:\n' "$EDGE_NETWORK" >&2
  printf '  docker network create %s\n' "$EDGE_NETWORK" >&2
  die "أعد تشغيل حزمة الحافة كي ينضم Caddy إلى الشبكة"
}

compose() {
  docker compose \
    -p "$PROJECT_NAME" \
    -f docker-compose.prod.yml \
    --env-file "$ENV_FILE" \
    "$@"
}

# Compose هو المصدر الفعلي لقيم env_file والاستيفاء. نفحص JSON الناتج قبل أي
# إنشاء/تشغيل/نسخ لقاعدة البيانات كي لا نأخذ نسخة من db المحلية ثم نهاجر
# DATABASE_URL تشير إلى مضيف أو قاعدة أخرى.
compose config --format json | python3 "$SCRIPT_DIR/validate-db-target.py"

is_repository_digest() {
  local reference="$1"
  local repository="$2"
  local prefix="${repository}@sha256:"
  local hash

  case "$reference" in
    "$prefix"*)
      hash="${reference#"$prefix"}"
      [[ "$hash" =~ ^[0-9a-f]{64}$ ]]
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_local_repository_digest() {
  local image_reference="$1"
  local repository="$2"
  local repo_digests candidate selected=""

  repo_digests="$(
    docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image_reference"
  )" || die "تعذّر فحص digests للصورة $image_reference"

  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if is_repository_digest "$candidate" "$repository"; then
      if [ -n "$selected" ] && [ "$selected" != "$candidate" ]; then
        die "وجد أكثر من digest للصورة $image_reference في $repository"
      fi
      selected="$candidate"
    fi
  done <<< "$repo_digests"

  [ -n "$selected" ] || die "لم أجد digest موثوقاً للصورة $image_reference في $repository"
  printf '%s' "$selected"
}

image_source_revision() {
  local digest="$1"
  local revision

  revision="$(
    docker image inspect \
      --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
      "$digest"
  )" || die "تعذّرت قراءة revision من الصورة $digest"
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || \
    die "الصورة $digest بلا org.opencontainers.image.revision صالح"
  printf '%s' "$revision"
}

find_running_service_container() {
  local service="$1"
  local container_output container_id
  local ids=()

  container_output="$(
    docker ps \
      --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
      --filter "label=com.docker.compose.service=${service}" \
      --format '{{.ID}}'
  )" || die "تعذّر تحديد حاوية ${service} للحزمة ${STACK_NAME}"

  while IFS= read -r container_id; do
    [ -n "$container_id" ] && ids+=("$container_id")
  done <<< "$container_output"

  [ "${#ids[@]}" -le 1 ] || die "وجدت أكثر من حاوية ${service} عاملة؛ لا يمكن نشر عودة حتمية"
  if [ "${#ids[@]}" -eq 1 ]; then
    printf '%s' "${ids[0]}"
  fi
  return 0
}

find_service_container_any_state() {
  local service="$1"
  local container_output container_id
  local ids=()

  container_output="$(
    docker ps -a \
      --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
      --filter "label=com.docker.compose.service=${service}" \
      --format '{{.ID}}'
  )" || die "تعذّر تحديد حاوية ${service} للحزمة ${STACK_NAME}"

  while IFS= read -r container_id; do
    [ -n "$container_id" ] && ids+=("$container_id")
  done <<< "$container_output"

  [ "${#ids[@]}" -le 1 ] || die "وجدت أكثر من حاوية ${service}؛ يلزم فحص يدوي"
  if [ "${#ids[@]}" -eq 1 ]; then
    printf '%s' "${ids[0]}"
  fi
}

running_service_digest() {
  local service="$1"
  local repository="$2"
  local container_id configured_reference image_id

  container_id="$(find_running_service_container "$service")"
  [ -n "$container_id" ] || return 0

  configured_reference="$(docker inspect --format '{{.Config.Image}}' "$container_id")" || \
    die "تعذّر قراءة صورة الحاوية ${service}"
  if is_repository_digest "$configured_reference" "$repository"; then
    printf '%s' "$configured_reference"
    return 0
  fi

  # نشر قديم ربما شُغّل بوسم. نربط image ID الفعلي بـRepoDigest بدلاً من
  # إعادة حل الوسم المتحرك، وإلا قد تعني العودة صورة لم تكن هي العاملة.
  image_id="$(docker inspect --format '{{.Image}}' "$container_id")" || \
    die "تعذّر قراءة image ID للحاوية ${service}"
  resolve_local_repository_digest "$image_id" "$repository"
}

PREVIOUS_API_DIGEST="$(running_service_digest api "$API_REPOSITORY")"
PREVIOUS_ADMIN_DIGEST="$(running_service_digest admin "$ADMIN_REPOSITORY")"
PREVIOUS_SOURCE_SHA=""
ROLLBACK_AVAILABLE=false

if [ -n "$PREVIOUS_API_DIGEST" ] && [ -n "$PREVIOUS_ADMIN_DIGEST" ]; then
  PREVIOUS_API_SOURCE_SHA="$(image_source_revision "$PREVIOUS_API_DIGEST")"
  PREVIOUS_ADMIN_SOURCE_SHA="$(image_source_revision "$PREVIOUS_ADMIN_DIGEST")"
  [ "$PREVIOUS_API_SOURCE_SHA" = "$PREVIOUS_ADMIN_SOURCE_SHA" ] || \
    die "الإصدار السابق يجمع صورتين من commitين مختلفين؛ أصلح الحالة يدوياً"
  PREVIOUS_SOURCE_SHA="$PREVIOUS_API_SOURCE_SHA"
  for previous_digest in "$PREVIOUS_API_DIGEST" "$PREVIOUS_ADMIN_DIGEST"; do
    cosign verify \
      --certificate-identity "$SIGNER_IDENTITY" \
      --certificate-oidc-issuer "$OIDC_ISSUER" \
      --certificate-github-workflow-sha "$PREVIOUS_SOURCE_SHA" \
      "$previous_digest" >/dev/null 2>&1 || \
      die "الإصدار السابق غير موثوق للعودة الآلية؛ يلزم bootstrap يدوي"
  done
  ROLLBACK_AVAILABLE=true
  printf '==> [%s] الإصدار السابق الموثوق المحفوظ للعودة (%s)\n' \
    "$STACK_NAME" "$PREVIOUS_SOURCE_SHA"
  printf '    api:   %s\n' "$PREVIOUS_API_DIGEST"
  printf '    admin: %s\n' "$PREVIOUS_ADMIN_DIGEST"
elif [ -n "$PREVIOUS_API_DIGEST" ] || [ -n "$PREVIOUS_ADMIN_DIGEST" ]; then
  die "الإصدار السابق غير مكتمل؛ أصلح زوج api/admin قبل نشر جديد"
else
  printf '==> [%s] لا يوجد إصدار تطبيق سابق عامل (نشر أول)\n' "$STACK_NAME"
fi

service_container_id() {
  local service="$1"
  local container_output container_id
  local ids=()

  container_output="$(compose ps -a -q "$service")" || return 1
  while IFS= read -r container_id; do
    [ -n "$container_id" ] && ids+=("$container_id")
  done <<< "$container_output"
  [ "${#ids[@]}" -eq 1 ] || return 1
  printf '%s' "${ids[0]}"
}

wait_for_services_healthy() {
  local timeout="$1"
  shift
  local deadline=$((SECONDS + timeout))
  local service container_id state health all_healthy

  printf '==> انتظار الصحة (حد أقصى %s ثانية): %s\n' "$timeout" "$*"
  while :; do
    all_healthy=true
    for service in "$@"; do
      container_id="$(service_container_id "$service")" || {
        all_healthy=false
        continue
      }
      state="$(docker inspect --format '{{.State.Status}}' "$container_id")" || return 1
      health="$(
        docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id"
      )" || return 1

      if [ "$state" != "running" ]; then
        printf 'الخدمة %s ليست عاملة (state=%s).\n' "$service" "$state" >&2
        return 1
      fi
      case "$health" in
        healthy)
          ;;
        starting)
          all_healthy=false
          ;;
        unhealthy)
          printf 'الخدمة %s غير سليمة.\n' "$service" >&2
          return 1
          ;;
        *)
          printf 'الخدمة %s بلا healthcheck قابل للقياس.\n' "$service" >&2
          return 1
          ;;
      esac
    done

    if $all_healthy; then
      printf '    كل الخدمات سليمة: %s\n' "$*"
      return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      printf 'انتهت مهلة انتظار الصحة للخدمات: %s\n' "$*" >&2
      return 1
    fi
    sleep 5
  done
}

wait_for_container_healthy() {
  local container_id="$1"
  local label="$2"
  local timeout="$3"
  local deadline=$((SECONDS + timeout))
  local state health

  printf '==> انتظار صحة الحاوية السابقة %s (حد أقصى %s ثانية)\n' "$label" "$timeout"
  while :; do
    state="$(docker inspect --format '{{.State.Status}}' "$container_id")" || return 1
    health="$(
      docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id"
    )" || return 1

    if [ "$state" != "running" ]; then
      printf 'الحاوية السابقة %s ليست عاملة (state=%s).\n' "$label" "$state" >&2
      return 1
    fi
    case "$health" in
      healthy)
        return 0
        ;;
      starting)
        ;;
      unhealthy)
        printf 'الحاوية السابقة %s غير سليمة.\n' "$label" >&2
        return 1
        ;;
      *)
        printf 'الحاوية السابقة %s بلا healthcheck قابل للقياس.\n' "$label" >&2
        return 1
        ;;
    esac

    [ "$SECONDS" -lt "$deadline" ] || {
      printf 'انتهت مهلة صحة الحاوية السابقة %s.\n' "$label" >&2
      return 1
    }
    sleep 5
  done
}

db_volume_exists() {
  local expected_name="${PROJECT_NAME}_dbdata"
  local volume_output volume_name

  if docker volume inspect "$expected_name" >/dev/null 2>&1; then
    return 0
  fi
  volume_output="$(
    docker volume ls \
      --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
      --filter 'label=com.docker.compose.volume=dbdata' \
      --format '{{.Name}}'
  )" || die "تعذّر فحص volume قاعدة البيانات"
  while IFS= read -r volume_name; do
    [ -n "$volume_name" ] && return 0
  done <<< "$volume_output"
  return 1
}

migration_completed_successfully() {
  local container_id state exit_code
  container_id="$(service_container_id migrate)" || return 1
  state="$(docker inspect --format '{{.State.Status}}' "$container_id")" || return 1
  exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$container_id")" || return 1
  [ "$state" = "exited" ] && [ "$exit_code" = "0" ]
}

verify_external_deployment() {
  local revision="$1"
  local attempt

  for attempt in 1 2 3; do
    if "$SCRIPT_DIR/verify-deployment.sh" \
        --api-url "$API_URL" \
        --admin-url "$ADMIN_URL" \
        --expected-revision "$revision"; then
      return 0
    fi
    if [ "$attempt" -lt 3 ]; then
      printf 'فشل التحقق الخارجي المؤقت (%s/3)؛ إعادة المحاولة بعد 10 ثوانٍ.\n' \
        "$attempt" >&2
      sleep 10
    fi
  done
  return 1
}

handle_post_deploy_failure() {
  local reason="$1"

  printf '\nفشل النشر بعد تبديل التطبيق: %s\n' "$reason" >&2
  printf 'تحذير: هجرات قاعدة البيانات إلى الأمام فقط ولم تُعكس تلقائياً.\n' >&2
  [ "$BACKUP_PATH" = "-" ] || printf 'نسخة ما قبل النشر: %s\n' "$BACKUP_PATH" >&2

  if $ROLLBACK_AVAILABLE; then
    printf '==> إعادة صورتي التطبيق السابقتين بالـdigest (من دون تشغيل migrate)\n' >&2
    export API_IMAGE="$PREVIOUS_API_DIGEST"
    export ADMIN_IMAGE="$PREVIOUS_ADMIN_DIGEST"
    export APP_REVISION="$PREVIOUS_SOURCE_SHA"

    if compose up -d --no-deps --force-recreate api admin; then
      if wait_for_services_healthy "$HEALTH_TIMEOUT_SECONDS" db api admin; then
        if [ -n "$API_URL" ] && ! verify_external_deployment "$PREVIOUS_SOURCE_SHA"; then
          printf 'صحة الحاويات السابقة نجحت لكن مسار HTTPS لم يثبت عودتها؛ يلزم تدخل يدوي.\n' >&2
        else
          printf 'اكتملت عودة التطبيق وثبت مسارها، لكن الأمر سيبقى فاشلاً كي لا يُسجّل النشر كنجاح.\n' >&2
        fi
      else
        printf 'فشلت صحة الإصدار السابق أيضاً؛ يلزم تدخل يدوي.\n' >&2
      fi
    else
      printf 'تعذّر إعادة إنشاء حاويات الإصدار السابق؛ يلزم تدخل يدوي.\n' >&2
    fi
  else
    printf 'لا يوجد إصدار سابق موثوق؛ إيقاف api/admin الفاشلين كي لا يخدما الطلبات.\n' >&2
    compose stop api admin >/dev/null 2>&1 || \
      printf 'تعذّر إيقاف الحاويات الفاشلة؛ يلزم تدخل يدوي فوري.\n' >&2
  fi
}

DB_CONTAINER="$(find_service_container_any_state db)"
EXISTING_DB_CONTAINER=false
if [ -n "$DB_CONTAINER" ]; then
  EXISTING_DB_CONTAINER=true
  DB_STATE="$(docker inspect --format '{{.State.Status}}' "$DB_CONTAINER")" || \
    die "تعذّرت قراءة حالة حاوية قاعدة البيانات السابقة"
  case "$DB_STATE" in
    running)
      ;;
    created|exited)
      printf '==> تشغيل حاوية قاعدة البيانات السابقة كما هي لأخذ النسخة\n'
      docker start "$DB_CONTAINER" >/dev/null
      ;;
    *)
      die "حالة حاوية قاعدة البيانات السابقة غير آمنة للنسخ: $DB_STATE"
      ;;
  esac
  wait_for_container_healthy "$DB_CONTAINER" db "$HEALTH_TIMEOUT_SECONDS"
else
  # وجود volume بلا حاوية يعني أن البيانات قديمة أو أن metadata التشغيل
  # فُقدت. لا نسمح للـCompose الجديد أن يكون أول من يلمسها بلا نسخة.
  if db_volume_exists; then
    die "وجد volume لقاعدة البيانات بلا حاوية سابقة؛ خذ نسخة/استعادة يدوية قبل النشر"
  fi
  printf '==> أول نشر: إنشاء قاعدة فارغة كي تؤخذ منها نسخة قبل الهجرة\n'
  compose up -d db
  wait_for_services_healthy "$HEALTH_TIMEOUT_SECONDS" db
fi

BACKUP_PATH="$("$SCRIPT_DIR/backup-db.sh" --env "$ENV_FILE" --label "$TAG")"

# النشر الاعتيادي لا يرقي صورة db ولا يعيد إنشاءها. تغيير الصورة أو متغيرات
# bootstrap الثلاثة يحتاج runbook صيانة منفصلاً؛ النسخة تمنع فقد البيانات لكن
# لا تمنع outage لو أزال Compose الحاوية القديمة ثم فشل PostgreSQL الجديد.
if $EXISTING_DB_CONTAINER; then
  CURRENT_DB_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$DB_CONTAINER")" || \
    die "تعذّرت قراءة صورة قاعدة البيانات الحالية"
  TARGET_DB_IMAGE="$(
    compose config --format json | \
      python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["db"]["image"])'
  )" || die "تعذّرت قراءة صورة قاعدة البيانات المطلوبة من Compose"
  [ "$CURRENT_DB_IMAGE" = "$TARGET_DB_IMAGE" ] || \
    die "تغيير صورة قاعدة البيانات محظور في النشر الآلي؛ استخدم runbook صيانة"

  CURRENT_DB_BOOTSTRAP_FINGERPRINT="$(
    docker inspect "$DB_CONTAINER" | python3 -c '
import hashlib, json, sys
env = {}
for item in json.load(sys.stdin)[0]["Config"].get("Env", []):
    key, _, value = item.partition("=")
    env[key] = value
keys = ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB")
selected = {key: env.get(key) for key in keys}
print(hashlib.sha256(json.dumps(selected, sort_keys=True).encode()).hexdigest())
'
  )" || die "تعذّر فحص إعداد bootstrap لقاعدة البيانات الحالية"
  TARGET_DB_BOOTSTRAP_FINGERPRINT="$(
    compose config --format json | python3 -c '
import hashlib, json, sys
env = json.load(sys.stdin)["services"]["db"].get("environment", {})
keys = ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB")
selected = {key: env.get(key) for key in keys}
print(hashlib.sha256(json.dumps(selected, sort_keys=True).encode()).hexdigest())
'
  )" || die "تعذّر فحص إعداد bootstrap المطلوب لقاعدة البيانات"
  [ "$CURRENT_DB_BOOTSTRAP_FINGERPRINT" = "$TARGET_DB_BOOTSTRAP_FINGERPRINT" ] || \
    die "تغيير إعداد bootstrap لقاعدة البيانات محظور في النشر الآلي"
fi

printf '==> إبقاء حاوية قاعدة البيانات الحالية بلا إعادة إنشاء\n'
compose up -d --no-recreate db
wait_for_services_healthy "$HEALTH_TIMEOUT_SECONDS" db

# لا تستهلك الصور مساحة القرص قبل نجاح النسخة المحلية. بعد النسخ فقط نسحب
# artifact ونربطه بالـcommit والتوقيع ثم نسمح للهجرة باستعماله.
printf '==> [%s] سحب الإصدار الثابت %s\n' "$STACK_NAME" "$TAG"
docker pull -q "$API_TAGGED_IMAGE"
docker pull -q "$ADMIN_TAGGED_IMAGE"

API_DIGEST="$(resolve_local_repository_digest "$API_TAGGED_IMAGE" "$API_REPOSITORY")"
ADMIN_DIGEST="$(resolve_local_repository_digest "$ADMIN_TAGGED_IMAGE" "$ADMIN_REPOSITORY")"

API_SOURCE_SHA="$(image_source_revision "$API_DIGEST")"
ADMIN_SOURCE_SHA="$(image_source_revision "$ADMIN_DIGEST")"
[ "$API_SOURCE_SHA" = "$ADMIN_SOURCE_SHA" ] || \
  die "صورتا api/admin لا تنتميان إلى commit واحد"
[ "$API_SOURCE_SHA" = "$EXPECTED_SOURCE_SHA" ] || \
  die "revision الصورة لا يطابق TAG المطلوب"

printf '==> التحقق من توقيعي الصورتين والـcommit المصدر بالـdigest\n'
for digest in "$API_DIGEST" "$ADMIN_DIGEST"; do
  if ! cosign verify \
      --certificate-identity "$SIGNER_IDENTITY" \
      --certificate-oidc-issuer "$OIDC_ISSUER" \
      --certificate-github-workflow-sha "$EXPECTED_SOURCE_SHA" \
      "$digest" >/dev/null 2>&1; then
    die "فشل التحقق من توقيع $digest؛ الصورة لا تُشغَّل"
  fi
  printf '    موقَّعة وموثوقة: %s\n' "$digest"
done

# ما تحققنا منه هو بالضبط ما سيعمل. ENV_FILE مطلوب أيضاً داخل env_file في
# Compose، ولا يُقرأ هنا بالـsource كي لا تنفّذ قيمه كأوامر.
export API_IMAGE="$API_DIGEST"
export ADMIN_IMAGE="$ADMIN_DIGEST"


printf '\nتحذير تشغيلي: هجرات قاعدة البيانات forward-only.\n' >&2
printf 'العودة الآلية تعيد شيفرة api/admin فقط ولا تعيد مخطط PostgreSQL.\n\n' >&2

# تشغيل خدمة الهجرة وحدها في المقدمة يجعل exit code حداً صريحاً. لا تُبدّل
# حاويات api/admin إلا بعد نجاحها المؤكد.
if ! compose up \
    --no-deps \
    --force-recreate \
    --abort-on-container-exit \
    --exit-code-from migrate \
    migrate; then
  printf 'فشلت الهجرة؛ لم تُبدّل صور api/admin.\n' >&2
  [ "$BACKUP_PATH" = "-" ] || printf 'نسخة ما قبل النشر: %s\n' "$BACKUP_PATH" >&2
  exit 1
fi

if ! migration_completed_successfully; then
  printf 'لم تنته خدمة migrate بالحالة exited/0؛ لم تُبدّل صور api/admin.\n' >&2
  exit 1
fi
printf '    migrate انتهت بنجاح (exit 0)\n'

printf '==> تشغيل api/admin بالـdigests المتحقق منها\n'
if ! compose up -d --no-deps --force-recreate api admin; then
  handle_post_deploy_failure "تعذّر إنشاء الحاويات الجديدة"
  exit 1
fi

if ! wait_for_services_healthy "$HEALTH_TIMEOUT_SECONDS" db api admin; then
  handle_post_deploy_failure "فشل فحص صحة db/api/admin"
  exit 1
fi

if [ -n "$API_URL" ]; then
  printf '==> تشغيل التحقق الخارجي عبر HTTPS\n'
  if ! verify_external_deployment "$EXPECTED_SOURCE_SHA"; then
    handle_post_deploy_failure "فشل التحقق الخارجي"
    exit 1
  fi
fi

# لا يُكتب سجل النشرات إلا بعد نجاح الهجرة وكل فحوص الصحة المطلوبة. يحوي
# digest الصورتين، سابقتيهما، ومسار النسخة، كي تكون العودة قابلة للتدقيق.
history_file="${DEPLOY_STATE_DIR}/${STACK_NAME}-history.tsv"
if [ -e "$history_file" ] || [ -L "$history_file" ]; then
  if [ ! -f "$history_file" ] || [ -L "$history_file" ]; then
    die "ملف سجل النشر غير آمن"
  fi
  HISTORY_OWNER="$(stat -c '%u' "$history_file")" || die "تعذّرت قراءة مالك سجل النشر"
  [ "$HISTORY_OWNER" = "$(id -u)" ] || die "سجل النشر ليس مملوكاً لمستخدم النشر"
fi
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$STACK_NAME" \
  "$TAG" \
  "$API_DIGEST" \
  "$ADMIN_DIGEST" \
  "${PREVIOUS_API_DIGEST:--}" \
  "${PREVIOUS_ADMIN_DIGEST:--}" \
  "$BACKUP_PATH" \
  "$ENV_SNAPSHOT_SHA" \
  >> "$history_file"
chmod 600 "$history_file"

printf '\nتم النشر بنجاح [%s]. الصور العاملة:\n' "$STACK_NAME"
printf '  api:   %s\n' "$API_DIGEST"
printf '  admin: %s\n' "$ADMIN_DIGEST"
printf '  backup: %s\n' "$BACKUP_PATH"
printf '\nالنشرات الناجحة الأخيرة (%s):\n' "$STACK_NAME"
tail -3 "$history_file" | awk -F'\t' '{printf "  %s  %s  api=%s  admin=%s\n", $1, $3, $4, $5}'
