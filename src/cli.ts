import "dotenv/config";
import fs from "node:fs/promises";
import { GetItemRequestSchema, ListNewRequestSchema, PostRequestSchema } from "./types.js";
import { getPublisher, getReader } from "./publishers.js";
import { filterUnprocessed, markProcessed } from "./state.js";

async function readJsonArg() {
  const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
  if (fileArg) return JSON.parse(await fs.readFile(fileArg.slice("--file=".length), "utf8"));
  const jsonArg = process.argv.find((arg) => arg.startsWith("--json="));
  if (jsonArg) return JSON.parse(jsonArg.slice("--json=".length));
  return {};
}

const command = process.argv[2];
const payload = await readJsonArg();

if (command === "post") {
  const parsed = PostRequestSchema.parse(payload);
  console.log(JSON.stringify(await getPublisher(parsed.platform).publish(parsed), null, 2));
} else if (command === "validate") {
  console.log(JSON.stringify(await getPublisher(String(payload.platform || "")).validate(), null, 2));
} else if (command?.startsWith("list_new_")) {
  const parsed = ListNewRequestSchema.parse(payload);
  let items = await getReader(command).listNew(parsed);
  items = await filterUnprocessed(items);
  if (parsed.mark_seen) await markProcessed(items);
  console.log(JSON.stringify({ ok: true, items }, null, 2));
} else if (command?.startsWith("get_")) {
  const parsed = GetItemRequestSchema.parse(payload);
  console.log(JSON.stringify({ ok: true, item: await getReader(command).getItem(parsed) }, null, 2));
} else {
  console.error("Commands: post | validate | list_new_facebook_posts | get_facebook_post | list_new_tiktok_videos | get_tiktok_video | list_new_youtube_videos | get_youtube_video");
  process.exit(1);
}
