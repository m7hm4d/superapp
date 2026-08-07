CREATE TABLE "pin_attempts" (
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"last_actor_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pin_attempts_target_type_target_id_pk" PRIMARY KEY("target_type","target_id")
);
--> statement-breakpoint
CREATE INDEX "pin_attempts_locked_idx" ON "pin_attempts" USING btree ("locked_until");