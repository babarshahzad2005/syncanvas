ALTER TABLE "memberships" ADD COLUMN "last_opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "favorite" boolean DEFAULT false NOT NULL;