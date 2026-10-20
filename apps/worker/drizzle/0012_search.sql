CREATE TABLE "board_search" (
	"board_id" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "body")) STORED,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "title_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "title")) STORED;--> statement-breakpoint
ALTER TABLE "board_search" ADD CONSTRAINT "board_search_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_search_tsv_idx" ON "board_search" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "boards_title_tsv_idx" ON "boards" USING gin ("title_tsv");