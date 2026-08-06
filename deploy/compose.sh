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

ENV_FILE=".env.prod"
if [ "${1:-}" = "--env" ]; then
  ENV_FILE="${2:?--env يحتاج مساراً}"
  shift 2
fi

cd "$(dirname "$0")/.."
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE غير موجود" >&2; exit 1; }

STACK_NAME="$(grep -E '^STACK_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[ -n "$STACK_NAME" ] || { echo "STACK_NAME غير مضبوط في $ENV_FILE" >&2; exit 1; }

export ENV_FILE STACK_NAME
exec docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"
