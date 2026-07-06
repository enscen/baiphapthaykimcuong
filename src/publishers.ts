import type { Publisher, Reader } from "./types.js";
import { FacebookPublisher } from "./facebook.js";
import { TikTokPublisher } from "./tiktok.js";
import { FacebookReader } from "./facebook-reader.js";
import { TikTokReader } from "./tiktok-reader.js";
import { YouTubeReader } from "./youtube-reader.js";

export function getPublisher(platform: string): Publisher {
  if (platform === "facebook") return new FacebookPublisher();
  if (platform === "tiktok") return new TikTokPublisher();
  throw new Error(`Unsupported platform: ${platform}`);
}

export function getReader(action: string): Reader {
  if (action.includes("facebook")) return new FacebookReader();
  if (action.includes("tiktok")) return new TikTokReader();
  if (action.includes("youtube")) return new YouTubeReader();
  throw new Error(`Unsupported read action: ${action}`);
}
