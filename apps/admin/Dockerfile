# لوحة الإدارة — بناء متعدد المراحل بناتج Next المستقل
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS base
WORKDIR /repo

# ‏pnpm أداة بناء لا أداة تشغيل. الناتج المستقل من Next يحمل تبعياته
# المتتبَّعة معه، فمرحلة التشغيل لا تحتاج مدير حزم — ووراثته كانت تشحن
# شجرة اعتمادياته كاملة إلى الإنتاج.
FROM base AS toolchain
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

FROM toolchain AS build
# متغيرات NEXT_PUBLIC_* تُخبَز في حزمة المتصفح وقت البناء لا وقت التشغيل،
# فتغييرها لاحقاً يستلزم إعادة بناء الصورة.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# ملفات الاعتماديات أولاً لتبقى طبقة التثبيت مخبّأة ما لم يتغيّر القفل
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/config/package.json packages/config/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile \
  --filter @superapp/admin \
  --filter @superapp/shared \
  --filter @superapp/api-client \
  --filter @superapp/i18n \
  --filter @superapp/config

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/api-client packages/api-client
COPY packages/i18n packages/i18n
COPY packages/config packages/config
COPY apps/admin apps/admin
RUN pnpm --filter @superapp/admin build

FROM base AS runtime
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
# الناتج المستقل يحمل تبعياته المتتبَّعة معه — لا تثبيت هنا.
# الأصول الساكنة لا يضمّها Next للناتج المستقل، فتُنسخ يدوياً.
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static

# ‏npm نفسه ليس مطلوباً وقت التشغيل — التطبيق يعمل بـ`node` وحده. وحزم npm
# المضمّنة في صورة الأساس كانت كل ما تبقّى من ثغرات الفحص (‏tar بدرجة
# CRITICAL وbrace-expansion وsigstore وغيرها): شيفرة لا تُنفَّذ إطلاقاً لكنها
# تُحسب في كل تدقيق وتوسّع سطح الهجوم بلا مقابل.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/login >/dev/null || exit 1
CMD ["node", "apps/admin/server.js"]
