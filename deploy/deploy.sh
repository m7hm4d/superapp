#!/usr/bin/env bash
#
# نشر على الخادم: **يتحقق من التوقيع قبل التشغيل**، ثم يسحب ويُقلع.
#
# التوقيع بلا تحقق زينة. هذا السكربت هو الطرف الذي يجعله يعني شيئاً: صورة
# لم تخرج من سير عمل publish.yml في هذا المستودع لا تعمل على هذا الخادم،
# ولو دُفعت إلى نفس الوسم.
#
#   ./deploy/deploy.sh                 # آخر ما نُشر (latest)
#   ./deploy/deploy.sh sha-a1b2c3d     # وسم بعينه — للعودة إلى إصدار سابق
#
set -euo pipefail

TAG="${1:-latest}"
REPO_OWNER="${REPO_OWNER:-m7hm4d}"
REPO_NAME="${REPO_NAME:-superapp}"
REGISTRY="ghcr.io/${REPO_OWNER}"

# هوية الموقّع: سير العمل نفسه على الفرع نفسه في هذا المستودع. أي تغيير في
# أيٍّ من الثلاثة يُبطل التحقق — وهو المقصود.
IDENTITY="https://github.com/${REPO_OWNER}/${REPO_NAME}/.github/workflows/publish.yml@refs/heads/main"
OIDC_ISSUER="https://token.actions.githubusercontent.com"

cd "$(dirname "$0")/.."

command -v cosign >/dev/null 2>&1 || {
  echo "cosign غير مثبَّت. التثبيت:" >&2
  echo "  curl -sSLo cosign https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64" >&2
  echo "  sudo install -m 755 cosign /usr/local/bin/cosign && rm cosign" >&2
  exit 1
}

[ -f .env.prod ] || { echo ".env.prod غير موجود — انسخه من .env.prod.example" >&2; exit 1; }

API_IMAGE="${REGISTRY}/superapp-api:${TAG}"
ADMIN_IMAGE="${REGISTRY}/superapp-admin:${TAG}"

echo "==> سحب الصور بوسم ${TAG}"
docker pull -q "$API_IMAGE"
docker pull -q "$ADMIN_IMAGE"

# التحقق يجري على الـdigest لا على الوسم: الوسم يتحرك بين السحب والتشغيل
# نظرياً، والتوقيع يخصّ بايتات بعينها.
echo "==> التحقق من التوقيعات"
for image in "$API_IMAGE" "$ADMIN_IMAGE"; do
  digest=$(docker inspect --format '{{index .RepoDigests 0}}' "$image")
  if ! cosign verify \
        --certificate-identity "$IDENTITY" \
        --certificate-oidc-issuer "$OIDC_ISSUER" \
        "$digest" >/dev/null 2>&1; then
    echo "فشل التحقق من توقيع: $digest" >&2
    echo "الصورة لم تخرج من ${IDENTITY} — لا تُشغَّل." >&2
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

echo "==> الإقلاع"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

echo
echo "تم. الصور العاملة:"
echo "  api:   $API_DIGEST"
echo "  admin: $ADMIN_DIGEST"
