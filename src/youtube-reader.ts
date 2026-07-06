import type { GetItemRequest, ListNewRequest, Reader, SourceItem } from "./types.js";
import { afterSince, runYtDlp, toIso } from "./reader-utils.js";

const DEFAULT_CHANNEL_URL = "https://www.youtube.com/@enscen";

function decodeXml(value = "") {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

function extractEntries(xml: string) {
  return xml.split("<entry>").slice(1).map((part) => part.split("</entry>")[0]);
}

function videoUrl(id: string) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function mapEntry(entry: string): SourceItem {
  const videoId = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1] || "";
  const title = decodeXml(entry.match(/<title>(.*?)<\/title>/s)?.[1] || "").trim();
  const published = entry.match(/<published>(.*?)<\/published>/)?.[1];
  const description = decodeXml(entry.match(/<media:description>(.*?)<\/media:description>/s)?.[1] || "").trim();
  return mapRawVideo({ id: videoId, title, description, timestamp: published, webpage_url: videoUrl(videoId), uploader: "@enscen" }, "@enscen");
}

function mapRawVideo(raw: any, account: string): SourceItem {
  const id = String(raw.id || raw.url || "").replace(/^https?:\/\/.*v=/, "");
  const url = raw.webpage_url || raw.original_url || (id ? videoUrl(id) : raw.url);
  const title = raw.title || "";
  const description = raw.description || raw.fulltitle || raw.title || "";
  return {
    source_platform: "youtube",
    source_account: account,
    source_item_id: id,
    source_url: url,
    published_at: toIso(raw.timestamp || raw.upload_date || raw.release_timestamp),
    title,
    caption_or_text: description,
    original_text: description,
    media_type: "video",
    media_urls: [url].filter(Boolean),
    thumbnail_url: raw.thumbnail || raw.thumbnails?.at?.(-1)?.url || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined),
    author_name: raw.uploader || raw.channel || account,
    raw,
  };
}

function channelTabs(account?: string) {
  const base = (account || DEFAULT_CHANNEL_URL).replace(/\/(videos|streams|live)\/?$/, "");
  return [`${base}/videos`, `${base}/streams`];
}

async function listViaYtDlp(account: string, limit: number) {
  const out: SourceItem[] = [];
  const seen = new Set<string>();
  for (const tab of channelTabs(account)) {
    const result = await runYtDlp(tab, Math.max(limit, 1200), ["--flat-playlist"]);
    for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
      const raw = JSON.parse(line);
      const item = mapRawVideo(raw, account);
      if (!item.source_item_id || seen.has(item.source_item_id)) continue;
      seen.add(item.source_item_id);
      out.push(item);
      // keep scanning all tabs; cap after merge
    }
  }
  return out.slice(0, limit);
}

async function getVideoDetails(item: SourceItem, account: string) {
  try {
    const result = await runYtDlp(item.source_url, 1);
    const line = result.stdout.split(/\r?\n/).find(Boolean);
    if (!line) return item;
    const detailed = mapRawVideo(JSON.parse(line), account);
    return {
      ...item,
      ...detailed,
      source_item_id: item.source_item_id,
      source_url: item.source_url,
      media_urls: detailed.media_urls?.length ? detailed.media_urls : item.media_urls,
      thumbnail_url: detailed.thumbnail_url || item.thumbnail_url,
      original_text: detailed.original_text?.trim() || item.original_text,
      caption_or_text: detailed.caption_or_text?.trim() || item.caption_or_text,
    };
  } catch {
    return item;
  }
}

export class YouTubeReader implements Reader {
  async listNew(request: ListNewRequest): Promise<SourceItem[]> {
    const target = request.account || DEFAULT_CHANNEL_URL;
    const mode = process.env.YOUTUBE_READER_MODE || "ytdlp";
    if (mode === "ytdlp") {
      const items = (await listViaYtDlp(target, request.limit)).filter((item) => afterSince(item, request.since_timestamp)).slice(0, request.limit);
      if (String(process.env.YOUTUBE_FETCH_DETAILS || "false") !== "true") return items;
      const detailed: SourceItem[] = [];
      for (const item of items) detailed.push(await getVideoDetails(item, target));
      return detailed;
    }
    const channelPage = await fetch(`${target.replace(/\/$/, "")}/videos`, { headers: { "user-agent": "Mozilla/5.0" } }).then((res) => res.text());
    const channelId = channelPage.match(/"channelId":"(UC[\w-]+)"/)?.[1] || channelPage.match(/https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)/)?.[1];
    if (!channelId) throw new Error("Cannot resolve YouTube channel id");
    const xml = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: { "user-agent": "Mozilla/5.0" } }).then((res) => res.text());
    return extractEntries(xml).map(mapEntry).filter((item) => afterSince(item, request.since_timestamp)).slice(0, request.limit);
  }

  async getItem(request: GetItemRequest): Promise<SourceItem> {
    if (!request.source_item_id && !request.source_url) throw new Error("source_item_id or source_url required");
    const url = request.source_url || videoUrl(String(request.source_item_id));
    const result = await runYtDlp(url, 1);
    const line = result.stdout.split(/\r?\n/).find(Boolean);
    if (line) return mapRawVideo(JSON.parse(line), request.account || "@enscen");
    const html = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } }).then((res) => res.text());
    const title = html.match(/<title>(.*?)<\/title>/s)?.[1]?.replace(" - YouTube", "") || "";
    const description = html.match(/"shortDescription":"(.*?)"/)?.[1]?.replace(/\\n/g, "\n") || "";
    const videoId = request.source_item_id || url.match(/[?&]v=([^&]+)/)?.[1] || "";
    return mapRawVideo({ id: videoId, title, description, webpage_url: url }, request.account || "@enscen");
  }
}