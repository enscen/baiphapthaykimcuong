import "dotenv/config";
import type { ListNewRequest } from "./types.js";
import { getReader } from "./publishers.js";
import { filterUnprocessed, markProcessed } from "./state.js";

const JOBS = [
  {
    action: "list_new_facebook_posts",
    payload: {
      account: process.env.FACEBOOK_SOURCE_URL || "https://www.facebook.com/vukim.cuong.71",
      limit: Number(process.env.POLL_LIMIT || 10),
      since_timestamp: process.env.FACEBOOK_SINCE_TIMESTAMP,
    },
  },
  {
    action: "list_new_tiktok_videos",
    payload: {
      account: process.env.TIKTOK_SOURCE_URL || "https://www.tiktok.com/@diamond.paramita",
      limit: Number(process.env.POLL_LIMIT || 10),
      since_timestamp: process.env.TIKTOK_SINCE_TIMESTAMP,
    },
  },
  {
    action: "list_new_youtube_videos",
    payload: {
      account: process.env.YOUTUBE_SOURCE_URL || "https://www.youtube.com/@enscen/videos",
      limit: Number(process.env.POLL_LIMIT || 10),
      since_timestamp: process.env.YOUTUBE_SINCE_TIMESTAMP,
    },
  },
] as const;

async function runOnce() {
  const all: unknown[] = [];
  for (const job of JOBS) {
    try {
      const reader = getReader(job.action);
      let items = await reader.listNew(job.payload as ListNewRequest);
      items = await filterUnprocessed(items);
      if (items.length > 0) {
        await markProcessed(items);
        all.push({ action: job.action, count: items.length, items });
      } else {
        all.push({ action: job.action, count: 0, items: [] });
      }
    } catch (error) {
      all.push({ action: job.action, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ ok: true, checked_at: new Date().toISOString(), results: all }, null, 2));
}

const intervalMs = Number(process.env.POLL_INTERVAL_MS || 3600000);
await runOnce();
if (process.argv.includes("--once")) process.exit(0);
setInterval(() => {
  void runOnce();
}, intervalMs);