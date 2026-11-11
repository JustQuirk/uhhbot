import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const discordGuildSettings = pgTable("discord_guild_settings", {
  guildId: varchar("guild_id", { length: 24 }).primaryKey(),
  prefix: varchar("prefix", { length: 5 }).notNull().default("?"),
  serverChangesEnabled: boolean("server_changes_enabled")
    .notNull()
    .default(false),
  staffRoleId: varchar("staff_role_id", { length: 24 }),
  ticketCategoryId: varchar("ticket_category_id", { length: 24 }),
  nextTicketNumber: integer("next_ticket_number").notNull().default(1),
});

export const discordPingRules = pgTable(
  "discord_ping_rules",
  {
    id: serial("id").primaryKey(),
    guildId: varchar("guild_id", { length: 24 }).notNull(),
    triggerText: varchar("trigger_text", { length: 100 }).notNull(),
    roleId: varchar("role_id", { length: 24 }).notNull(),
    channelId: varchar("channel_id", { length: 24 }).notNull(),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(15),
    enabled: boolean("enabled").notNull().default(true),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("discord_ping_rules_guild_idx").on(table.guildId)],
);
