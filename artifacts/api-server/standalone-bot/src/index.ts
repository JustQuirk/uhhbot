import { logger } from "./lib/logger";
import { startDiscordBot } from "./discord/bot";

try {
  await startDiscordBot();
} catch (error) {
  logger.fatal({ err: error }, "Discord bot failed to start");
  process.exitCode = 1;
}
