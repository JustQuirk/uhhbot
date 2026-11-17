export const TICKET_DASHBOARD_CHANNEL_ID = "1568687137933623356";
export const SERVER_CHANGES_CHANNEL_ID = "1568722944492970004";
export const SUBSCRIBER_COUNT_CHANNEL_ID = "1568781440500375673";
export const YOUTUBE_CHANNEL_HANDLE = "@easygoingdoors";
export const SUBSCRIBER_COUNT_INTERVAL_MS = 60_000;
export const MISHAPS_AUTO_PING_CHANNEL_ID = "1570082352007225486";
export const MISHAPS_AUTO_PING_ROLE_ID = "1568379028979851264";
export const MISHAPS_AUTO_PING_COOLDOWN_MS = 15 * 60_000;
export const SLASH_PING_COOLDOWN_MS = 5 * 60_000;

export const PING_DESTINATIONS = [
  {
    name: "Revive",
    value: "revive",
    roleId: "1570071171628793926",
  },
  {
    name: "Announcements",
    value: "announcements",
    roleId: "1568377908974715031",
  },
  {
    name: "Mishaps",
    value: "mishaps",
    roleId: "1568379028979851264",
  },
  {
    name: "Uploads",
    value: "uploads",
    roleId: "1568377938842230804",
  },
  {
    name: "Kitty Gallery",
    value: "kitty-gallery",
    roleId: "1568379072789352528",
  },
  {
    name: "Happy Friday",
    value: "happy-friday",
    roleId: "1568378072258838712",
  },
  {
    name: "Milestones",
    value: "milestones",
    roleId: "1568377964176085115",
  },
  {
    name: "Giveaways",
    value: "giveaways",
    roleId: "1568377996035756043",
  },
  {
    name: "Polls",
    value: "polls",
    roleId: "1568378013119152218",
  },
] as const;

export type PingDestinationValue =
  (typeof PING_DESTINATIONS)[number]["value"];

export const TICKET_TYPES = {
  collaboration: {
    label: "Collaboration Inquiry",
    channelPrefix: "collaboration",
    modalTitle: "Collaboration Inquiry",
    fields: [
      { id: "discord", label: "Your Discord @", style: "short" },
      { id: "youtube", label: "Your YouTube @", style: "short" },
      { id: "reason", label: "Why should we collaborate?", style: "paragraph" },
    ],
  },
  partnership: {
    label: "Discord Partnership",
    channelPrefix: "partnership",
    modalTitle: "Discord Partnership",
    fields: [
      { id: "discord", label: "Your Discord @", style: "short" },
      { id: "invite", label: "Your Discord invite link", style: "short" },
      { id: "reason", label: "Why should we partner?", style: "paragraph" },
    ],
  },
  issue: {
    label: "Issues",
    channelPrefix: "issue",
    modalTitle: "Report an Issue",
    fields: [
      { id: "discord", label: "Your Discord @", style: "short" },
      { id: "issue", label: "Describe the issue", style: "paragraph" },
    ],
  },
  other: {
    label: "Other",
    channelPrefix: "other",
    modalTitle: "Other Ticket",
    fields: [],
  },
} as const;

export type TicketType = keyof typeof TICKET_TYPES;
