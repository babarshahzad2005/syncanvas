CREATE TABLE "invitation_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"sender_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" in ('editor', 'commenter', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "invitation_emails" ADD CONSTRAINT "invitation_emails_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_emails_sent_idx" ON "invitation_emails" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "invitation_emails_sender_idx" ON "invitation_emails" USING btree ("sender_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_board_email_idx" ON "invitations" USING btree ("board_id","email");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");