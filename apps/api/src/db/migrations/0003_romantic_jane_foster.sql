CREATE TYPE "public"."auth_event_method" AS ENUM('phone_password', 'admin_password_totp', 'refresh', 'logout', 'admin_action');--> statement-breakpoint
CREATE TYPE "public"."auth_event_outcome" AS ENUM('success', 'invalid_credentials', 'unknown_identifier', 'totp_required', 'totp_invalid', 'totp_replayed', 'enrollment_required', 'enrollment_completed', 'blocked', 'admin_login_denied', 'refresh_reuse', 'logout', 'session_revoked');--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"method" "auth_event_method" NOT NULL,
	"outcome" "auth_event_outcome" NOT NULL,
	"session_family_id" uuid,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_user_idx" ON "auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_events_created_idx" ON "auth_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auth_events_family_idx" ON "auth_events" USING btree ("session_family_id");