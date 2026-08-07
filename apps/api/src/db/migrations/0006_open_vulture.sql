-- ‏NOT NULL بلا افتراضي يسقط على جدول فيه صفوف — والإنتاج فيه جلسات حيّة.
-- فالخطوات ثلاث: عمود يقبل الفراغ، ثم تعبئة، ثم تشديد.

ALTER TABLE "refresh_tokens" ADD COLUMN "issued_role" text;--> statement-breakpoint

-- العائلات القائمة صدرت بدور صاحبها الحالي — وهو ما نريد مقارنته لاحقاً.
UPDATE "refresh_tokens" rt
SET "issued_role" = u."role"
FROM "users" u
WHERE u."id" = rt."user_id" AND rt."issued_role" IS NULL;--> statement-breakpoint

ALTER TABLE "refresh_tokens" ALTER COLUMN "issued_role" SET NOT NULL;
