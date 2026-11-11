import {
  db,
  discordGuildSettings,
  discordPingRules,
} from "@workspace/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

export async function getGuildSettings(guildId: string) {
  await db
    .insert(discordGuildSettings)
    .values({ guildId })
    .onConflictDoNothing();

  const [settings] = await db
    .select()
    .from(discordGuildSettings)
    .where(eq(discordGuildSettings.guildId, guildId))
    .limit(1);

  if (!settings) {
    throw new Error("Could not load Discord server settings.");
  }

  return settings;
}

export async function updateGuildSettings(
  guildId: string,
  values: Partial<
    Pick<
      typeof discordGuildSettings.$inferInsert,
      | "prefix"
      | "serverChangesEnabled"
      | "staffRoleId"
      | "ticketCategoryId"
    >
  >,
) {
  await getGuildSettings(guildId);
  const [settings] = await db
    .update(discordGuildSettings)
    .set(values)
    .where(eq(discordGuildSettings.guildId, guildId))
    .returning();

  if (!settings) {
    throw new Error("Could not save Discord server settings.");
  }

  return settings;
}

export async function addPingRule(input: {
  guildId: string;
  triggerText: string;
  roleId: string;
  channelId: string;
  cooldownMinutes: number;
}) {
  const [rule] = await db
    .insert(discordPingRules)
    .values(input)
    .returning();

  if (!rule) {
    throw new Error("Could not save the custom ping.");
  }

  return rule;
}

export async function listPingRules(guildId: string) {
  return db
    .select()
    .from(discordPingRules)
    .where(eq(discordPingRules.guildId, guildId))
    .orderBy(discordPingRules.id);
}

export async function removePingRule(guildId: string, ruleId: number) {
  const [removed] = await db
    .delete(discordPingRules)
    .where(
      and(
        eq(discordPingRules.guildId, guildId),
        eq(discordPingRules.id, ruleId),
      ),
    )
    .returning({ id: discordPingRules.id });

  return Boolean(removed);
}

export async function claimPingRule(
  rule: {
    id: number;
    cooldownMinutes: number;
  },
  now = new Date(),
) {
  const cutoff = new Date(
    now.getTime() - rule.cooldownMinutes * 60 * 1000,
  );
  const [claimed] = await db
    .update(discordPingRules)
    .set({ lastTriggeredAt: now })
    .where(
      and(
        eq(discordPingRules.id, rule.id),
        or(
          isNull(discordPingRules.lastTriggeredAt),
          lt(discordPingRules.lastTriggeredAt, cutoff),
        ),
      ),
    )
    .returning({ id: discordPingRules.id });

  return Boolean(claimed);
}

export async function allocateTicketNumber(guildId: string) {
  await getGuildSettings(guildId);
  const [updated] = await db
    .update(discordGuildSettings)
    .set({
      nextTicketNumber: sql`${discordGuildSettings.nextTicketNumber} + 1`,
    })
    .where(eq(discordGuildSettings.guildId, guildId))
    .returning({ nextTicketNumber: discordGuildSettings.nextTicketNumber });

  if (!updated) {
    throw new Error("Could not reserve a ticket number.");
  }

  return updated.nextTicketNumber - 1;
}
