CREATE TABLE "folder_boards" (
	"folder_id" text NOT NULL,
	"board_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "folder_boards_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "folder_boards" ADD CONSTRAINT "folder_boards_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_boards" ADD CONSTRAINT "folder_boards_board_id_user_id_memberships_board_id_user_id_fk" FOREIGN KEY ("board_id","user_id") REFERENCES "public"."memberships"("board_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folder_boards_folder_idx" ON "folder_boards" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "folders_user_idx" ON "folders" USING btree ("user_id");