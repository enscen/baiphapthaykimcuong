import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import type { GetItemRequest, ListNewRequest, Reader, SourceItem } from "./types.js";
import { afterSince, runYtDlp, toIso } from "./reader-utils.js";

const DEFAULT_URL = "https://www.facebook.com/vukim.cuong.71";

function defaultBraveExe() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    path.join(process.env.ProgramFiles || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
  ];
  return candidates.find(Boolean) || "";
}

function defaultBraveUserDataDir() {
  return path.join(process.env.LOCALAPPDATA || "", "BraveSoftware", "Brave-Browser", "User Data");
}

function cleanText(value = "") {
  let text = value
    .replace(/See more|Xem.{0,4}th.m|.n b.t/gi, "")
    .replace(/\r/g, "")
    .trim();
  const cutRegexes = [
    /T.t c. c.m x.c:[\s\S]*$/i,
    /All reactions:[\s\S]*$/i,
    /\n\d+[\s\S]{0,80}\nTh.ch\s*\nB.nh lu.n[\s\S]*$/i,
    /\nLike\s*\nComment[\s\S]*$/i,
    /\nB.nh lu.n[\s\S]*$/i,
    /\nComment[\s\S]*$/i,
  ];
  for (const regex of cutRegexes) text = text.replace(regex, "");
  return text.replace(/\n\s*\u00b7\s*\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function mapYtDlpItem(raw: any, account: string): SourceItem {
  return {
    source_platform: "facebook",
    source_account: account,
    source_item_id: String(raw.id || raw.webpage_url || raw.url),
    source_url: raw.webpage_url || raw.original_url || raw.url,
    published_at: toIso(raw.timestamp || raw.upload_date),
    title: raw.title || "",
    caption_or_text: cleanText(raw.description || raw.title || ""),
    original_text: cleanText(raw.description || raw.title || ""),
    media_type: raw.ext ? "video" : "text",
    media_urls: [raw.webpage_url || raw.url].filter(Boolean),
    thumbnail_url: raw.thumbnail || undefined,
    author_name: raw.uploader || account,
    raw,
  };
}


function parseCookieHeader(header: string) {
  return header.split(/;\s*/).map((pair) => pair.split('=', 2)).filter(([name, value]) => name && value).map(([name, value]) => ({
    name,
    value,
    domain: ".facebook.com",
    path: "/",
    secure: true,
    httpOnly: false,
    sameSite: "Lax" as const,
  }));
}

async function cookieFileFromHeader(header: string) {
  const file = path.join(os.tmpdir(), `facebook-cookies-${Date.now()}.txt`);
  const lines = ['# Netscape HTTP Cookie File', ...header.split(/;\s*/).map((pair) => pair.split('=', 2)).filter(([name, value]) => name && value).map(([name, value]) => `facebook.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`)];
  await fs.writeFile(file, lines.join("\n") + "\n", 'utf8');
  return file;
}

function browserCookieArgs() {
  const browser = process.env.FACEBOOK_COOKIES_BROWSER || "brave";
  const profileRoot = process.env.BRAVE_USER_DATA_DIR || defaultBraveUserDataDir();
  const profile = process.env.BRAVE_PROFILE_DIRECTORY || "Default";
  return ["--cookies-from-browser", `${browser}:${profileRoot}:${profile}`];
}

async function browserProfileAvailable() {
  if (process.env.FACEBOOK_USE_PLAYWRIGHT_CHROMIUM === "1") {
    return { userDataDir: "", exe: chromium.executablePath() };
  }
  const userDataDir = process.env.BRAVE_USER_DATA_DIR || defaultBraveUserDataDir();
  const exe = process.env.BRAVE_EXECUTABLE_PATH || defaultBraveExe();
  try {
    await fs.access(userDataDir);
    await fs.access(exe);
    return { userDataDir, exe };
  } catch {
    return null;
  }
}

async function withFacebookBrowser<T>(fn: (context: BrowserContext) => Promise<T>) {
  const profile = await browserProfileAvailable();
  if (!profile) throw new Error("Browser not found. Set Brave env locally or FACEBOOK_USE_PLAYWRIGHT_CHROMIUM=1 on CI.");
  const tempUserDataDir = path.join(process.cwd(), ".runtime", "facebook-reader");
  await fs.mkdir(tempUserDataDir, { recursive: true });
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(tempUserDataDir, {
      executablePath: profile.exe,
      headless: true,
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      viewport: { width: 1280, height: 900 },
      locale: "vi-VN",
    });
    const cookieHeader = process.env.FACEBOOK_COOKIE_HEADER || process.env.FACEBOOK_COOKIES || '';
    if (cookieHeader) {
      try {
        await context.addCookies(parseCookieHeader(cookieHeader));
      } catch {}
    }
    return await fn(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Facebook browser reader failed: ${message}`);
  } finally {
    await context?.close().catch(() => undefined);
  }
}

function extractPostId(url: string, index: number) {
  return url.match(/(?:posts|videos|reel|watch|permalink|story_fbid=)[/=]?([0-9A-Za-z_-]+)/)?.[1] || `${url}#${index}`;
}

function facebookPublishedAt(text: string) {
  const line = cleanText(text).split("\n").map((value) => value.trim()).find((value) => /^\d+\s*(phút|giờ|ngày|tuần|tháng)$/i.test(value));
  const match = line?.match(/^(\d+)\s*(phút|giờ|ngày|tuần|tháng)$/i);
  if (!match) return undefined;
  const date = new Date();
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "phút") date.setMinutes(date.getMinutes() - amount);
  else if (unit === "giờ") date.setHours(date.getHours() - amount);
  else if (unit === "ngày") date.setDate(date.getDate() - amount);
  else if (unit === "tuần") date.setDate(date.getDate() - amount * 7);
  else if (unit === "tháng") date.setMonth(date.getMonth() - amount);
  return date.toISOString();
}

function facebookTitle(text: string) {
  const noise = /^(Vũ Kim Cương|Thầy Kim Cương|Facebook Thầy Kim Cương|\d+\s*(phút|giờ|ngày|tuần|tháng))$/i;
  return cleanText(text).split("\n").map((value) => value.trim()).find((value) => value && !noise.test(value))?.slice(0, 120) || "Facebook post";
}


async function expandSeeMore(page: Page) {
  for (let i = 0; i < 12; i += 1) {
    const clicked = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('div,span,a,[role="button"]')) as HTMLElement[];
      const target = nodes.find((node) => {
        const text = (node.innerText || node.textContent || "").trim().toLowerCase();
        return text === "see more" || text.includes("xem th?m") || text.includes("xem them");
      });
      if (!target) return false;
      target.click();
      return true;
    }).catch(() => false);
    if (!clicked) break;
    await page.waitForTimeout(500);
  }
}


