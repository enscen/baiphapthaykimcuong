import type { ContentJob } from "./jobs.js";
import type { SourceItem } from "./types.js";
import { getReader } from "./publishers.js";

function normalize(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isNoiseLine(value = "") {
  const line = value.trim();
  if (!line) return true;
  if (/^\d{1,2}\s+Tháng\s+\d{1,2}/i.test(line)) return true;
  if (/^\d{1,2}\s+Tháng\s+\d{4}/i.test(line)) return true;
  if (/^[❤️💎⭐✨•·\-_=\s]+$/u.test(line)) return true;
  return false;
}

function compactQuery(value = "") {
  return value.replace(/[❤️💎⭐✨•·\-_=]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}

function titleLines(job: ContentJob) {
  const lines = job.original_text.split(/\r?\n/).map((line) => line.trim()).filter((line) => !isNoiseLine(line));
  const title = job.source.title && !isNoiseLine(job.source.title) ? job.source.title : "";
  const candidates = [title, lines[0], lines.slice(0, 2).join(" "), lines.slice(0, 4).join(" ")].filter(Boolean).map(compactQuery);
  return [...new Set(candidates)].slice(0, 4);
}

function unique<T>(items: T[]) { return [...new Set(items)]; }

async function searchBing(query: string) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const html = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } }).then((res) => res.text());
  const urls = Array.from(html.matchAll(/https?:\/\/(?:www\.|m\.)?facebook\.com\/[^"'<>\s]+/g)).map((m) => m[0].replace(/&amp;/g, "&"));
  return unique(urls).filter((url) => /facebook\.com/.test(url)).slice(0, 10);
}

function scoreItem(job: ContentJob, item: SourceItem) {
  const jobText = normalize(job.original_text).slice(0, 1000);
  const itemText = normalize(item.original_text || item.caption_or_text || "");
  const title = normalize(job.source.title || titleLines(job)[0] || "");
  let score = 0;
  if (title && itemText.includes(title)) score += 50;
  for (const line of jobText.split("\n").filter(Boolean).slice(0, 8)) {
    if (line.length > 10 && itemText.includes(line.slice(0, 60))) score += 10;
  }
  score += (item.media_urls?.length || 0) * 20;
  score += Math.min(itemText.length, 2000) / 1000;
  return score;
}

export async function reconcileFacebookJob(job: ContentJob) {
  const candidates: string[] = [];
  if (job.source.source_url && job.source.source_url.includes("facebook.com") && !job.source.source_url.includes("#pasted-")) candidates.push(job.source.source_url);
  const queries = titleLines(job);
  for (const query of queries) {
    candidates.push(...await searchBing(`site:facebook.com/vukim.cuong.71 "${query}"`).catch(() => []));
    candidates.push(...await searchBing(`"${query}" "Vũ Kim Cương"`).catch(() => []));
    candidates.push(...await searchBing(`"${query}" "facebook.com/share/p"`).catch(() => []));
  }
  const checked = unique(candidates).slice(0, 12);
  const mediaItems: SourceItem[] = [];
  for (const url of checked) {
    try {
      const item = await getReader("get_facebook_post").getItem({ source_url: url, account: job.source.source_account });
      if (scoreItem(job, item) >= 20) mediaItems.push(item);
    } catch {}
  }
  const best = mediaItems.sort((a, b) => scoreItem(job, b) - scoreItem(job, a))[0];
  return { query: queries[0] || "", queries, candidates: checked, best };
}
