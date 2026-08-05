#!/usr/bin/env bash
# فتح تطبيق على محاكي iOS موصولاً بخادم Metro الصحيح — دائماً.
# الاستخدام:  ./scripts/sim.sh customer | vendor | driver
# (شغّل خوادم Metro أولاً: pnpm dev:customer / dev:vendor / dev:driver)
set -euo pipefail

APP="${1:-}"
case "$APP" in
  customer) BUNDLE="iq.superapp.customer"; PORT=8081 ;;
  vendor)   BUNDLE="iq.superapp.vendor";   PORT=8082 ;;
  driver)   BUNDLE="iq.superapp.driver";   PORT=8083 ;;
  *) echo "الاستخدام: $0 customer|vendor|driver"; exit 1 ;;
esac

if ! curl -s -m 2 "http://localhost:$PORT/status" >/dev/null; then
  echo "⚠️  خادم Metro غير شغال على المنفذ $PORT — شغّله أولاً:"
  echo "    pnpm dev:$APP"
  exit 1
fi

xcrun simctl terminate booted "$BUNDLE" 2>/dev/null || true
sleep 1
xcrun simctl openurl booted "$BUNDLE://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$PORT"
echo "✅ فُتح $APP موصولاً بالمنفذ $PORT"
