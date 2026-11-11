import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger";
import {
  PING_DESTINATIONS,
  SERVER_CHANGES_CHANNEL_ID,
  TICKET_DASHBOARD_CHANNEL_ID,
  TICKET_TYPES,
  type PingDestinationValue,
  type TicketType,
} from "./constants";
import {
  addPingRule,
  claimPingRule,
  getGuildSettings,
  listPingRules,
  removePingRule,
  updateGuildSettings,
} from "./storage";
import {
  createTicketChannel,
  createTicketModal,
  readTicketForm,
} from "./tickets";

const ephemeral = { flags: MessageFlags.Ephemeral } as const;

export async function handleInteraction(
  client: Client,
  interaction: Interaction,
) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "setup") {
      await handleSetupCommand(client, interaction);
      return;
    }

    if (interaction.commandName === "ping") {
      await handlePingCommand(client, interaction);
      return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("ticket:")) {
      await handleTicketButton(client, interaction);
      return;
    }
    if (interaction.customId.startsWith("ticket-grant:")) {
      await handleGrantAccessButton(interaction);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket-form:")) {
    await handleTicketForm(client, interaction);
  }
}

async function handleSetupCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
) {
  if (!interaction.guild) {
    await interaction.reply({
      ...ephemeral,
      content: "Use setup inside your Discord server.",
    });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      ...ephemeral,
      content: "Only server managers can change bot settings.",
    });
    return;
  }

  const guildId = interaction.guild.id;
  const group = interaction.options.getSubcommandGroup(false);
  const action = interaction.options.getSubcommand();

  if (action === "help" && !group) {
    await interaction.reply({
      ...ephemeral,
      content: [
        "**Bot setup**",
        "`/setup prefix set` — choose the text-command prefix.",
        "`/setup pings add` — set a phrase, role, destination, and cooldown.",
        "`/setup pings list` / `/setup pings remove` — manage ping rules.",
        "`/setup changes enabled` — turn change announcements on or off.",
        "`/setup changes post` — post a change announcement.",
        "`/setup tickets staff-role` — choose who can see and manage tickets.",
        "`/setup tickets category` — choose where ticket channels are created.",
        "`/setup tickets publish` — post the ticket dashboard.",
        "`/ping` — post a selected community ping (Manage Messages required).",
        "Prefix commands: `<prefix>help` and `<prefix>ping`.",
      ].join("\n"),
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!group && action === "set") {
    const prefix = interaction.options.getString("prefix", true).trim();
    if (!/^\S{1,5}$/.test(prefix)) {
      await interaction.reply({
        ...ephemeral,
        content: "Choose a prefix with 1–5 characters and no spaces.",
      });
      return;
    }
    await updateGuildSettings(guildId, { prefix });
    await interaction.reply({
      ...ephemeral,
      content: `Text command prefix set to \`${prefix}\`.`,
    });
    return;
  }

  if (group === "prefix") {
    const prefix = interaction.options.getString("prefix", true).trim();
    if (!/^\S{1,5}$/.test(prefix)) {
      await interaction.reply({
        ...ephemeral,
        content: "Choose a prefix with 1–5 characters and no spaces.",
      });
      return;
    }
    await updateGuildSettings(guildId, { prefix });
    await interaction.reply({
      ...ephemeral,
      content: `Text command prefix set to \`${prefix}\`.`,
    });
    return;
  }

  if (group === "pings") {
    if (action === "add") {
      const triggerText = interaction.options.getString("trigger", true).trim();
      const role = interaction.options.getRole("role", true);
      const channel = interaction.options.getChannel("channel", true);
      const cooldownMinutes = interaction.options.getInteger(
        "cooldown-minutes",
        true,
      );
      if (channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement) {
        await interaction.reply({
          ...ephemeral,
          content: "Choose a text or announcement channel in this server.",
        });
        return;
      }

      const rule = await addPingRule({
        guildId,
        triggerText,
        roleId: role.id,
        channelId: channel.id,
        cooldownMinutes,
      });
      await interaction.reply({
        ...ephemeral,
        content: `Custom ping #${rule.id} added. Messages containing “${triggerText}” will ping <@&${role.id}> in <#${channel.id}> no more than once every ${cooldownMinutes} minutes.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === "list") {
      const rules = await listPingRules(guildId);
      const description = rules.length
        ? rules
            .map(
              (rule) =>
                `#${rule.id} · “${rule.triggerText}” → <@&${rule.roleId}> in <#${rule.channelId}> · ${rule.cooldownMinutes} min`,
            )
            .join("\n")
        : "No custom ping rules yet. Use `/setup pings add` to create one.";
      await interaction.reply({
        ...ephemeral,
        content: description.slice(0, 1900),
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === "remove") {
      const ruleId = interaction.options.getInteger("rule-id", true);
      const removed = await removePingRule(guildId, ruleId);
      await interaction.reply({
        ...ephemeral,
        content: removed
          ? `Custom ping #${ruleId} removed.`
          : `No custom ping rule #${ruleId} was found in this server.`,
      });
      return;
    }
  }

  if (group === "changes") {
    if (action === "enabled") {
      const enabled = interaction.options.getBoolean("enabled", true);
      await updateGuildSettings(guildId, {
        serverChangesEnabled: enabled,
      });
      await interaction.reply({
        ...ephemeral,
        content: `Server-change announcements are now ${enabled ? "on" : "off"}.`,
      });
      return;
    }

    if (action === "post") {
      const settings = await getGuildSettings(guildId);
      if (!settings.serverChangesEnabled) {
        await interaction.reply({
          ...ephemeral,
          content: "Server-change announcements are off. Turn them on with `/setup changes enabled` first.",
        });
        return;
      }
      const text = interaction.options.getString("text", true).trim();
      if (!text) {
        await interaction.reply({
          ...ephemeral,
          content: "Add the change details before posting.",
        });
        return;
      }

      const channel = await client.channels.fetch(SERVER_CHANGES_CHANNEL_ID);
      if (!channel?.isTextBased() || !("send" in channel)) {
        throw new Error(
          `The configured server-changes channel ${SERVER_CHANGES_CHANNEL_ID} is not accessible.`,
        );
      }
      await channel.send({
        content: "@here",
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("New Server Changes!")
            .setDescription(text)
            .setTimestamp(),
        ],
        allowedMentions: { parse: ["everyone"] },
      });
      await interaction.reply({
        ...ephemeral,
        content: "Server changes posted.",
      });
      return;
    }
  }

  if (group === "tickets") {
    if (action === "publish") {
      const channel = await client.channels.fetch(
        TICKET_DASHBOARD_CHANNEL_ID,
      );
      if (!channel?.isTextBased() || !("send" in channel)) {
        throw new Error(
          `The configured ticket dashboard channel ${TICKET_DASHBOARD_CHANNEL_ID} is not accessible.`,
        );
      }

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("Easygoing · Ticket Dashboard")
            .setDescription(
              "Choose the option that best fits your message. Some inquiries are private until staff is ready to give you channel access.",
            ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("ticket:collaboration")
              .setLabel("Collaboration Inquiry")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId("ticket:partnership")
              .setLabel("Discord Partnership")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId("ticket:issue")
              .setLabel("Issues")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("ticket:other")
              .setLabel("Other")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
      await interaction.reply({
        ...ephemeral,
        content: `Ticket dashboard posted in <#${TICKET_DASHBOARD_CHANNEL_ID}>.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === "staff-role") {
      const role = interaction.options.getRole("role", true);
      await updateGuildSettings(guildId, { staffRoleId: role.id });
      await interaction.reply({
        ...ephemeral,
        content: `${role} can now see and manage private tickets.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === "category") {
      const category = interaction.options.getChannel("category", true);
      if (category.type !== ChannelType.GuildCategory) {
        await interaction.reply({
          ...ephemeral,
          content: "Choose a category from this server.",
        });
        return;
      }
      await updateGuildSettings(guildId, {
        ticketCategoryId: category.id,
      });
      await interaction.reply({
        ...ephemeral,
        content: `New ticket channels will be created in ${category.name}.`,
      });
      return;
    }
  }

  await interaction.reply({
    ...ephemeral,
    content: "That setup action is not available. Use `/setup help`.",
  });
}

async function handlePingCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
) {
  if (!interaction.guild) {
    await interaction.reply({
      ...ephemeral,
      content: "Use this command inside your Discord server.",
    });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      ...ephemeral,
      content: "You need Manage Messages permission to use this ping.",
    });
    return;
  }

  const destinationValue = interaction.options.getString("ping", true);
  const destination = PING_DESTINATIONS.find(
    (entry) => entry.value === destinationValue,
  );
  if (!destination) {
    throw new Error("Unknown ping destination selected.");
  }
  const text = sanitizePingText(
    interaction.options.getString("message", true).trim(),
  );
  await postPing(client, destination.value, text);
  await interaction.reply({
    ...ephemeral,
    content: `Ping posted in <#${destination.channelId}>.`,
    allowedMentions: { parse: [] },
  });
}

async function postPing(
  client: Client,
  destinationValue: PingDestinationValue,
  text: string,
) {
  const destination = PING_DESTINATIONS.find(
    (entry) => entry.value === destinationValue,
  );
  if (!destination) {
    throw new Error("Unknown ping destination selected.");
  }

  const channel = await client.channels.fetch(destination.channelId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error(
      `The configured ping channel ${destination.channelId} is not accessible.`,
    );
  }

  await channel.send({
    content: `@here **${destination.name} ping**\n${text}`,
    allowedMentions: { parse: ["everyone"] },
  });
}

function sanitizePingText(text: string) {
  return text
    .replace(/@everyone/gi, "@ everyone")
    .replace(/@here/gi, "@ here")
    .trim();
}

async function handleTicketButton(
  client: Client,
  interaction: ButtonInteraction,
) {
  const type = interaction.customId.slice("ticket:".length) as TicketType;
  if (!TICKET_TYPES[type]) {
    await interaction.reply({
      ...ephemeral,
      content: "This ticket option is no longer available.",
    });
    return;
  }

  if (type !== "other") {
    if (type === "collaboration" || type === "partnership" || type === "issue") {
      await interaction.showModal(
        createTicketModal(type, interaction.user.username),
      );
    }
    return;
  }

  if (!interaction.guild || !client.user) {
    await interaction.reply({
      ...ephemeral,
      content: "Tickets can only be opened inside a server.",
    });
    return;
  }
  await interaction.deferReply(ephemeral);
  const settings = await getGuildSettings(interaction.guild.id);
  const ticket = await createTicketChannel(
    interaction.guild,
    "other",
    interaction.user,
    settings,
    client.user.id,
  );
  await interaction.editReply({
    content: `Your ticket is open: <#${ticket.channel.id}>`,
    allowedMentions: { parse: [] },
  });
}

async function handleTicketForm(
  client: Client,
  interaction: import("discord.js").ModalSubmitInteraction,
) {
  const type = interaction.customId.slice(
    "ticket-form:".length,
  ) as Exclude<TicketType, "other">;
  if (type !== "collaboration" && type !== "partnership" && type !== "issue") {
    await interaction.reply({
      ...ephemeral,
      content: "This ticket form is no longer available.",
    });
    return;
  }
  if (!interaction.guild || !client.user) {
    await interaction.reply({
      ...ephemeral,
      content: "Tickets can only be opened inside a server.",
    });
    return;
  }

  let values: Record<string, string>;
  try {
    values = readTicketForm(interaction, type);
  } catch (error) {
    await interaction.reply({
      ...ephemeral,
      content:
        error instanceof Error
          ? error.message
          : "Please check your ticket details and submit again.",
    });
    return;
  }

  await interaction.deferReply(ephemeral);
  const settings = await getGuildSettings(interaction.guild.id);
  const ticket = await createTicketChannel(
    interaction.guild,
    type,
    interaction.user,
    settings,
    client.user.id,
    values,
  );
  await interaction.editReply({
    content: ticket.requesterCanSee
      ? `Your ticket is open: <#${ticket.channel.id}>`
      : "Your inquiry was sent to staff. They can give you access to the private ticket channel when ready.",
    allowedMentions: { parse: [] },
  });
}

async function handleGrantAccessButton(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.channel?.isTextBased()) {
    await interaction.reply({
      ...ephemeral,
      content: "This ticket is no longer available.",
    });
    return;
  }

  const requesterId = interaction.customId.slice("ticket-grant:".length);
  const settings = await getGuildSettings(interaction.guild.id);
  if (!canManageTicket(interaction, settings.staffRoleId)) {
    await interaction.reply({
      ...ephemeral,
      content: "Only ticket staff can give the requester access.",
    });
    return;
  }

  if (!/^\d{17,20}$/.test(requesterId)) {
    throw new Error("The ticket button has an invalid requester ID.");
  }

  const channel = interaction.channel;
  if (!("permissionOverwrites" in channel)) {
    throw new Error("The ticket channel does not support access settings.");
  }
  await channel.permissionOverwrites.edit(requesterId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  });
  await interaction.message.edit({ components: [] });
  await channel.send({
    content: `<@${requesterId}> has been given access to this ticket.`,
    allowedMentions: { users: [requesterId] },
  });
  await interaction.reply({
    ...ephemeral,
    content: "Requester access granted.",
  });
}

function canManageTicket(
  interaction: ButtonInteraction,
  staffRoleId: string | null,
) {
  if (
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)
  ) {
    return true;
  }
  if (!staffRoleId || !interaction.member) {
    return false;
  }

  const member = interaction.member;
  let roleIds: string[] = [];
  if ("roles" in member && Array.isArray(member.roles)) {
    roleIds = member.roles;
  } else if (
    "roles" in member &&
    "cache" in member.roles &&
    member.roles.cache
  ) {
    roleIds = [...member.roles.cache.keys()];
  }
  return roleIds.includes(staffRoleId);
}

