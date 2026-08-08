#!/usr/bin/env bash
#
# نسخة PostgreSQL احتياطية قابلة للاستعادة، مأخوذة من حاوية قاعدة البيانات
# العاملة للحزمة المحددة. لا يقرأ السكربت كلمة المرور ولا يطبع بيئة الحاوية.
#
#   ./deploy/backup-db.sh --env .env.prod --label v1.2.3
#
# الناتج custom-format لا SQL نصي: pg_restore يفحص ترويسة الأرشيف وفهرسه قبل
# نقله إلى اسمه النهائي؛ restore drill وحده يثبت قراءة كل البيانات. المجلد
# 0700 والملفات 0600.
#
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
الاستعمال: backup-db.sh [--env FILE] [--label LABEL]

ينشئ نسخة محمية في .deploy/backups/<stack>/ ويطبع مسارها فقط إلى stdout.
يجب أن تكون حاوية PostgreSQL للحزمة عاملة وقابلة للاتصال.
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

ENV_FILE=".env.prod"
LABEL="manual"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env)
      ENV_FILE="$(require_value "$1" "${2-}")"
      shift 2
      ;;
    --label)
      LABEL="$(require_value "$1" "${2-}")"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "خيار غير معروف: $1"
      ;;
  esac
done

[[ "$LABEL" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || \
  die "LABEL غير صالح؛ استعمل حروفاً وأرقاماً والنقطة والشرطة والشرطة السفلية فقط"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

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

for required_command in df docker id sha256sum stat; do
  command -v "$required_command" >/dev/null 2>&1 || die "$required_command غير مثبَّت"
done
[ "$(id -u)" -ne 0 ] || die "لا تشغّل النسخ كمستخدم root"
if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  die "$ENV_FILE يجب أن يكون ملفاً عادياً لا symlink"
fi
ENV_OWNER="$(stat -c '%u' "$ENV_FILE")" || die "تعذّرت قراءة مالك $ENV_FILE"
ENV_MODE="$(stat -c '%a' "$ENV_FILE")" || die "تعذّرت قراءة صلاحيات $ENV_FILE"
[[ "$ENV_OWNER" =~ ^[0-9]+$ && "$ENV_MODE" =~ ^[0-7]{3,4}$ ]] || \
  die "تعذّر التحقق من مالك/صلاحيات $ENV_FILE"
[ "$ENV_OWNER" = "$(id -u)" ] || die "$ENV_FILE ليس مملوكاً لمستخدم النسخ"
(( (8#$ENV_MODE & 077) == 0 )) || die "$ENV_FILE مكشوف للمجموعة أو الآخرين؛ استعمل chmod 600"

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
  [[ "$value" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || \
    die "STACK_NAME غير صالح في $file"
  printf '%s' "$value"
}

STACK_NAME="$(read_stack_name "$ENV_FILE")"
PROJECT_NAME="superapp-${STACK_NAME}"

container_output="$(
  docker ps \
    --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
    --filter 'label=com.docker.compose.service=db' \
    --filter 'label=com.docker.compose.oneoff=False' \
    --format '{{.ID}}'
)" || die "تعذّر تحديد حاوية قاعدة البيانات"

db_ids=()
while IFS= read -r container_id; do
  [ -n "$container_id" ] && db_ids+=("$container_id")
done <<< "$container_output"

[ "${#db_ids[@]}" -gt 0 ] || die "لا توجد حاوية قاعدة بيانات عاملة للحزمة ${STACK_NAME}"
[ "${#db_ids[@]}" -eq 1 ] || die "وجدت أكثر من حاوية قاعدة بيانات عاملة للحزمة ${STACK_NAME}"
DB_CONTAINER="${db_ids[0]}"

mkdir -p "$DEPLOY_STATE_DIR"
DEPLOY_STATE_DIR="$(cd "$DEPLOY_STATE_DIR" && pwd -P)"
case "$DEPLOY_STATE_DIR" in
  /*/.deploy) ;;
  *) die "المسار الحقيقي لـDEPLOY_STATE_DIR ليس مجلد .deploy مخصصاً" ;;
esac

STATE_OWNER="$(stat -c '%u' "$DEPLOY_STATE_DIR")" || die "تعذّرت قراءة مالك DEPLOY_STATE_DIR"
[ "$STATE_OWNER" = "$(id -u)" ] || die "DEPLOY_STATE_DIR ليس مملوكاً لمستخدم النسخ"

BACKUP_DIR="${DEPLOY_STATE_DIR}/backups/${STACK_NAME}"
BACKUPS_ROOT="${DEPLOY_STATE_DIR}/backups"
[ ! -L "$BACKUPS_ROOT" ] || die "مجلد backups لا يقبل symlink"
[ ! -L "$BACKUP_DIR" ] || die "مجلد نسخ الحزمة لا يقبل symlink"
mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd -P)"
[ "$BACKUP_DIR" = "${DEPLOY_STATE_DIR}/backups/${STACK_NAME}" ] || \
  die "المسار الحقيقي لمجلد النسخ خرج من DEPLOY_STATE_DIR"
chmod 700 "$DEPLOY_STATE_DIR" "$BACKUPS_ROOT" "$BACKUP_DIR"

MAX_LOCAL_BACKUPS="${MAX_LOCAL_BACKUPS:-30}"
[[ "$MAX_LOCAL_BACKUPS" =~ ^[1-9][0-9]{0,3}$ ]] || \
  die "MAX_LOCAL_BACKUPS يجب أن يكون عدداً من 1 إلى 9999"

database_bytes="$(
  docker exec "$DB_CONTAINER" sh -eu -c \
    'exec psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT pg_database_size(current_database())"'
)" || die "تعذّر قياس حجم قاعدة البيانات قبل النسخ"
database_bytes="${database_bytes//[[:space:]]/}"
[[ "$database_bytes" =~ ^[0-9]+$ ]] || die "حجم قاعدة البيانات غير صالح"
free_kib="$(df -Pk "$BACKUP_DIR" | awk 'NR == 2 {print $4}')"
[[ "$free_kib" =~ ^[0-9]+$ ]] || die "تعذّر قياس المساحة الحرة"
free_bytes=$((free_kib * 1024))
required_bytes=$((database_bytes * 2 + 536870912))
[ "$free_bytes" -ge "$required_bytes" ] || \
  die "المساحة الحرة لا تكفي لنسخة آمنة مع هامش 512MiB"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$(mktemp "${BACKUP_DIR}/.${timestamp}-${LABEL}.XXXXXX.part")"
checksum_temporary="${temporary}.sha256"

cleanup() {
  rm -f -- "$temporary" "$checksum_temporary"
}
trap cleanup EXIT

printf '==> [%s] إنشاء نسخة PostgreSQL محمية قبل النشر\n' "$STACK_NAME" >&2

# الأمر ثابت وتوسعة POSTGRES_* تحدث داخل الحاوية مع اقتباس القيم. لا تُمرَّر
# كلمة المرور في argv، ولا تُقرأ ملفات البيئة بالـsource.
docker exec "$DB_CONTAINER" sh -eu -c \
  'exec pg_dump --format=custom --no-owner --no-acl --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  > "$temporary"

[ -s "$temporary" ] || die "أنشأ pg_dump ملفاً فارغاً"

# يثبت هذا أن ترويسة الأرشيف وجدول محتوياته قابلان للقراءة فقط. لا يقرأ كل
# data block ولا يعوض restore drill معزولاً، لكنه يرفض ملفاً فارغاً/غير معروف.
docker exec -i "$DB_CONTAINER" pg_restore --list < "$temporary" >/dev/null

checksum="$(sha256sum "$temporary" | awk '{print $1}')"
[[ "$checksum" =~ ^[0-9a-f]{64}$ ]] || die "تعذّر حساب SHA-256 للنسخة"

final_path="${BACKUP_DIR}/${timestamp}-${LABEL}-${checksum:0:12}.dump"
checksum_path="${final_path}.sha256"
[ ! -e "$final_path" ] || die "مسار النسخة موجود مسبقاً: $final_path"

chmod 600 "$temporary"
mv -- "$temporary" "$final_path"
printf '%s  %s\n' "$checksum" "$(basename "$final_path")" > "$checksum_temporary"
chmod 600 "$checksum_temporary"
mv -- "$checksum_temporary" "$checksum_path"

trap - EXIT

# التدوير بعد نجاح نسخة جديدة متحقق منها فقط، فلا تُحذف نسخة قديمة إلا وقد
# وُجد بديل أحدث سليم — ولا يتوقف النشر الآلي عند بلوغ الحد كما كان يحدث
# عند النسخة 31. الأرشفة خارج الخادم واختبار restore يبقيان مسؤولية تشغيلية
# مستقلة لا يعوضهما الاحتفاظ المحلي.
pruned_backups="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' | LC_ALL=C sort | head -n -"$MAX_LOCAL_BACKUPS")"
while IFS= read -r old_backup; do
  [ -n "$old_backup" ] || continue
  printf '    حذف نسخة قديمة فوق الحد %s: %s\n' "$MAX_LOCAL_BACKUPS" "$old_backup" >&2
  rm -f -- "$old_backup" "${old_backup}.sha256"
done <<< "$pruned_backups"

printf '    حُفظت النسخة: %s\n' "$final_path" >&2
printf '%s\n' "$final_path"
