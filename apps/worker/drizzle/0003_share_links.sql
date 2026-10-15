CREATE TABLE "share_links" (
	"board_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"role" text NOT NULL,
	"expires_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_unique" UNIQUE("token"),
	CONSTRAINT "share_links_role_check" CHECK ("share_links"."role" in ('editor', 'commenter', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;