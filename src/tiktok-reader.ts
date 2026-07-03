import type { GetItemRequest, ListNewRequest, Reader, SourceItem } from "./types.js";
import { afterSince, runYtDlp, toIso } from "./reader-utils.js";

const DEFAULT_URL = "https://www.tiktok.com/@diamond.paramita";

function mapYtDlpItem(raw: any, account: string): SourceItem {
  const sourceUrl = raw.webpage_url || raw.original_url || raw.url;
  const formatUrls = Array.isArray(raw.formats) ? raw.formats.map((format: any) => format?.url).filter(Boolean) : [];
  const mediaUrls = [...new Set([...formatUrls.slice(0, 2), sourceUrl].filter(Boolean))];
  return {
    source_platform: "tiktok",
    source_account: account,
    source_item_id: String(raw.id),
    source_url: sourceUrl,
    published_at: toIso(raw.timestamp || raw.upload_date),
    title: raw.title || "",
    caption_or_text: raw.description || raw.title || "",
    original_text: raw.description || raw.title || "",
    media_type: "video",
    media_urls: mediaUrls,
    thumbnail_url: raw.thumbnail,
    author_name: raw.uploader || raw.channel || account,
    raw,
  };
}

export class TikTokReader implements Reader {
  async listNew(request: ListNewRequest): Promise<SourceItem[]> {
    const target = request.account || DEFAULT_URL;
    const result = await runYtDlp(target, request.limit);
    const items = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).map((raw) => mapYtDlpItem(raw, target)).filter((item) => afterSince(item, request.since_timestamp)).slice(0, request.limit);
    return items;
  }

  async getItem(request: GetItemRequest): Promise<SourceItem> {
    const target = request.source_url || `https://www.tiktok.com/@diamond.paramita/video/${request.source_item_id}`;
    const result = await runYtDlp(target, 1);
    const line = result.stdout.split(/\r?\n/).find(Boolean);
    if (!line) throw new Error(`TikTok item not found: ${result.stderr}`);
    return mapYtDlpItem(JSON.parse(line), request.account || DEFAULT_URL);
  }
}
