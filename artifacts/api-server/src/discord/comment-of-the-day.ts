import { EmbedBuilder, type Client } from "discord.js";
import { logger } from "../lib/logger";
import {
  COMMENT_OF_THE_DAY_CHANNEL_ID,
  YOUTUBE_CHANNEL_HANDLE,
} from "./constants";

const TIME_ZONE = "Europe/Warsaw";
const DAILY_POST_HOUR = 12;
const MAX_UPLOADS_TO_SCAN = 50;
const MAX_SHORTS_TO_SCAN = 10;
const MAX_COMMENT_PAGES_PER_SHORT = 10;
const MAX_COMMENT_LENGTH = 3_900;
const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";

type FetchLike = (
  input: URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type BestComment = {
  id: string;
  text: string;
  likeCount: number;
  publishedAt: string;
};

class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

let schedulerStarted = false;

export function getNextCommentOfTheDayRun(now = new Date()) {
  const localNow = getZonedDateParts(now);
  let target = localDateTimeToUtc({
    ...localNow,
    hour: DAILY_POST_HOUR,
    minute: 0,
    second: 0,
  });

  if (target <= now.getTime()) {
    const nextCalendarDay = new Date(
      Date.UTC(localNow.year, localNow.month - 1, localNow.day + 1),
    );
    target = localDateTimeToUtc({
      year: nextCalendarDay.getUTCFullYear(),
      month: nextCalendarDay.getUTCMonth() + 1,
      day: nextCalendarDay.getUTCDate(),
      hour: DAILY_POST_HOUR,
      minute: 0,
      second: 0,
    });
  }

  return new Date(target);
}

export function parseYouTubeDurationSeconds(duration: string) {
  const match = duration.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) {
    return null;
  }

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const totalSeconds = days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
  return Number.isFinite(totalSeconds) ? totalSeconds : null;
}

export function normalizeYouTubeCommentText(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_entity, decimal: string) =>
      safeCodePoint(Number(decimal)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_entity, hexadecimal: string) =>
      safeCodePoint(Number.parseInt(hexadecimal, 16)),
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchBestRecentShortComment(
  apiKey: string,
  fetcher: FetchLike = globalThis.fetch,
): Promise<BestComment | null> {
  const channelResponse = await fetchYouTubeJson(
    "channels",
    { part: "contentDetails", forHandle: YOUTUBE_CHANNEL_HANDLE },
    apiKey,
    fetcher,
  );
  const channel = firstRecord(channelResponse.items);
  const contentDetails = isRecord(channel?.contentDetails)
    ? channel.contentDetails
    : null;
  const relatedPlaylists = isRecord(contentDetails?.relatedPlaylists)
    ? contentDetails.relatedPlaylists
    : null;
  const uploadsPlaylistId = getString(relatedPlaylists?.uploads);
  if (!uploadsPlaylistId) {
    throw new Error("YouTube did not return the channel uploads playlist.");
  }

  const uploadsResponse = await fetchYouTubeJson(
    "playlistItems",
    {
      part: "snippet",
      playlistId: uploadsPlaylistId,
      maxResults: String(MAX_UPLOADS_TO_SCAN),
    },
    apiKey,
    fetcher,
  );
  const uploadIds = collectUploadVideoIds(uploadsResponse.items);
  if (uploadIds.length === 0) {
    return null;
  }

  const videoResponse = await fetchYouTubeJson(
    "videos",
    {
      part: "contentDetails",
      id: uploadIds.join(","),
    },
    apiKey,
    fetcher,
  );
  const durationByVideoId = collectVideoDurations(videoResponse.items);
  const recentShortIds = uploadIds
    .filter((videoId) => {
      const duration = durationByVideoId.get(videoId);
      return duration !== undefined && duration <= 180;
    })
    .slice(0, MAX_SHORTS_TO_SCAN);

  let bestComment: BestComment | null = null;
  for (const videoId of recentShortIds) {
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_COMMENT_PAGES_PER_SHORT; page += 1) {
      let response: Record<string, unknown>;
      try {
        response = await fetchYouTubeJson(
          "commentThreads",
          {
            part: "snippet",
            videoId,
            maxResults: "100",
            order: "relevance",
            ...(pageToken ? { pageToken } : {}),
          },
          apiKey,
          fetcher,
        );
      } catch (error) {
        if (error instanceof YouTubeApiError && error.status === 403) {
          logger.warn(
            { videoId },
            "Skipping a recent Short whose comments are unavailable",
          );
          break;
        }
        throw error;
      }

      for (const comment of collectTopLevelComments(response.items)) {
        if (
          !bestComment ||
          comment.likeCount > bestComment.likeCount ||
          (comment.likeCount === bestComment.likeCount &&
            comment.publishedAt > bestComment.publishedAt)
        ) {
          bestComment = comment;
        }
      }

      pageToken = getString(response.nextPageToken);
      if (!pageToken) {
        break;
      }
    }
  }

  return bestComment;
}

export function startCommentOfTheDayScheduler(client: Client) {
  if (schedulerStarted) {
    return;
  }

  const apiKey = process.env["YOUTUBE_API_KEY"]?.trim();
  if (!apiKey) {
    logger.error(
      { channelId: COMMENT_OF_THE_DAY_CHANNEL_ID },
      "YOUTUBE_API_KEY is missing; Comment of the Day is disabled",
    );
    return;
  }

  schedulerStarted = true;
  const scheduleNextPost = () => {
    const nextPostAt = getNextCommentOfTheDayRun();
    const delay = Math.max(0, nextPostAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      void postCommentOfTheDay(client, apiKey).finally(scheduleNextPost);
    }, delay);
    timer.unref();
    logger.info(
      {
        channelId: COMMENT_OF_THE_DAY_CHANNEL_ID,
        nextPostAt: nextPostAt.toISOString(),
        timeZone: TIME_ZONE,
      },
      "Comment of the Day scheduled",
    );
  };

  scheduleNextPost();
}

