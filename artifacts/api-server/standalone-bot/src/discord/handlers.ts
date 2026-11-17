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
  type TextChannel,
} from "discord.js";
import { logger } from "../lib/logger";
import {
  MISHAPS_AUTO_PING_CHANNEL_ID,
  MISHAPS_AUTO_PING_COOLDOWN_MS,
  MISHAPS_AUTO_PING_ROLE_ID,
  PING_DESTINATIONS,
  SLASH_PING_COOLDOWN_MS,
  SERVER_CHANGES_CHANNEL_ID,
  TICKET_DASHBOARD_CHANNEL_ID,
  TICKET_TYPES,
  type TicketType,
} from "./constants";
import {
  getGuildSettings,
  updateGuildSettings,
} from "./storage";
import {
  createTicketChannel,
  createTicketModal,
  readTicketForm,
} from "./tickets";

const ephemeral = { flags: MessageFlags.Ephemeral } as const;
const automaticPingCooldowns = new Map<string, number>();
const slashPingCooldowns = new Map<string, number>();

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
      await handlePingCommand(interaction);
      return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === "ticket-close") {
      await handleCloseTicketButton(interaction);
      return;
    }
    if (interaction.customId === "ticket-delete") {
      await handleDeleteTicketButton(interaction);
      return;
    }
    if (interaction.customId === "ticket-delete-confirm") {
      await handleConfirmDeleteTicketButton(interaction);
      return;
    }
    if (interaction.customId === "ticket-delete-cancel") {
      await interaction.update({
        content: "Deletion cancelled. The ticket remains closed and its history is preserved.",
        components: [],
      });
      return;
    }
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
        "`/setup changes enabled` — turn change announcements on or off.",
        "`/setup changes post` — post a change announcement.",
        "`/setup tickets staff-role` — choose who can see and manage tickets.",
        "`/setup tickets category` — choose where ticket channels are created.",
        "`/setup tickets publish` — post the ticket dashboard.",
        "`/ping` — mention one of nine roles in this channel. Manage Messages is required; moderators have a five-minute cooldown and administrators bypass it.",
        `Manager Mishaps: messages in <#${MISHAPS_AUTO_PING_CHANNEL_ID}> ping <@&${MISHAPS_AUTO_PING_ROLE_ID}> once per 15 minutes.`,
        "Prefix commands: `<prefix>help` and `<prefix>ping` (response check only).",
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

      const panelPayload = {
        embeds: [
          new EmbedBuilder()
            .setColor(0x8b5cf6)
            .setTitle("✨ Easygoing · Support & Inquiries")
            .setDescription(
              "Need help or want to work with Easygoing? Choose one option below and complete its short form. Please open one ticket per topic and include enough detail for staff to help.\n\n**Before you choose:** Collaboration, Partnership, and Issues begin as private staff tickets. Staff can give you channel access when they are ready. **Other** opens a channel you can see and message right away.",
            )
            .setFooter({ text: "Easygoing community · Staff will reply in your ticket" }),
          new EmbedBuilder()
            .setColor(0xec4899)
            .setTitle("🎬 Collaboration Inquiry")
            .setDescription(
              "Choose this if you create YouTube content and want to collaborate with Easygoing. The form asks for your Discord @, YouTube @, and why you think the collaboration is a good fit.",
            ),
          new EmbedBuilder()
            .setColor(0x38bdf8)
            .setTitle("🤝 Discord Partnership")
            .setDescription(
              "Choose this to suggest a partnership between Discord communities. Include your Discord @, a working invite link, and a short explanation of your server and proposal.",
            ),
          new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("🛠️ Issues")
            .setDescription(
              "Choose this to report a server problem or ask staff to look into something. Add your Discord @ and describe what happened, where it happened, and any useful details.",
            ),
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("💬 Other")
            .setDescription(
              "Choose this for anything that does not fit the options above. It creates a visible ticket channel immediately so you and staff can chat there.",
            ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("ticket:collaboration")
              .setLabel("Collaboration Inquiry")
              .setEmoji("🎬")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId("ticket:partnership")
              .setLabel("Discord Partnership")
              .setEmoji("🤝")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId("ticket:issue")
              .setLabel("Issues")
              .setEmoji("🛠️")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId("ticket:other")
              .setLabel("Other")
              .setEmoji("💬")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      };
      let updatedExistingPanel = false;
      if ("messages" in channel && client.user) {
        const recentMessages = await channel.messages.fetch({ limit: 100 });
        const existingPanel = recentMessages.find(
          (message) =>
            message.author.id === client.user?.id &&
            message.components.some(
              (row) =>
                "components" in row &&
                row.components.some(
                  (component) =>
                    "customId" in component &&
                    component.customId === "ticket:collaboration",
                ),
            ),
        );
        if (existingPanel) {
          await existingPanel.edit(panelPayload);
          updatedExistingPanel = true;
        }
      }
      if (!updatedExistingPanel) {
        await channel.send(panelPayload);
      }
      await interaction.reply({
        ...ephemeral,
        content: `${updatedExistingPanel ? "Ticket dashboard updated" : "Ticket dashboard posted"} in <#${TICKET_DASHBOARD_CHANNEL_ID}>.`,
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
  interaction: ChatInputCommandInteraction,
) {
  if (!interaction.guild) {
    await interaction.reply({
      ...ephemeral,
      content: "Use this command inside your Discord server.",
    });
    return;
  }
  const isAdministrator = Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
  const canManageMessages = Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages),
  );
  if (!isAdministrator && !canManageMessages) {
    await interaction.reply({
      ...ephemeral,
      content: "You need Manage Messages or Administrator permission to use this ping.",
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel?.isTextBased() || !("send" in channel)) {
    await interaction.reply({
      ...ephemeral,
      content: "Use `/ping` in a text channel.",
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

  const cooldownKey = `${interaction.guild.id}:${interaction.user.id}`;
  let reservedAt: number | undefined;
  if (!isAdministrator) {
    const claim = claimCooldown(
      slashPingCooldowns,
      cooldownKey,
      SLASH_PING_COOLDOWN_MS,
    );
    if (!claim.allowed) {
      await interaction.reply({
        ...ephemeral,
        content: `You can use \`/ping\` again in ${formatCooldownTime(claim.retryAfterMs)}.`,
      });
      return;
    }
    reservedAt = claim.reservedAt;
  }

  try {
    await channel.send({
      content: `<@&${destination.roleId}>`,
      allowedMentions: { roles: [destination.roleId] },
    });
  } catch (error) {
    if (reservedAt !== undefined) {
      releaseCooldown(slashPingCooldowns, cooldownKey, reservedAt);
    }
    throw error;
  }

  await interaction.reply({
    ...ephemeral,
    content: `Mentioned the ${destination.name} role in this channel.`,
    allowedMentions: { parse: [] },
  });
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
  await interaction.message.edit({
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket-close")
          .setLabel("Close ticket")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
  await channel.send({
    content: `<@${requesterId}> has been given access to this ticket.`,
    allowedMentions: { users: [requesterId] },
  });
  await interaction.reply({
    ...ephemeral,
    content: "Requester access granted.",
  });
}

async function handleCloseTicketButton(interaction: ButtonInteraction) {
  const channel = getTicketChannel(interaction);
  if (!interaction.guild || !channel) {
    await interaction.reply({
      ...ephemeral,
      content: "This button only works inside an open ticket channel.",
    });
    return;
  }

  const ticket = parseTicketTopic(channel.topic);
  if (!ticket) {
    await interaction.reply({
      ...ephemeral,
      content: "This channel is not a ticket managed by the bot.",
    });
    return;
  }

  const settings = await getGuildSettings(interaction.guild.id);
  const isOpener = interaction.user.id === ticket.openerId;
  if (!isOpener && !canManageTicket(interaction, settings.staffRoleId)) {
    await interaction.reply({
      ...ephemeral,
      content: "Only the ticket opener or ticket staff can close this ticket.",
    });
    return;
  }
  if (ticket.status === "closed") {
    await interaction.reply({
      ...ephemeral,
      content: "This ticket is already closed.",
    });
    return;
  }

  await interaction.deferReply(ephemeral);
  await channel.permissionOverwrites.edit(ticket.openerId, {
    SendMessages: false,
  });
  await channel.setTopic(
    `ticket:${ticket.type};opener:${ticket.openerId};status:closed`,
    "Ticket closed",
  );
  if (!channel.name.startsWith("closed-")) {
    await channel.setName(`closed-${channel.name}`, "Ticket closed");
  }

  const originalEmbed = interaction.message.embeds[0];
  const closedEmbed = originalEmbed
    ? EmbedBuilder.from(originalEmbed)
        .setTitle(`🔒 Closed · ${channel.name}`)
        .setColor(0x64748b)
    : new EmbedBuilder()
        .setTitle(`🔒 Closed · ${channel.name}`)
        .setColor(0x64748b);
  await interaction.message.edit({
    embeds: [closedEmbed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket-delete")
          .setLabel("Delete ticket")
          .setEmoji("🗑️")
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  });
  await interaction.editReply({
    content:
      "Ticket closed. Its channel and conversation history are preserved; staff can delete it later.",
  });
}

async function handleDeleteTicketButton(interaction: ButtonInteraction) {
  const channel = getTicketChannel(interaction);
  if (!interaction.guild || !channel) {
    await interaction.reply({
      ...ephemeral,
      content: "This button only works inside a ticket channel.",
    });
    return;
  }

  const ticket = parseTicketTopic(channel.topic);
  if (!ticket || ticket.status !== "closed") {
    await interaction.reply({
      ...ephemeral,
      content: "Close the ticket first. Open tickets cannot be deleted.",
    });
    return;
  }

  const settings = await getGuildSettings(interaction.guild.id);
  if (!canManageTicket(interaction, settings.staffRoleId)) {
    await interaction.reply({
      ...ephemeral,
      content: "Only ticket staff can delete a ticket channel.",
    });
    return;
  }

  await interaction.reply({
    ...ephemeral,
    content:
      "Permanently delete this closed ticket channel? This removes the channel and its conversation history and cannot be undone.",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket-delete-confirm")
          .setLabel("Delete permanently")
          .setEmoji("⚠️")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("ticket-delete-cancel")
          .setLabel("Keep ticket")
          .setEmoji("↩️")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleConfirmDeleteTicketButton(interaction: ButtonInteraction) {
  const channel = getTicketChannel(interaction);
  if (!interaction.guild || !channel) {
    await interaction.update({
      content: "The ticket channel is no longer available.",
      components: [],
    });
    return;
  }

  const ticket = parseTicketTopic(channel.topic);
  if (!ticket || ticket.status !== "closed") {
    await interaction.update({
      content: "Only a closed ticket can be deleted.",
      components: [],
    });
    return;
  }

  const settings = await getGuildSettings(interaction.guild.id);
  if (!canManageTicket(interaction, settings.staffRoleId)) {
    await interaction.update({
      content: "Only ticket staff can delete a ticket channel.",
      components: [],
    });
    return;
  }

  await interaction.deferUpdate();
  try {
    await channel.delete(`Ticket deleted by ${interaction.user.username}`);
    await interaction.followUp({
      ...ephemeral,
      content: "Ticket channel and its conversation history deleted.",
    });
  } catch (error) {
    logger.error(
      { err: error, guildId: interaction.guild.id, channelId: channel.id },
      "Could not delete ticket channel",
    );
    await interaction.followUp({
      ...ephemeral,
      content: "Could not delete the ticket. Check the bot's channel permissions.",
    });
  }
}

function getTicketChannel(
  interaction: ButtonInteraction,
): TextChannel | null {
  const channel = interaction.channel;
  if (
    !channel?.isTextBased() ||
    !("topic" in channel) ||
    !("setTopic" in channel) ||
    !("permissionOverwrites" in channel) ||
    !("setName" in channel)
  ) {
    return null;
  }

  return channel as TextChannel;
}

function parseTicketTopic(topic: string | null) {
  const match = topic?.match(
    /^ticket:(collaboration|partnership|issue|other);opener:(\d{17,20})(?:;status:(open|closed))?$/,
  );
  if (!match) {
    return null;
  }

  return {
    type: match[1] as TicketType,
    openerId: match[2] as string,
    status: (match[3] ?? "open") as "open" | "closed",
  };
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

  if (message.channelId === MISHAPS_AUTO_PING_CHANNEL_ID) {
    if (!message.guild.roles.cache.has(MISHAPS_AUTO_PING_ROLE_ID)) {
      logger.warn(
        {
          guildId: message.guild.id,
          roleId: MISHAPS_AUTO_PING_ROLE_ID,
        },
        "Skipping the Manager Mishaps ping because its role is unavailable",
      );
    } else if (message.channel.isTextBased() && "send" in message.channel) {
      const cooldownKey = message.guild.id;
      const claim = claimCooldown(
        automaticPingCooldowns,
        cooldownKey,
        MISHAPS_AUTO_PING_COOLDOWN_MS,
      );
      if (claim.allowed) {
        try {
          await message.channel.send({
            content: `<@&${MISHAPS_AUTO_PING_ROLE_ID}>`,
            allowedMentions: { roles: [MISHAPS_AUTO_PING_ROLE_ID] },
          });
        } catch (error) {
          releaseCooldown(automaticPingCooldowns, cooldownKey, claim.reservedAt);
          throw error;
        }
      }
    }
  }

  const settings = await getGuildSettings(message.guild.id);
  if (!message.content.startsWith(settings.prefix)) {
    return;
  }

  const [command] = message.content
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
        "Use `/setup help` for server settings and `/ping` to mention a role in this channel.",
      ].join("\n"),
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (normalizedCommand === "ping") {
    await message.reply(
      `Pong! Use /ping to mention a role, or ${settings.prefix}help for commands.`,
    );
  }
}

function claimCooldown(
  cooldowns: Map<string, number>,
  key: string,
  durationMs: number,
  now = Date.now(),
) {
  const lastUsedAt = cooldowns.get(key);
  if (lastUsedAt !== undefined && now - lastUsedAt < durationMs) {
    return {
      allowed: false as const,
      retryAfterMs: durationMs - (now - lastUsedAt),
    };
  }

  cooldowns.set(key, now);
  for (const [storedKey, timestamp] of cooldowns) {
    if (now - timestamp >= durationMs) {
      cooldowns.delete(storedKey);
    }
  }

  return { allowed: true as const, reservedAt: now };
}

function releaseCooldown(
  cooldowns: Map<string, number>,
  key: string,
  reservedAt: number,
) {
  if (cooldowns.get(key) === reservedAt) {
    cooldowns.delete(key);
  }
}

function formatCooldownTime(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1_000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) {
    return `${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`;
  }
  if (remainingSeconds === 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"} and ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`;
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
