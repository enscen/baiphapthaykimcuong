import { TikTokReader } from "../dist/tiktok-reader.js";
import { upsertJobsFromItems, listJobs } from "../dist/jobs.js";

const account = process.argv[2] || "https://www.tiktok.com/@diamond.paramita";
const limit = Number(process.argv[3] || 1000);

console.log(`[${new Date().toISOString()}] start tiktok scan`, account, limit);
const before = (await listJobs()).filter((job) => job.source.source_platform === "tiktok").length;
const reader = new TikTokReader();
const items = await reader.listNew({ account, limit, mark_seen: false });
const result = await upsertJobsFromItems(items);
const after = (await listJobs()).filter((job) => job.source.source_platform === "tiktok").length;
console.log(JSON.stringify({ ok: true, account, before, found: items.length, created: result.created.length, refreshed: result.refreshed.length, skipped: result.skipped.length, after }, null, 2));
