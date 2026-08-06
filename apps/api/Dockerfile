# بناء متعدد المراحل — الناتج صورة تشغيل نحيفة
#
# الأساس مثبَّت على digest لا على وسم: الوسم يتحرك، فبناءان من الشيفرة نفسها
# قد ينتجان صورتين مختلفتين، ولا تعرف أيّهما على الخادم. يحدّثه Dependabot
# بـPR يمرّ على CI كأي تغيير آخر.
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS base
WORKDIR /repo

# ‏pnpm يعيش في مرحلة البناء وحدها. لو ورثته مرحلة التشغيل لشحنّا مدير حزم
# كاملاً بشجرة اعتمادياته إلى الإنتاج — وهو ما كشفه فحص Trivy: ثغرات
# CRITICAL في tar وأخواتها داخل حزم pnpm نفسها، لا في شيفرتنا.
FROM base AS toolchain
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

FROM toolchain AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @superapp/api --filter @superapp/shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @superapp/api build

# ‏deploy لا install --prod: الأخير يفكّ ارتباط حزم التطوير من الشجرة
# المسطّحة لكنه يترك مخزن ‎.pnpm كما هو — 764 مجلد حزمة لا يشير إليها شيء،
# تُشحن إلى الإنتاج وتظهر في كل فحص ثغرات. ‏deploy يبني شجرة مستقلة
# بالاعتماديات الإنتاجية وحدها، بملفات حقيقية بلا مخزن ولا روابط.
RUN CI=true pnpm --filter @superapp/api deploy --prod --legacy /prod

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /prod/node_modules /repo/apps/api/node_modules
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/apps/api/package.json /repo/apps/api/package.json
WORKDIR /repo/apps/api

# ‏npm نفسه ليس مطلوباً وقت التشغيل — التطبيق يعمل بـ`node` وحده. وحزم npm
# المضمّنة في صورة الأساس كانت كل ما تبقّى من ثغرات الفحص (‏tar بدرجة
# CRITICAL وbrace-expansion وsigstore وغيرها): شيفرة لا تُنفَّذ إطلاقاً لكنها
# تُحسب في كل تدقيق وتوسّع سطح الهجوم بلا مقابل.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# الملفات تبقى ملك root **عمداً**، والعملية تعمل بمستخدم غير مميز: من ينفّذ
# شيئاً داخل العملية لا يستطيع إعادة كتابة شيفرتها ولا زرع ما يبقى بعد إعادة
# التشغيل. القراءة والتنفيذ تكفيان — التطبيق لا يكتب على القرص، والسجل إلى
# stdout. لو مُلِّكت الملفات للمستخدم لصار الامتياز الأقل بلا أثر.
#
# ‏node (uid 1000) موجود في صورة node الرسمية، والمنفذ 3000 فوق 1024 فلا
# يحتاج امتيازاً للربط.
USER node

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1
CMD ["node", "dist/apps/api/src/main.js"]