async function postCommentOfTheDay(client: Client, apiKey: string) {
  try {
    if (!client.isReady()) {
      logger.warn("Skipping Comment of the Day because Discord is not ready");
      return;
    }

    const bestComment = await fetchBestRecentShortComment(apiKey);
    if (!bestComment) {
      logger.info("No public comments were found on recent Shorts");
      return;
    }

    const channel = await client.channels.fetch(COMMENT_OF_THE_DAY_CHANNEL_ID);
    if (!channel?.isTextBased() || !("send" in channel)) {
      throw new Error(
        `Discord channel ${COMMENT_OF_THE_DAY_CHANNEL_ID} is not accessible for Comment of the Day.`,
      );
    }

    const displayText =
      bestComment.text.length > MAX_COMMENT_LENGTH
        ? `${bestComment.text.slice(0, MAX_COMMENT_LENGTH - 1).trimEnd()}…`
        : bestComment.text;
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("💬 Comment of the Day")
          .setDescription(displayText),
      ],
      allowedMentions: { parse: [] },
    });
    logger.info(
      {
        channelId: COMMENT_OF_THE_DAY_CHANNEL_ID,
        commentId: bestComment.id,
        likeCount: bestComment.likeCount,
      },
      "Posted anonymous Comment of the Day",
    );
  } catch (error) {
    logger.error(
      {
        channelId: COMMENT_OF_THE_DAY_CHANNEL_ID,
        errorMessage: error instanceof Error ? error.message : "Unexpected error",
      },
      "Could not post Comment of the Day",
    );
  }
}

async function fetchYouTubeJson(
  resource: string,
  query: Record<string, string>,
  apiKey: string,
  fetcher: FetchLike,
) {
  const url = new URL(`${YOUTUBE_API_BASE_URL}/${resource}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", apiKey);

  let response: Pick<Response, "ok" | "status" | "json">;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new YouTubeApiError(`Could not reach the YouTube ${resource} API.`);
  }

  if (!response.ok) {
    throw new YouTubeApiError(
      `YouTube ${resource} API returned HTTP ${response.status}.`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new YouTubeApiError(
      `YouTube ${resource} API returned invalid JSON.`,
    );
  }

  if (!isRecord(payload)) {
    throw new YouTubeApiError(
      `YouTube ${resource} API returned an invalid response.`,
    );
  }
  return payload;
}

function collectUploadVideoIds(items: unknown) {
  if (!Array.isArray(items)) {
    return [];
  }

  const videoIds: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || !isRecord(item.snippet)) {
      continue;
    }
    const resourceId = isRecord(item.snippet.resourceId)
      ? item.snippet.resourceId
      : null;
    const videoId = getString(resourceId?.videoId);
    if (videoId && !seen.has(videoId)) {
      videoIds.push(videoId);
      seen.add(videoId);
    }
  }
  return videoIds;
}

function collectVideoDurations(items: unknown) {
  const durations = new Map<string, number>();
  if (!Array.isArray(items)) {
    return durations;
  }

  for (const item of items) {
    if (!isRecord(item) || !isRecord(item.contentDetails)) {
      continue;
    }
    const videoId = getString(item.id);
    const duration = getString(item.contentDetails.duration);
    if (!videoId || !duration) {
      continue;
    }
    const seconds = parseYouTubeDurationSeconds(duration);
    if (seconds !== null) {
      durations.set(videoId, seconds);
    }
  }
  return durations;
}

function collectTopLevelComments(items: unknown): BestComment[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const comments: BestComment[] = [];
  for (const item of items) {
    if (!isRecord(item) || !isRecord(item.snippet)) {
      continue;
    }
    const topLevelComment = isRecord(item.snippet.topLevelComment)
      ? item.snippet.topLevelComment
      : null;
    const commentSnippet = isRecord(topLevelComment?.snippet)
      ? topLevelComment.snippet
      : null;
    const commentId = getString(topLevelComment?.id);
    const renderedText = getString(commentSnippet?.textDisplay);
    const text = renderedText
      ? normalizeYouTubeCommentText(renderedText)
      : "";
    if (!commentId || !text) {
      continue;
    }

    comments.push({
      id: commentId,
      text,
      likeCount:
        typeof commentSnippet?.likeCount === "number" &&
        Number.isFinite(commentSnippet.likeCount)
          ? Math.max(0, commentSnippet.likeCount)
          : 0,
      publishedAt: getString(commentSnippet?.publishedAt) ?? "",
    });
  }
  return comments;
}

function getZonedDateParts(date: Date): DateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? NaN);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function localDateTimeToUtc(parts: DateParts) {
  const targetLocalTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = targetLocalTime;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actualLocal = getZonedDateParts(new Date(candidate));
    const representedLocalTime = Date.UTC(
      actualLocal.year,
      actualLocal.month - 1,
      actualLocal.day,
      actualLocal.hour,
      actualLocal.minute,
      actualLocal.second,
    );
    const correction = targetLocalTime - representedLocalTime;
    candidate += correction;
    if (correction === 0) {
      break;
    }
  }

  return candidate;
}

function firstRecord(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  return isRecord(value[0]) ? value[0] : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeCodePoint(codePoint: number) {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : "";
}
