import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(apiRoot, "src");
const exportDir = join(apiRoot, "standalone-bot");
const discordSource = join(sourceDir, "discord");
const discordExport = join(exportDir, "src", "discord");
const libExport = join(exportDir, "src", "lib");

mkdirSync(discordExport, { recursive: true });
mkdirSync(libExport, { recursive: true });

for (const file of [
  "bot.ts",
  "commands.ts",
  "constants.ts",
  "handlers.ts",
  "youtube-subscriber-count.ts",
]) {
  copyFileSync(join(discordSource, file), join(discordExport, file));
}

const ticketSource = readFileSync(join(discordSource, "tickets.ts"), "utf8");
const dbTypeImport = 'import type { discordGuildSettings } from "@workspace/db";';
const dbTypeAlias =
  "type GuildSettings = typeof discordGuildSettings.$inferSelect;";
if (!ticketSource.includes(dbTypeImport) || !ticketSource.includes(dbTypeAlias)) {
  throw new Error("The Discord ticket module changed; update its standalone export transformation.");
}
writeFileSync(
  join(discordExport, "tickets.ts"),
  ticketSource
    .replace(dbTypeImport, 'import type { GuildSettings } from "./storage";')
    .replace(dbTypeAlias, ""),
);

const botPath = join(discordExport, "bot.ts");
const botSource = readFileSync(botPath, "utf8");
writeFileSync(
  botPath,
  botSource.replace(
    "Add it in Replit Secrets.",
    "Set it in the hosting provider's environment variables.",
  ),
);

console.log(`Standalone Discord bot refreshed at ${exportDir}`);
