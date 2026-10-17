import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  doublePrecision,
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

/**
 * A Board's Share Link (PRD A4): at most one. Its token is stored as is, so the Owner can copy
 * the link again; changing the Role or regenerating writes a new token, and turning the link
 * off deletes the row. Members who joined through it keep their Memberships.
 */
export const shareLinks = pgTable(
  "share_links",
  {
    boardId: text("board_id")
      .primaryKey()
      .references(() => boards.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    role: text("role", { enum: ["editor", "commenter", "viewer"] }).notNull(),
    /** Null: never expires. */
    expiresAt: timestamp("expires_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check("share_links_role_check", sql`${table.role} in ('editor', 'commenter', 'viewer')`),
  ],
)

// ---------- Comments (M4; GLOSSARY: Thread) ----------

/**
 * A Thread pinned to an Element (its id plus a spot relative to its box, `fx`/`fy` in 0–1) or
 * to a point on the canvas (`x`/`y`). `last_x`/`last_y` remember where a deleted Element's
 * pin was (Detached Threads, M4 ticket 02).
 */
export const threads = pgTable(
  "threads",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    elementId: text("element_id"),
    fx: doublePrecision("fx"),
    fy: doublePrecision("fy"),
    x: doublePrecision("x"),
    y: doublePrecision("y"),
    lastX: doublePrecision("last_x"),
    lastY: doublePrecision("last_y"),
    status: text("status", { enum: ["open", "resolved"] })
      .notNull()
      .default("open"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("threads_board_idx").on(table.boardId),
    check("threads_status_check", sql`${table.status} in ('open', 'resolved')`),
    check(
      "threads_anchor_check",
      sql`(${table.elementId} is not null and ${table.fx} is not null and ${table.fy} is not null) or (${table.x} is not null and ${table.y} is not null)`,
    ),
  ],
)

/** A comment in a Thread. `author_id` is null once its account is deleted (M5). */
export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    editedAt: timestamp("edited_at"),
    /** A first comment deleted after others replied: kept as "Comment deleted" (PRD A5). */
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [index("comments_thread_idx").on(table.threadId, table.createdAt)],
)

/** Who follows a Thread: they posted in it or were mentioned, so replies notify them (PRD A5). */
export const threadParticipants = pgTable(
  "thread_participants",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.userId] })],
)

/** A User was mentioned, or a Thread they follow got a reply (GLOSSARY: Notification). */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["mention", "reply"] }).notNull(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    commentId: text("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    readAt: timestamp("read_at"),
    emailedAt: timestamp("emailed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("notifications_user_idx").on(table.userId, table.createdAt),
    check("notifications_kind_check", sql`${table.kind} in ('mention', 'reply')`),
  ],
)

// ---------- Digest emails (M4 ticket 04) ----------

/** A User's preferences. No row means the defaults (digests on). */
export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  /** When this User's last digest went out: at most one every 3 hours. */
  lastDigestAt: timestamp("last_digest_at"),
})

/** One row per digest email sent, for the daily total (50). */
export const digestEmails = pgTable(
  "digest_emails",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (table) => [index("digest_emails_sent_idx").on(table.sentAt)],
)
