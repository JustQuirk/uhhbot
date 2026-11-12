import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export interface GuildSettings {
  guildId: string;
  prefix: string;
  serverChangesEnabled: boolean;
  staffRoleId: string | null;
  ticketCategoryId: string | null;
  nextTicketNumber: number;
}

interface PingRule {
  id: number;
  guildId: string;
  triggerText: string;
  roleId: string;
  channelId: string;
  cooldownMinutes: number;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

interface Store {
  guildSettings: GuildSettings[];
  pingRules: PingRule[];
  nextPingRuleId: number;
}

const storePath = resolve(
  process.env.DATA_DIR?.trim() || "data",
  "bot-data.json",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadStore(): Store {
  if (!existsSync(storePath)) {
    return { guildSettings: [], pingRules: [], nextPingRuleId: 1 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(storePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Could not read bot data at ${storePath}.`, {
      cause: error,
    });
  }

  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.guildSettings) ||
    !Array.isArray(parsed.pingRules) ||
    typeof parsed.nextPingRuleId !== "number"
  ) {
    throw new Error(
      `Bot data at ${storePath} has an invalid format; refusing to overwrite it.`,
    );
  }

  return parsed as unknown as Store;
}

let store = loadStore();

function saveStore() {
  mkdirSync(dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(store, null, 2), "utf8");
  renameSync(temporaryPath, storePath);
}

function findGuildSettings(guildId: string) {
  return store.guildSettings.find((settings) => settings.guildId === guildId);
}

export async function getGuildSettings(guildId: string) {
  let settings = findGuildSettings(guildId);
  if (!settings) {
    settings = {
      guildId,
      prefix: "?",
      serverChangesEnabled: false,
      staffRoleId: null,
      ticketCategoryId: null,
      nextTicketNumber: 1,
    };
    store.guildSettings.push(settings);
    saveStore();
  }

  return { ...settings };
}

export async function updateGuildSettings(
  guildId: string,
  values: Partial<
    Pick<
      GuildSettings,
      "prefix" | "serverChangesEnabled" | "staffRoleId" | "ticketCategoryId"
    >
  >,
) {
  let settings = findGuildSettings(guildId);
  if (!settings) {
    await getGuildSettings(guildId);
    settings = findGuildSettings(guildId);
  }
  if (!settings) {
    throw new Error("Could not load Discord server settings.");
  }

  Object.assign(settings, values);
  saveStore();
  return { ...settings };
}

export async function addPingRule(input: {
  guildId: string;
  triggerText: string;
  roleId: string;
  channelId: string;
  cooldownMinutes: number;
}) {
  const rule: PingRule = {
    ...input,
    id: store.nextPingRuleId++,
    enabled: true,
    lastTriggeredAt: null,
    createdAt: new Date().toISOString(),
  };
  store.pingRules.push(rule);
  saveStore();
  return { ...rule };
}

export async function listPingRules(guildId: string) {
  return store.pingRules
    .filter((rule) => rule.guildId === guildId)
    .sort((a, b) => a.id - b.id)
    .map((rule) => ({ ...rule }));
}

export async function removePingRule(guildId: string, ruleId: number) {
  const index = store.pingRules.findIndex(
    (rule) => rule.guildId === guildId && rule.id === ruleId,
  );
  if (index < 0) {
    return false;
  }

  store.pingRules.splice(index, 1);
  saveStore();
  return true;
}

export async function claimPingRule(
  rule: { id: number; cooldownMinutes: number },
  now = new Date(),
) {
  const storedRule = store.pingRules.find((candidate) => candidate.id === rule.id);
  if (!storedRule || !storedRule.enabled) {
    return false;
  }

  const lastTriggeredAt = storedRule.lastTriggeredAt
    ? Date.parse(storedRule.lastTriggeredAt)
    : Number.NaN;
  const cutoff = now.getTime() - rule.cooldownMinutes * 60 * 1000;
  if (Number.isFinite(lastTriggeredAt) && lastTriggeredAt >= cutoff) {
    return false;
  }

  storedRule.lastTriggeredAt = now.toISOString();
  saveStore();
  return true;
}

export async function allocateTicketNumber(guildId: string) {
  const settings = await getGuildSettings(guildId);
  const storedSettings = findGuildSettings(guildId);
  if (!storedSettings) {
    throw new Error("Could not reserve a ticket number.");
  }

  storedSettings.nextTicketNumber = settings.nextTicketNumber + 1;
  saveStore();
  return settings.nextTicketNumber;
}