export async function handleMessage(client: Client, message: Message) {
  if (!message.guild || message.author.bot) {
    return;
  }

  if (message.content) {
    const rules = await listPingRules(message.guild.id);
    const normalizedMessage = message.content.toLocaleLowerCase();

    for (const rule of rules) {
      if (
        !rule.enabled ||
        !normalizedMessage.includes(rule.triggerText.toLocaleLowerCase())
      ) {
        continue;
      }

      if (!message.guild.roles.cache.has(rule.roleId)) {
        logger.warn(
          { guildId: message.guild.id, ruleId: rule.id, roleId: rule.roleId },
          "Skipping a custom ping with a missing role",
        );
        continue;
      }

      if (!(await claimPingRule(rule))) {
        continue;
      }

      const target = await client.channels.fetch(rule.channelId);
      if (!target?.isTextBased() || !("send" in target)) {
        logger.warn(
          {
            guildId: message.guild.id,
            ruleId: rule.id,
            channelId: rule.channelId,
          },
          "Skipping a custom ping with an inaccessible channel",
        );
        continue;
      }

      await target.send({
        content: `<@&${rule.roleId}> A message matching “${rule.triggerText}” was posted in <#${message.channelId}>.`,
        allowedMentions: { roles: [rule.roleId] },
      });
    }
  }

  const settings = await getGuildSettings(message.guild.id);
  if (!message.content.startsWith(settings.prefix)) {
    return;
  }

  const [command, destinationKey, ...messageParts] = message.content
    .slice(settings.prefix.length)
    .trim()
    .split(/\s+/);
  const normalizedCommand = command?.toLocaleLowerCase();

  if (normalizedCommand === "help") {
    await message.reply({
      content: [
        `Text prefix: \`${settings.prefix}\``,
        `\`${settings.prefix}help\` — show this guide`,
        `\`${settings.prefix}ping\` — check bot response`,
        "Use `/setup help` for server settings and `/ping` for community channel pings.",
      ].join("\n"),
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (normalizedCommand === "ping") {
    if (!destinationKey) {
      await message.reply(
        `Pong! Use /ping for community pings, or ${settings.prefix}help for commands.`,
      );
      return;
    }

    const destination = PING_DESTINATIONS.find(
      (entry) => entry.value === destinationKey.toLocaleLowerCase(),
    );
    if (!destination) {
      await message.reply(
        `Unknown ping type. Available: ${PING_DESTINATIONS.map((entry) => entry.value).join(", ")}.`,
      );
      return;
    }
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await message.reply("You need Manage Messages permission to post a ping.");
      return;
    }

    const text = sanitizePingText(messageParts.join(" ").trim());
    if (!text) {
      await message.reply(
        `Add a message, for example: ${settings.prefix}ping revive We're going live.`,
      );
      return;
    }
    await postPing(client, destination.value, text);
    await message.reply(`Ping posted in <#${destination.channelId}>.`);
  }
}

export function logInteractionError(error: unknown, interaction: {
  guildId: string | null;
  commandName?: string;
  customId?: string;
}) {
  logger.error(
    {
      err: error,
      guildId: interaction.guildId,
      commandName: interaction.commandName,
      customId: interaction.customId,
    },
    "Discord interaction failed",
  );
}
