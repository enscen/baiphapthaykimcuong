import fs from "node:fs/promises";
import path from "node:path";
import type { Platform, SourceItem } from "./types.js";

const stateDir = path.join(process.cwd(), "state");
const stateFile = path.join(stateDir, "processed-items.json");

type State = Record<string, { processed_at: string; source_url?: string }>;

function key(platform: Platform, itemId: string) {
  return `${platform}:${itemId}`;
}

async function readState(): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8")) as State;
  } catch {
    return {};
  }
}

async function writeState(state: State) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function filterUnprocessed(items: SourceItem[]) {
  const state = await readState();
  return items.filter((item) => !state[key(item.source_platform, item.source_item_id)]);
}

export async function markProcessed(items: SourceItem[]) {
  const state = await readState();
  const now = new Date().toISOString();
  for (const item of items) {
    state[key(item.source_platform, item.source_item_id)] = { processed_at: now, source_url: item.source_url };
  }
  await writeState(state);
}

export async function isProcessed(platform: Platform, itemId: string) {
  const state = await readState();
  return Boolean(state[key(platform, itemId)]);
}
