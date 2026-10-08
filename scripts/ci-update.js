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
    let items = result.items;
    if (result.source.account.includes("ditimchannga")) {
      items = items.filter((it) => {
        const text = `${it.title || ''} ${it.caption_or_text || ''} ${it.original_text || ''}`.toLowerCase();
        const challenges = (it.raw?.challenges || []).map((c) => String(c.title || "").toLowerCase());
        const textExtra = (it.raw?.textExtra || []).map((t) => String(t.hashtagName || "").toLowerCase());
        return /#thaykimcuong\b/i.test(text) || challenges.includes("thaykimcuong") || textExtra.includes("thaykimcuong");
      });
    }
    await upsertJobsFromItems(items);
    console.log(`Scanned ${result.source.account}: ${items.length} items`);
  }
}

await run();
