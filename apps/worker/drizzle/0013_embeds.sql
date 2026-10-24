CREATE TABLE "embeds" (
	"board_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "embeds_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "embeds" ADD CONSTRAINT "embeds_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeds" ADD CONSTRAINT "embeds_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;