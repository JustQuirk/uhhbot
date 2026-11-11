import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type ModalActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import type { discordGuildSettings } from "@workspace/db";
import { allocateTicketNumber } from "./storage";
import { TICKET_TYPES, type TicketType } from "./constants";

type GuildSettings = typeof discordGuildSettings.$inferSelect;
type TicketFormValues = Record<string, string>;

function formFields(type: TicketType, username: string) {
  switch (type) {
    case "collaboration":
      return [
        {
          id: "discord",
          label: "Your Discord @",
          style: TextInputStyle.Short,
          value: username,
        },
        {
          id: "youtube",
          label: "Your YouTube @",
          style: TextInputStyle.Short,
        },
        {
          id: "reason",
          label: "Why should we collaborate?",
          style: TextInputStyle.Paragraph,
        },
      ];
    case "partnership":
      return [
        {
          id: "discord",
          label: "Your Discord @",
          style: TextInputStyle.Short,
          value: username,
        },
        {
          id: "invite",
          label: "Your Discord invite link",
          style: TextInputStyle.Short,
        },
        {
          id: "reason",
          label: "Why should we partner?",
          style: TextInputStyle.Paragraph,
        },
      ];
    case "issue":
      return [
        {
          id: "discord",
          label: "Your Discord @",
          style: TextInputStyle.Short,
          value: username,
        },
        {
          id: "issue",
          label: "Describe the issue",
          style: TextInputStyle.Paragraph,
        },
      ];
    case "other":
      return [];
  }
}

export function createTicketModal(type: Exclude<TicketType, "other">, username: string) {
  const details = TICKET_TYPES[type];
  const modal = new ModalBuilder()
    .setCustomId(`ticket-form:${type}`)
    .setTitle(details.modalTitle);

  for (const field of formFields(type, username)) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.style)
      .setRequired(true)
      .setMaxLength(field.style === TextInputStyle.Paragraph ? 1000 : 120);

    if ("value" in field && field.value) {
      input.setValue(field.value.slice(0, 120));
    }

    modal.addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        input,
      ),
    );
  }

  return modal;
}

export function readTicketForm(
  interaction: ModalSubmitInteraction,
  type: Exclude<TicketType, "other">,
): TicketFormValues {
  const values: TicketFormValues = {};
  for (const field of formFields(type, interaction.user.username)) {
    values[field.id] = interaction.fields.getTextInputValue(field.id).trim();
  }

  if (type === "partnership") {
    const invite = values["invite"] ?? "";
    if (!/^https?:\/\/(discord\.gg\/|discord\.com\/invite\/)[A-Za-z0-9-]+\/?$/i.test(invite)) {
      throw new Error(
        "Please enter a valid Discord invite, such as https://discord.gg/example.",
      );
    }
  }

  return values;
}

export async function createTicketChannel(
  guild: Guild,
  type: TicketType,
  opener: User,
  settings: GuildSettings,
  botUserId: string,
  values: TicketFormValues = {},
) {
  const ticketNumber = await allocateTicketNumber(guild.id);
  const details = TICKET_TYPES[type];
  const channelName = `${details.channelPrefix}-${String(ticketNumber).padStart(4, "0")}`;
  const staffPermissionBits = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
  ];
  const staffRoleIds = new Set(
    guild.roles.cache
      .filter(
        (role) =>
          role.id !== guild.id &&
          (role.permissions.has(PermissionFlagsBits.Administrator) ||
            role.permissions.has(PermissionFlagsBits.ManageChannels)),
      )
      .map((role) => role.id),
  );

  if (settings.staffRoleId && guild.roles.cache.has(settings.staffRoleId)) {
    staffRoleIds.add(settings.staffRoleId);
  }

  const permissionOverwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: botUserId,
      allow: [
        ...staffPermissionBits,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
    ...[...staffRoleIds].map((id) => ({
      id,
      allow: staffPermissionBits,
    })),
  ];

  const requesterCanSee = type === "other";
  if (requesterCanSee) {
    permissionOverwrites.push({
      id: opener.id,
      allow: staffPermissionBits,
    });
  }

  if (settings.ticketCategoryId) {
    const category = guild.channels.cache.get(settings.ticketCategoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new Error(
        "The saved ticket category is no longer available. Set it again with /setup tickets category.",
      );
    }
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: settings.ticketCategoryId ?? undefined,
    topic: `ticket:${type};opener:${opener.id}`,
    permissionOverwrites,
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${details.label} · ${channelName}`)
    .setTimestamp()
    .addFields(
      { name: "Opened by", value: `<@${opener.id}> (@${opener.username})` },
      ...Object.entries(values).map(([key, value]) => ({
        name: fieldLabel(key),
        value: value || "Not provided",
      })),
    );

  const components = requesterCanSee
    ? []
    : [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket-grant:${opener.id}`)
            .setLabel("Give requester access")
            .setStyle(ButtonStyle.Success),
        ),
      ];

  await channel.send({
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
  });

  return { channel, requesterCanSee, channelName };
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    discord: "Discord @",
    youtube: "YouTube @",
    invite: "Discord invite",
    reason: "Reason",
    issue: "Issue",
  };

  return labels[field] ?? field;
}
