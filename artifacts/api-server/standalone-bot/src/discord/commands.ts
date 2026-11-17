import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { PING_DESTINATIONS } from "./constants";

const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configure the community bot")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("help")
      .setDescription("Show the bot setup guide"),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("prefix")
      .setDescription("Configure text commands")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("set")
          .setDescription("Set the text command prefix")
          .addStringOption((option) =>
            option
              .setName("prefix")
              .setDescription("A prefix with no spaces, up to five characters")
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(5),
          ),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("changes")
      .setDescription("Configure and post server changes")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("enabled")
          .setDescription("Turn server-change posts on or off")
          .addBooleanOption((option) =>
            option
              .setName("enabled")
              .setDescription("Whether server-change posts are enabled")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("post")
          .setDescription("Post a server-change announcement")
          .addStringOption((option) =>
            option
              .setName("text")
              .setDescription("What changed on the server")
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(4000),
          ),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("tickets")
      .setDescription("Configure the ticket system")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("publish")
          .setDescription("Post or refresh the ticket dashboard"),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("staff-role")
          .setDescription("Choose the staff role for private tickets")
          .addRoleOption((option) =>
            option
              .setName("role")
              .setDescription("Role that can see and manage tickets")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("category")
          .setDescription("Choose a category for new ticket channels")
          .addChannelOption((option) =>
            option
              .setName("category")
              .setDescription("Discord category for ticket channels")
              .addChannelTypes(ChannelType.GuildCategory)
              .setRequired(true),
          ),
      ),
  );

const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Mention a selected role in this channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption((option) =>
    option
      .setName("ping")
      .setDescription("Which role to mention here")
      .setRequired(true)
      .addChoices(
        ...PING_DESTINATIONS.map(({ name, value }) => ({
          name,
          value,
        })),
      ),
  );

export const slashCommands = [setupCommand, pingCommand];