function cleanReelText(value = "") {
  const lines = cleanText(value).split("\n").map((line) => line.trim()).filter(Boolean);
  const drop = /^(.*Số thông báo|\d+$|Vũ Kim Cương|Thầy Kim Cương|Đang theo dõi|Tạo thước phim|Reels|Xem thêm)$/i;
  const kept = lines.filter((line) => !drop.test(line));
  return kept.join("\n").replace(/…\s*Xem thêm$/i, "").trim();
}

async function readReelText(page: Page) {
  await expandSeeMore(page);
  return page.evaluate(() => document.body.innerText || "");
}

async function readFirstArticle(page: Page) {
  await expandSeeMore(page);
  return page.evaluate(() => {
    const pickImage = (root: ParentNode | null) => {
      const images = Array.from(root?.querySelectorAll('img[src]') || []) as HTMLImageElement[];
      return images
        .map((img) => ({ src: img.src, area: (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0) }))
        .filter((img) => /scontent|fbcdn\.net/i.test(img.src) && !/emoji\.php|static\.xx\.fbcdn\.net/i.test(img.src))
        .sort((a, b) => b.area - a.area)[0]?.src;
    };
    const pickVideo = (root: ParentNode | null) => {
      const direct = Array.from(root?.querySelectorAll('video[src], video source[src], a[href]') || []) as Array<HTMLVideoElement | HTMLSourceElement | HTMLAnchorElement>;
      const link = direct.map((node) => node instanceof HTMLAnchorElement ? node.href : node.src).find((src) => /^https?:/.test(src) && /\.mp4|video|fbcdn/i.test(src));
      if (link) return link;
      const html = (root as HTMLElement | null)?.innerHTML || document.documentElement.innerHTML;
      const escaped = html.match(/"(?:browser_native_hd_url|browser_native_sd_url|playable_url(?:_quality_hd)?)":"([^"]+)"/)?.[1];
      return escaped ? escaped.replace(/\\\//g, "/").replace(/\\u0025/g, "%") : undefined;
    };
    const article = document.querySelector('[role="article"]') as HTMLElement | null;
    const text = article?.innerText || document.body.innerText || "";
    const video = pickVideo(article);
    const img = pickImage(article);
    return { text, img: img || undefined, video: video || undefined };
  });
}

