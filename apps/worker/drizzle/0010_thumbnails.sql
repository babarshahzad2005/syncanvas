CREATE TABLE "kv_writes" (
	"day" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "template" text;