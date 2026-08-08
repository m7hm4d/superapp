#!/usr/bin/env bash
#
# غلاف رفيع حول docker compose للحزمة المنشورة.
#
#   ./deploy/compose.sh logs -f api
#   ./deploy/compose.sh --env .env.stage exec -T db psql -U superapp -d superapp
#   ./deploy/compose.sh --env .env.stage run --rm api node ...
#
# سببه أن compose يقرأ المتغيرات من مصدرين مختلفين: `--env-file` يغذّي
# الاستيفاء ‏(${...}) وحده، بينما `env_file:` داخل الخدمة مسار حرفي يُقرأ من
# ENV_FILE. أمرٌ يدوي ينسى تصدير ENV_FILE يقع على `.env.prod` الافتراضي —
# فينشئ `run --rm api` على حزمة التجربة حاويةً **ببيئة الإنتاج**.
#
# هذا الغلاف يضبط الاثنين معاً دائماً، فلا يبقى للنسيان مكان.
#
set -euo pipefail

die() {
  printf 'خطأ: %s\n' "$*" >&2
  exit 1
}

ENV_FILE=".env.prod"
if [ "${1:-}" = "--env" ]; then
  ENV_FILE="${2:?--env يحتاج مساراً}"
  shift 2
fi

# ‏--env الخاص بالغلاف يُقبل أول وسيطة فقط. لو جاء بعد الأمر بقيمة تشبه ملف
# بيئة فذلك خطأ استعمال يقع صامتاً على .env.prod: يبتلعه خيار --env في
# docker compose كمتغير حاوية ويعمل الأمر على بيئة الإنتاج — عكس غاية الغلاف.
# ‏KEY=VAL وأسماء المتغيرات العادية تمرّ إلى docker compose كما هي.
previous_argument=""
for wrapper_argument in "$@"; do
  env_candidate=""
  if [ "$previous_argument" = "--env" ]; then
    env_candidate="$wrapper_argument"
  fi
  case "$wrapper_argument" in
    --env=*) env_candidate="${wrapper_argument#--env=}" ;;
  esac
  if [ -n "$env_candidate" ]; then
    case "$env_candidate" in
      *=*) ;;
      .* | /* | *.env | *.env.* | env.*)
        die "خيار الغلاف --env يجب أن يكون أول وسيطة: compose.sh --env ${env_candidate} <الأمر> ..."
        ;;
    esac
  fi
  previous_argument="$wrapper_argument"
done

cd "$(dirname "$0")/.."
for required_command in docker id stat; do
  command -v "$required_command" >/dev/null 2>&1 || die "$required_command غير مثبَّت"
done
[ "$(id -u)" -ne 0 ] || die "لا تشغّل Compose كمستخدم root"
if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  die "$ENV_FILE يجب أن يكون ملفاً عادياً لا symlink"
fi
ENV_OWNER="$(stat -c '%u' "$ENV_FILE")" || die "تعذّرت قراءة مالك $ENV_FILE"
ENV_MODE="$(stat -c '%a' "$ENV_FILE")" || die "تعذّرت قراءة صلاحيات $ENV_FILE"
[[ "$ENV_OWNER" =~ ^[0-9]+$ && "$ENV_MODE" =~ ^[0-7]{3,4}$ ]] || \
  die "تعذّر التحقق من مالك/صلاحيات $ENV_FILE"
[ "$ENV_OWNER" = "$(id -u)" ] || die "$ENV_FILE ليس مملوكاً للمستخدم الحالي"
(( (8#$ENV_MODE & 077) == 0 )) || die "$ENV_FILE مكشوف للمجموعة أو الآخرين؛ استعمل chmod 600"

read_one_value() {
  local key="$1"
  local file="$2"
  local line value="" count=0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      "${key}="*)
        value="${line#*=}"
        count=$((count + 1))
        ;;
    esac
  done < "$file"

  [ "$count" -eq 1 ] || die "يجب أن يحتوي $file على ${key} واحد فقط"
  printf '%s' "$value"
}

STACK_NAME="$(read_one_value STACK_NAME "$ENV_FILE")"
[[ "$STACK_NAME" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || die "STACK_NAME غير صالح"
PROJECT_NAME="superapp-${STACK_NAME}"
REPO_OWNER="m7hm4d"

# لا تسمح لبيئة shell أن تتغلب على --env-file أو تغيّر Compose project. تُعاد
# ENV_FILE/STACK_NAME وصور التطبيق فقط بعد اشتقاقها أو التحقق منها هنا.
while IFS= read -r inherited_variable; do
  case "$inherited_variable" in
    COMPOSE_*) unset "$inherited_variable" ;;
  esac
done < <(compgen -A export)
unset POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB NEXT_PUBLIC_API_URL API_IMAGE ADMIN_IMAGE APP_REVISION

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

configured_service_digest() {
  local service="$1"
  local repository="$2"
  local container_output container_id configured image_id candidate selected=""
  local ids=()

  # ‏oneoff=False يستبعد حاويات `compose run` العابرة كي لا تكسر واحدة يتيمة
  # شرط «حاوية واحدة بالضبط» فتعطل أوامر الغلاف كلها.
  container_output="$(
    docker ps -a \
      --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
      --filter "label=com.docker.compose.service=${service}" \
      --filter 'label=com.docker.compose.oneoff=False' \
      --format '{{.ID}}'
  )" || die "تعذّر تحديد حاوية ${service}"
  while IFS= read -r container_id; do
    [ -n "$container_id" ] && ids+=("$container_id")
  done <<< "$container_output"
  [ "${#ids[@]}" -le 1 ] || die "وجدت أكثر من حاوية ${service}"

  if [ "${#ids[@]}" -eq 0 ]; then
    configured="$(read_one_value "${service^^}_IMAGE" "$ENV_FILE")"
    is_repository_digest "$configured" "$repository" || \
      die "لا توجد حاوية ${service} و${service^^}_IMAGE ليس digest ثابتاً"
    printf '%s' "$configured"
    return 0
  fi

  configured="$(docker inspect --format '{{.Config.Image}}' "${ids[0]}")" || \
    die "تعذّرت قراءة صورة ${service}"
  if is_repository_digest "$configured" "$repository"; then
    printf '%s' "$configured"
    return 0
  fi

  # انتقال آمن من نشر قديم شُغّل بوسم: نربط image ID الفعلي لا الوسم الحالي.
  image_id="$(docker inspect --format '{{.Image}}' "${ids[0]}")" || \
    die "تعذّرت قراءة image ID لـ${service}"
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if is_repository_digest "$candidate" "$repository"; then
      [ -z "$selected" ] || [ "$selected" = "$candidate" ] || \
        die "أكثر من digest للصورة العاملة لخدمة ${service}"
      selected="$candidate"
    fi
  done < <(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image_id")
  [ -n "$selected" ] || die "تعذّر تثبيت digest الصورة العاملة لخدمة ${service}"
  printf '%s' "$selected"
}

API_IMAGE="$(configured_service_digest api "ghcr.io/${REPO_OWNER}/superapp-api")"
ADMIN_IMAGE="$(configured_service_digest admin "ghcr.io/${REPO_OWNER}/superapp-admin")"

local_image_revision() {
  local digest="$1"
  local revision

  docker image inspect "$digest" >/dev/null 2>&1 || return 0
  revision="$(
    docker image inspect \
      --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
      "$digest"
  )" || die "تعذّرت قراءة revision من الصورة $digest"
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || \
    die "الصورة المحلية $digest بلا org.opencontainers.image.revision صالح"
  printf '%s' "$revision"
}

API_REVISION="$(local_image_revision "$API_IMAGE")"
ADMIN_REVISION="$(local_image_revision "$ADMIN_IMAGE")"
if [ -n "$API_REVISION" ] || [ -n "$ADMIN_REVISION" ]; then
  if [ -z "$API_REVISION" ] || [ -z "$ADMIN_REVISION" ]; then
    die "لا يمكن إثبات revision لصورتَي api/admin معاً؛ استعمل deploy/deploy.sh"
  fi
  [ "$API_REVISION" = "$ADMIN_REVISION" ] || \
    die "صورتا api/admin المحليتان تنتميان إلى commitين مختلفين"
  APP_REVISION="$API_REVISION"
else
  # القيم الصفرية في ملفات example تسمح بأوامر config/logs قبل أول نشر فقط.
  # digest حقيقي غير موجود محلياً لا نسحبه هنا: deploy.sh وحده يتحقق من
  # التوقيع والـrevision قبل التشغيل.
  zero_digest='sha256:0000000000000000000000000000000000000000000000000000000000000000'
  if [ "$API_IMAGE" != "ghcr.io/${REPO_OWNER}/superapp-api@${zero_digest}" ] || \
    [ "$ADMIN_IMAGE" != "ghcr.io/${REPO_OWNER}/superapp-admin@${zero_digest}" ]; then
    die "الصور غير موجودة محلياً؛ استعمل deploy/deploy.sh للسحب والتحقق"
  fi
  APP_REVISION="$(read_one_value APP_REVISION "$ENV_FILE")"
  [[ "$APP_REVISION" =~ ^[0-9a-f]{40}$ ]] || die "APP_REVISION غير صالح"
fi

export ENV_FILE STACK_NAME API_IMAGE ADMIN_IMAGE APP_REVISION
exec docker compose \
  -p "$PROJECT_NAME" \
  -f docker-compose.prod.yml \
  --env-file "$ENV_FILE" \
  "$@"
