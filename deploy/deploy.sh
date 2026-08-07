#!/usr/bin/env bash
#
# نشر على الخادم: **يتحقق من التوقيع قبل التشغيل**، ثم يسحب ويُقلع.
#
# التوقيع بلا تحقق زينة. هذا السكربت هو الطرف الذي يجعله يعني شيئاً: صورة
# لم تخرج من سير عمل publish.yml في هذا المستودع لا تعمل على هذا الخادم،
# ولو دُفعت إلى الوسم نفسه.
#
#   ./deploy/deploy.sh                          الإنتاج، آخر ما نُشر
#   ./deploy/deploy.sh v1.2.0                   الإنتاج، إصدار بعينه
#   ./deploy/deploy.sh --env .env.stage         التجربة، آخر ما نُشر
#   ./deploy/deploy.sh --env .env.stage v1.1.0  التجربة، إصدار بعينه
#
# العودة إلى إصدار سابق = تشغيل الأمر نفسه بوسم أقدم. لا إعادة بناء ولا
# `git revert` — الصورة موجودة وموقَّعة منذ نُشرت.
#
set -euo pipefail

ENV_FILE=".env.prod"
TAG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_FILE="${2:?--env يحتاج مساراً}"; shift 2 ;;
    -h|--help) sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "خيار غير معروف: $1" >&2; exit 1 ;;
    *) TAG="$1"; shift ;;
  esac
done
TAG="${TAG:-latest}"

REPO_OWNER="${REPO_OWNER:-m7hm4d}"
REPO_NAME="${REPO_NAME:-superapp}"
REGISTRY="ghcr.io/${REPO_OWNER}"

# هوية الموقّع: سير العمل نفسه في هذا المستودع. النمط يقبل main والأوسمة
# معاً — الإصدارات تُنشر من وسم `v*` والنشرات اليومية من `main`، وكلاهما من
# publish.yml. أي مصدر آخر يُرفض.
IDENTITY_RE="^https://github\.com/${REPO_OWNER}/${REPO_NAME}/\.github/workflows/publish\.yml@refs/(heads/main|tags/v.+)$"
OIDC_ISSUER="https://token.actions.githubusercontent.com"

cd "$(dirname "$0")/.."

command -v cosign >/dev/null 2>&1 || {
  echo "cosign غير مثبَّت. التثبيت:" >&2
  echo "  curl -sSLo cosign https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64" >&2
  echo "  sudo install -m 755 cosign /usr/local/bin/cosign && rm cosign" >&2
  exit 1
}

[ -f "$ENV_FILE" ] || { echo "$ENV_FILE غير موجود — انسخه من .env.prod.example" >&2; exit 1; }

# ‏STACK_NAME يفصل الحاويات والأحجام والشبكة الداخلية بين البيئتين
STACK_NAME="$(grep -E '^STACK_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[ -n "$STACK_NAME" ] || { echo "STACK_NAME غير مضبوط في $ENV_FILE" >&2; exit 1; }

EDGE_NETWORK="superapp-edge-${STACK_NAME}"
docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1 || {
  echo "شبكة $EDGE_NETWORK غير موجودة. أنشئها مرة واحدة:" >&2
  echo "  docker network create $EDGE_NETWORK" >&2
  echo "ثم أعد تشغيل حزمة الحافة كي ينضم Caddy إليها." >&2
  exit 1
}

API_IMAGE="${REGISTRY}/superapp-api:${TAG}"
ADMIN_IMAGE="${REGISTRY}/superapp-admin:${TAG}"

echo "==> [${STACK_NAME}] سحب الصور بوسم ${TAG}"
docker pull -q "$API_IMAGE"
docker pull -q "$ADMIN_IMAGE"

# التحقق يجري على الـdigest لا على الوسم: الوسم يتحرك بين السحب والتشغيل
# نظرياً، والتوقيع يخصّ بايتات بعينها.
echo "==> التحقق من التوقيعات"
for image in "$API_IMAGE" "$ADMIN_IMAGE"; do
  digest=$(docker inspect --format '{{index .RepoDigests 0}}' "$image")
  if ! cosign verify \
        --certificate-identity-regexp "$IDENTITY_RE" \
        --certificate-oidc-issuer "$OIDC_ISSUER" \
        "$digest" >/dev/null 2>&1; then
    echo "فشل التحقق من توقيع: $digest" >&2
    echo "الصورة لم تخرج من publish.yml في ${REPO_OWNER}/${REPO_NAME} — لا تُشغَّل." >&2
    exit 1
  fi
  echo "    موقَّعة وموثوقة: $digest"
done

# التشغيل بالـdigest لا بالوسم: ما تحققنا منه هو بالضبط ما يعمل، بلا فجوة
# بين اللحظتين يمكن أن يتغيّر فيها ما يشير إليه الوسم.
API_DIGEST=$(docker inspect --format '{{index .RepoDigests 0}}' "$API_IMAGE")
ADMIN_DIGEST=$(docker inspect --format '{{index .RepoDigests 0}}' "$ADMIN_IMAGE")

export API_IMAGE="$API_DIGEST"
export ADMIN_IMAGE="$ADMIN_DIGEST"
# يقرأه `env_file` في compose — لولاه لأخذت حاويات التجربة بيئة الإنتاج
export ENV_FILE

echo "==> الإقلاع"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d

# سجل النشرات: أي وسم يعمل الآن وما الذي سبقه. بلا هذا السجل تصير العودة
# إلى إصدار سابق تخميناً لرقم.
mkdir -p .deploy
printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STACK_NAME" "$TAG" "$API_DIGEST" \
  >> ".deploy/${STACK_NAME}-history.tsv"

echo
echo "تم [${STACK_NAME}]. الصور العاملة:"
echo "  api:   $API_DIGEST"
echo "  admin: $ADMIN_DIGEST"
echo
echo "النشرات الأخيرة (${STACK_NAME}):"
tail -3 ".deploy/${STACK_NAME}-history.tsv" | awk -F'\t' '{printf "  %s  %s\n", $1, $3}'
