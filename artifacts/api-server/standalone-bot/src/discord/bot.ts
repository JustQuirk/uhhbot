import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";
import { logger } from "../lib/logger";
import { slashCommands } from "./commands";
import {
  handleInteraction,
  handleMessage,
  logInteractionError,
} from "./handlers";
import { startSubscriberCountUpdater } from "./youtube-subscriber-count";

export async function startDiscordBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    throw new Error(
      "DISCORD_BOT_TOKEN is required to start the Discord bot. Set it in the hosting provider's environment variables.",
    );
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(
      { username: readyClient.user.username },
      "Discord bot connected",
    );
    void readyClient.application.commands
      .set(slashCommands.map((command) => command.toJSON()))
      .then(() => logger.info("Discord slash commands registered"))
      .catch((error: unknown) => {
        logger.error({ err: error }, "Could not register Discord slash commands");
      });
    startSubscriberCountUpdater(readyClient);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(client, interaction).catch(async (error: unknown) => {
      logInteractionError(error, {
        guildId: interaction.guildId,
        commandName:
          interaction.isChatInputCommand()
            ? interaction.commandName
            : undefined,
        customId:
          "customId" in interaction ? interaction.customId : undefined,
      });

      if (!interaction.isRepliable()) {
        return;
      }

      const response =
        "The bot could not complete that action. Check its channel permissions and try again.";
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: response });
        } else {
          await interaction.reply({
            content: response,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (replyError) {
        logger.warn(
          { err: replyError },
          "Could not send the Discord interaction error response",
        );
      }
    });
  });

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(client, message).catch((error: unknown) => {
      logger.error(
        {
          err: error,
          guildId: message.guildId,
          channelId: message.channelId,
          authorId: message.author.id,
        },
        "Discord message handling failed",
      );
    });
  });

  client.on(Events.Error, (error) => {
    logger.error({ err: error }, "Discord client error");
  });

  await client.login(token);
  return client;
}