async function scrapeProfile(account: string, limit: number): Promise<SourceItem[]> {
  return withFacebookBrowser(async (context) => {
    const page = await context.newPage();
    await page.goto(account, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    await expandSeeMore(page);
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(900);
      await expandSeeMore(page);
    }

    if (/\/reels\/?$/i.test(account)) {
      const reels = await page.evaluate((max) => {
        const seen = new Set<string>();
        const out: Array<{ url: string; img?: string; text?: string }> = [];
        const anchors = Array.from(document.querySelectorAll('a[href*="/reel/"][href*="fb_shorts_profile"]')) as HTMLAnchorElement[];
        for (const anchor of anchors) {
          const url = anchor.href.split('?')[0];
          if (!/facebook\.com\/reel\/\d+/.test(url) || seen.has(url)) continue;
          seen.add(url);
          let root: Element | null = anchor;
          for (let i = 0; i < 5 && root && !root.querySelector('img[src]'); i += 1) root = root.parentElement;
          const img = (root?.querySelector('img[src]') as HTMLImageElement | null)?.src;
          out.push({ url, img: img && /scontent|fbcdn\.net/i.test(img) ? img : undefined, text: (root as HTMLElement | null)?.innerText || anchor.innerText || "" });
          if (out.length >= max) break;
        }
        return out;
      }, limit);

      const detailed = [] as Array<{ url: string; img?: string; text?: string }>;
      for (const reel of reels) {
        const detail = await context.newPage();
        try {
          await detail.goto(reel.url, { waitUntil: "domcontentloaded", timeout: 60000 });
          await detail.waitForTimeout(3000);
          const text = cleanReelText(await readReelText(detail));
          detailed.push({ ...reel, text: text || cleanReelText(reel.text || "") });
        } catch {
          detailed.push({ ...reel, text: cleanReelText(reel.text || "") });
        } finally {
          await detail.close().catch(() => undefined);
        }
      }

      return detailed.map((reel, index) => ({
        source_platform: "facebook" as const,
        source_account: account,
        source_item_id: extractPostId(reel.url, index),
        source_url: reel.url,
        published_at: undefined,
        title: cleanReelText(reel.text || "").split("\n").find(Boolean) || "Facebook Reel Thầy Kim Cương",
        caption_or_text: cleanReelText(reel.text || ""),
        original_text: cleanReelText(reel.text || ""),
        media_type: "video" as const,
        media_urls: [reel.url],
        thumbnail_url: reel.img || undefined,
        author_name: account,
        raw: reel,
      }));
    }

    const posts = await page.evaluate((max) => {
      const pickImage = (root: ParentNode | null) => {
        const images = Array.from(root?.querySelectorAll('img[src]') || []) as HTMLImageElement[];
        return images
          .map((img) => ({ src: img.src, area: (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0) }))
          .filter((img) => /scontent|fbcdn\.net/i.test(img.src) && !/emoji\.php|static\.xx\.fbcdn\.net/i.test(img.src))
          .sort((a, b) => b.area - a.area)[0]?.src;
      };
      const pickVideo = (root: ParentNode | null) => {
        const direct = Array.from(root?.querySelectorAll('video[src], video source[src], a[href]') || []) as Array<HTMLVideoElement | HTMLSourceElement | HTMLAnchorElement>;
        const link = direct.map((node) => node instanceof HTMLAnchorElement ? node.href : node.src).find((src) => /^https?:/.test(src) && /\.mp4|video|fbcdn/i.test(src));
        if (link) return link;
        const html = (root as HTMLElement | null)?.innerHTML || document.documentElement.innerHTML;
        const escaped = html.match(/"(?:browser_native_hd_url|browser_native_sd_url|playable_url(?:_quality_hd)?)":"([^"]+)"/)?.[1];
        return escaped ? escaped.replace(/\\\//g, "/").replace(/\\u0025/g, "%") : undefined;
      };
      const articles = Array.from(document.querySelectorAll('[role="article"]'));
      const out: Array<{ text: string; url: string; img?: string; video?: string }> = [];
      for (const article of articles) {
        const text = (article as HTMLElement).innerText || "";
        if (!text || text.length < 80) continue;
        const anchors = Array.from(article.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        const href = anchors.map((a) => a.href).find((value) => /facebook\.com\/.+\/(posts|videos|reel|watch|permalink)|story_fbid=/.test(value)) || anchors[0]?.href || location.href;
        const img = pickImage(article);
        const video = pickVideo(article);
        out.push({ text, url: href, img: img || undefined, video: video || undefined });
        if (out.length >= max) break;
      }
      return out;
    }, limit);

    const enriched: Array<{ text: string; url: string; img?: string; video?: string }> = [];
    for (const post of posts) {
      let full = post;
      if ((post.text.includes("Xem") || post.text.includes("See more") || post.text.includes("...") || post.text.includes("?")) && post.url) {
        const detail = await context.newPage();
        try {
          await detail.goto(post.url, { waitUntil: "domcontentloaded", timeout: 60000 });
          await detail.waitForTimeout(3500);
          const article = await readFirstArticle(detail);
          if (cleanText(article.text).length > cleanText(post.text).length) {
            full = { ...post, text: article.text, img: article.img || post.img, video: article.video || post.video };
          }
        } catch {
          full = post;
        } finally {
          await detail.close().catch(() => undefined);
        }
      }
      enriched.push(full);
    }

    return enriched.map((post, index) => ({
      source_platform: "facebook" as const,
      source_account: account,
      source_item_id: extractPostId(post.url, index),
      source_url: post.url,
      published_at: facebookPublishedAt(post.text),
      title: facebookTitle(post.text),
      caption_or_text: cleanText(post.text),
      original_text: cleanText(post.text),
      media_type: post.video ? "video" : post.img ? "image" : "text",
      media_urls: [post.video, post.img].filter(Boolean) as string[],
      thumbnail_url: post.img || undefined,
      author_name: account,
      raw: post,
    }));
  });
}

async function scrapeSingle(url: string, account: string): Promise<SourceItem> {
  return withFacebookBrowser(async (context) => {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    const article = await readFirstArticle(page);
    const text = article.text;
    const img = article.img;
    const video = article.video;
    return {
      source_platform: "facebook",
      source_account: account,
      source_item_id: extractPostId(url, 0),
      source_url: url,
      published_at: facebookPublishedAt(text),
      title: facebookTitle(text),
      caption_or_text: cleanText(text),
      original_text: cleanText(text),
      media_type: video ? "video" : img ? "image" : "text",
      media_urls: [video, img].filter(Boolean) as string[],
      thumbnail_url: img || undefined,
      author_name: account,
      raw: { text, img, video },
    };
  });
}

export class FacebookReader implements Reader {
  async listNew(request: ListNewRequest): Promise<SourceItem[]> {
    const target = request.account || DEFAULT_URL;
    const mode = process.env.FACEBOOK_READER_MODE || "browser";
    if (mode === "browser") {
      return (await scrapeProfile(target, request.limit)).filter((item) => afterSince(item, request.since_timestamp)).slice(0, request.limit);
    }
    let extra = mode === "cookies" || mode === "hybrid" ? browserCookieArgs() : [];
    const cookieHeader = process.env.FACEBOOK_COOKIE_HEADER || process.env.FACEBOOK_COOKIES || "";
    if (cookieHeader) {
      try {
        extra = ["--cookies", await cookieFileFromHeader(cookieHeader)];
      } catch {}
    }
    try {
      const result = await runYtDlp(target, request.limit, extra);
      const items = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).map((raw) => mapYtDlpItem(raw, target)).filter((item) => afterSince(item, request.since_timestamp)).slice(0, request.limit);
      if (items.length > 0 || mode !== "hybrid") return items;
    } catch (error) {
      if (mode === "cookies") throw error;
    }
    return (await scrapeProfile(target, request.limit)).filter((item) => afterSince(item, request.since_timestamp)).slice(0, request.limit);
  }

  async getItem(request: GetItemRequest): Promise<SourceItem> {
    const target = request.source_url;
    if (!target) throw new Error("Facebook getItem requires source_url");
    const mode = process.env.FACEBOOK_READER_MODE || "browser";
    if (mode === "browser") return scrapeSingle(target, request.account || DEFAULT_URL);
    let extra = mode === "cookies" || mode === "hybrid" ? browserCookieArgs() : [];
    const cookieHeader = process.env.FACEBOOK_COOKIE_HEADER || process.env.FACEBOOK_COOKIES || "";
    if (cookieHeader) {
      try {
        extra = ["--cookies", await cookieFileFromHeader(cookieHeader)];
      } catch {}
    }
    try {
      const result = await runYtDlp(target, 1, extra);
      const line = result.stdout.split(/\r?\n/).find(Boolean);
      if (line) return mapYtDlpItem(JSON.parse(line), request.account || DEFAULT_URL);
      if (mode === "cookies") throw new Error(`Facebook item not found: ${result.stderr}`);
    } catch (error) {
      if (mode === "cookies") throw error;
    }
    return scrapeSingle(target, request.account || DEFAULT_URL);
  }
}
