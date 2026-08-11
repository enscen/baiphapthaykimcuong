import fs from "fs";
import { getReader } from "../dist/publishers.js";
import { upsertJobsFromItems } from "../dist/jobs.js";

const sources = [
  { action: "list_new_facebook_posts", account: "https://www.facebook.com/vukim.cuong.71", limit: 50 },
  { action: "list_new_facebook_posts", account: "https://www.facebook.com/vukim.cuong.71/reels/", limit: 20 },
  { action: "list_new_tiktok_videos", account: "https://www.tiktok.com/@diamond.paramita", limit: 80 },
  { action: "list_new_tiktok_videos", account: "https://www.tiktok.com/@ditimchannga", limit: 60 },
  { action: "list_new_youtube_videos", account: "https://www.youtube.com/@enscen", limit: 10 },
  { action: "list_new_tiktok_videos", account: "https://www.tiktok.com/@daotrangquantheam", limit: 60 },
  { action: "list_new_tiktok_videos", account: "https://www.tiktok.com/@ommani.padmehum", limit: 60 },
  { action: "list_new_youtube_videos", account: "https://www.youtube.com/@KimCuongMaster", limit: 10 }
];

async function scan(source) {
  try {
    const reader = getReader(source.action);
    return { source, items: await reader.listNew({ account: source.account, limit: source.limit }) };
  } catch (error) {
    console.error(`Error ${source.account}:`, error.message);
    return null;
  }
}

async function run() {
  const facebook = sources.filter((source) => source.action.includes("facebook"));
  const others = sources.filter((source) => !source.action.includes("facebook"));
  const [facebookResults, otherResults] = await Promise.all([
    (async () => { const results = []; for (const source of facebook) results.push(await scan(source)); return results; })(),
    Promise.all(others.map(scan)),
  ]);
  for (const result of [...facebookResults, ...otherResults]) {
    if (!result) continue;
    await upsertJobsFromItems(result.items);
    console.log(`Scanned ${result.source.account}: ${result.items.length} items`);
  }
}

await run();
