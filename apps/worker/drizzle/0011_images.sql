CREATE TABLE "images" (
	"key" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"user_id" text,
	"bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "images_board_idx" ON "images" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "images_user_idx" ON "images" USING btree ("user_id");