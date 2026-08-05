CREATE TYPE "public"."webauthn_purpose" AS ENUM('register', 'login');--> statement-breakpoint
ALTER TYPE "public"."auth_event_method" ADD VALUE 'admin_passkey' BEFORE 'refresh';--> statement-breakpoint
CREATE TABLE "admin_passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "admin_passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"challenge" text PRIMARY KEY NOT NULL,
	"purpose" "webauthn_purpose" NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_passkeys" ADD CONSTRAINT "admin_passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_passkeys_user_idx" ON "admin_passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_expiry_idx" ON "webauthn_challenges" USING btree ("expires_at");