import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

// Better Auth tables, from Better Auth's Drizzle schema generator (core + magic link).
// Regenerate if auth plugins change; keep column names snake_case.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
)

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
)

// ---------- Boards and access (GLOSSARY: Board, Member, Role; ADR 0001) ----------

export const boards = pgTable(
  "boards",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled board"),
    thumbnailKey: text("thumbnail_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [index("boards_owner_idx").on(table.ownerId)],
)

/** A User's saved Role on a Board. The Owner also has a row, with role "owner". */
export const memberships = pgTable(
  "memberships",
  {
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "commenter", "viewer"] }).notNull(),
    via: text("via", { enum: ["owner", "invitation", "share_link"] }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.userId] }),
    index("memberships_user_idx").on(table.userId),
    check(
      "memberships_role_check",
      sql`${table.role} in ('owner', 'editor', 'commenter', 'viewer')`,
    ),
  ],
)

// ---------- Sharing (M3; PRD A4, GLOSSARY: Invitation) ----------

/**
 * A pending Invitation for an email that has no User yet. It becomes a Membership on that
 * address's first sign-in, and is deleted then (or when cancelled). One per Board and email.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    /** Always lowercased. */
    email: text("email").notNull(),
    role: text("role", { enum: ["editor", "commenter", "viewer"] }).notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    lastSentAt: timestamp("last_sent_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("invitations_board_email_idx").on(table.boardId, table.email),
    index("invitations_email_idx").on(table.email),
    check("invitations_role_check", sql`${table.role} in ('editor', 'commenter', 'viewer')`),
  ],
)

/** One row per invitation or "shared with you" email sent, for the daily limits. */
export const invitationEmails = pgTable(
  "invitation_emails",
  {
    id: text("id").primaryKey(),
    senderId: text("sender_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (table) => [
    index("invitation_emails_sent_idx").on(table.sentAt),
    index("invitation_emails_sender_idx").on(table.senderId, table.sentAt),
  ],
)
