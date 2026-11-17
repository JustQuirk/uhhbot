import { ChannelType, type Client } from "discord.js";
import { logger } from "../lib/logger";
import {
  SUBSCRIBER_COUNT_CHANNEL_ID,
  SUBSCRIBER_COUNT_INTERVAL_MS,
  YOUTUBE_CHANNEL_HANDLE,
} from "./constants";

type FetchLike = (
  input: URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export function formatSubscriberCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Subscriber count must be a non-negative safe integer.");
  }

  if (count < 1_000) {
    return String(count);
  }

  const suffixes = ["K", "M", "B", "T"];
  let abbreviated = count;
  let suffixIndex = -1;
  while (abbreviated >= 1_000 && suffixIndex < suffixes.length - 1) {
    abbreviated /= 1_000;
    suffixIndex += 1;
  }

  const truncated = Math.floor(abbreviated * 100) / 100;
  const formatted = truncated.toFixed(2).replace(/\.?0+$/, "");
  return `${formatted}${suffixes[suffixIndex]}`;
}

export async function fetchYoutubeSubscriberCount(
  apiKey: string,
  fetcher: FetchLike = globalThis.fetch,
) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "statistics");
  url.searchParams.set("forHandle", YOUTUBE_CHANNEL_HANDLE);
  url.searchParams.set("key", apiKey);

  let response: Pick<Response, "ok" | "status" | "json">;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Could not reach the YouTube Data API.");
  }

  if (!response.ok) {
    throw new Error(`YouTube Data API returned HTTP ${response.status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("YouTube Data API returned invalid JSON.");
  }

  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error("YouTube Data API response did not include channel data.");
  }

  const firstItem: unknown = payload.items[0];
  if (!isRecord(firstItem) || !isRecord(firstItem.statistics)) {
    throw new Error("YouTube Data API response did not include channel statistics.");
  }

  const statistics = firstItem.statistics;
  if (statistics.hiddenSubscriberCount === true) {
    throw new Error("The YouTube channel does not expose its subscriber count.");
  }

  const rawCount = statistics.subscriberCount;
  if (typeof rawCount !== "string" || !/^\d+$/.test(rawCount)) {
    throw new Error("YouTube Data API did not return a valid subscriber count.");
  }

  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("YouTube Data API returned an invalid subscriber count.");
  }
  return count;
}

export function startSubscriberCountUpdater(client: Client) {
  const apiKey = process.env["YOUTUBE_API_KEY"]?.trim();
  if (!apiKey) {
    logger.error(
      { channelId: SUBSCRIBER_COUNT_CHANNEL_ID },
      "YOUTUBE_API_KEY is missing; subscriber count updates are disabled",
    );
    return;
  }

  let updateInProgress = false;
  let previousUpdateFailed = false;

  const update = async () => {
    if (updateInProgress || !client.isReady()) {
      return;
    }

    updateInProgress = true;
    try {
      const subscriberCount = await fetchYoutubeSubscriberCount(apiKey);
      const channel = await client.channels.fetch(SUBSCRIBER_COUNT_CHANNEL_ID);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        throw new Error(
          `Discord channel ${SUBSCRIBER_COUNT_CHANNEL_ID} is not an accessible voice channel.`,
        );
      }

      const displayName = `🔴┃Subscribers: ${formatSubscriberCount(subscriberCount)}`;
      const changed = channel.name !== displayName;
      if (changed) {
        await channel.setName(displayName, "Refresh YouTube subscriber count");
      }

      if (previousUpdateFailed) {
        logger.info("YouTube subscriber count updater recovered");
      }
      previousUpdateFailed = false;

      if (changed) {
        logger.info(
          { channelId: channel.id, subscriberCount, displayName },
          "Updated YouTube subscriber count channel",
        );
      }
    } catch (error) {
      if (!previousUpdateFailed) {
        logger.error(
          {
            channelId: SUBSCRIBER_COUNT_CHANNEL_ID,
            errorMessage:
              error instanceof Error ? error.message : "Unexpected error",
          },
          "Could not update YouTube subscriber count channel",
        );
      }
      previousUpdateFailed = true;
    } finally {
      updateInProgress = false;
    }
  };

  void update();
  const timer = setInterval(() => {
    void update();
  }, SUBSCRIBER_COUNT_INTERVAL_MS);
  timer.unref();
  logger.info(
    {
      channelId: SUBSCRIBER_COUNT_CHANNEL_ID,
      intervalMs: SUBSCRIBER_COUNT_INTERVAL_MS,
      channelHandle: YOUTUBE_CHANNEL_HANDLE,
    },
    "YouTube subscriber count updater started",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
