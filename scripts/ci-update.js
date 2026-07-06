import fs from "fs";
import { getReader } from "../dist/publishers.js";
import { upsertJobsFromItems } from "../dist/jobs.js";

const sources = [
  { action: "list_new_facebook_posts", account: "https://www.facebook.com/vukim.cuong.71", limit: 10 },
  { action: "list_new_facebook_posts", account: "https://www.facebook.com/vukim.cuong.71/reels/", limit: 20 },
  { action: "list_new_tiktok_videos", account: "https://www.tiktok.com/@diamond.paramita", limit: 20 },
  { action: "list_new_tiktok_videos", account: "https://www.tiktok.com/@ditimchannga", limit: 20 },
  { action: "list_new_youtube_videos", account: "https://www.youtube.com/@enscen", limit: 10 },
  { action: "list_new_tiktok_videos", account: "https://www.tiktok.com/@daotrangquantheam", limit: 20 },
  { action: "list_new_tiktok_videos", account: "https://www.tiktok.com/@ommani.padmehum", limit: 20 },
  { action: "list_new_youtube_videos", account: "https://www.youtube.com/@KimCuongMaster", limit: 10 }
];

async function run() {
  for (const s of sources) {
    try {
      const reader = getReader(s.action);
      const items = await reader.listNew({ account: s.account, limit: s.limit });
      await upsertJobsFromItems(items);
      console.log(`Scanned ${s.account}: ${items.length} items`);
    } catch(e) { console.error(`Error ${s.account}:`, e.message); }
  }
}
run();
