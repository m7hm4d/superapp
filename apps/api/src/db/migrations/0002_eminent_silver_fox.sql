ALTER TABLE "admin_credentials" ADD COLUMN "pending_totp_secret" text;--> statement-breakpoint
ALTER TABLE "admin_credentials" ADD COLUMN "last_totp_step" bigint;