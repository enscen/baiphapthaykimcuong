// Scan script for each channel with source_account labeling
import { YouTubeReader } from "../dist/youtube-reader.js";
import { TikTokReader } from "../dist/tiktok-reader.js";
import { upsertJobsFromItems, listJobs } from "../dist/jobs.js";

const channels = [
  { name: "YouTube Enscen", type: "youtube", url: "https://www.youtube.com/@enscen", limit: 500 },
  { name: "YouTube Master Kim Cương", type: "youtube", url: "https://www.youtube.com/@KimCuongMaster", limit: 500 },
  { name: "TikTok Thầy Kim Cương", type: "tiktok", url: "https://www.tiktok.com/@diamond.paramita", limit: 500 },
  { name: "TikTok ĐT Quán Thế Âm", type: "tiktok", url: "https://www.tiktok.com/@daotrangquantheam", limit: 500 },
];

console.log(`[${new Date().toISOString()}] Scanning all channels...`);

for (const ch of channels) {
  try {
    console.log(`\n>>> ${ch.name}`);
    const reader = ch.type === "youtube" ? new YouTubeReader() : new TikTokReader();
    const items = await reader.listNew({ account: ch.url, limit: ch.limit, mark_seen: false });
    const result = await upsertJobsFromItems(items);
    console.log(`Found: ${items.length}, Created: ${result.created.length}, Updated: ${result.refreshed.length}`);
  } catch (e) {
    console.error(`✗ ${ch.name}:`, e.message);
  }
}

console.log(`\n[${new Date().toISOString()}] Scan complete`);
const total = (await listJobs()).length;
console.log(`Total jobs in DB: ${total}`);
