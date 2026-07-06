import { YouTubeReader } from "../dist/youtube-reader.js";
import { TikTokReader } from "../dist/tiktok-reader.js";
import { upsertJobsFromItems } from "../dist/jobs.js";

const sources = [
  { type: "facebook", url: "https://www.facebook.com/vukim.cuong.71/reels/", limit: 200 },
  { type: "youtube", url: "https://www.youtube.com/@KimCuongMaster", limit: 500 },
  { type: "tiktok", url: "https://www.tiktok.com/@ditimchannga", limit: 500 },
  { type: "tiktok", url: "https://www.tiktok.com/@ommani.padmehum", limit: 500 },
  { type: "tiktok", url: "https://www.tiktok.com/@daotrangquantheam", limit: 500 },
];

console.log(`[${new Date().toISOString()}] starting multi-source scan`);

for (const source of sources) {
  try {
    console.log(`scanning ${source.type} ${source.url}...`);
    const reader = source.type === "youtube" ? new YouTubeReader() : source.type === "facebook" ? new (await import("../dist/facebook-reader.js")).FacebookReader() : new TikTokReader();
    const items = await reader.listNew({ account: source.url, limit: source.limit, mark_seen: false });
    const result = await upsertJobsFromItems(items);
    console.log(JSON.stringify({ source: source.url, found: items.length, created: result.created.length, refreshed: result.refreshed.length, skipped: result.skipped.length }, null, 2));
  } catch (e) {
    console.error(`error scanning ${source.url}:`, e.message);
  }
}

console.log(`[${new Date().toISOString()}] multi-source scan complete`);
