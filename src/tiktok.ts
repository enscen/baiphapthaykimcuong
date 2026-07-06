import type { PostRequest, PublishResult, Publisher } from "./types.js";
import { composePostText } from "./content-rules.js";
import { requireEnv } from "./http.js";
import { publishViaAutoSocial } from "./autosocial.js";

export class TikTokPublisher implements Publisher {
  async validate() {
    if (process.env.TIKTOK_PUBLISH_MODE === "autosocial" || process.env.AUTOSOCIAL_ROOT) {
      return { ok: true, message: `AutoSocial mode OK: ${process.env.AUTOSOCIAL_ROOT || "../_research/AutoSocial"}` };
    }
    const accessToken = requireEnv("TIKTOK_ACCESS_TOKEN");
    const response = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`TikTok validate failed: ${JSON.stringify(data)}`);
    return { ok: true, message: "TikTok token OK" };
  }

  async publish(request: PostRequest): Promise<PublishResult> {
    const message = composePostText(request.text, request.append_personal_comment);
    if (process.env.TIKTOK_PUBLISH_MODE === "autosocial" || process.env.AUTOSOCIAL_ROOT) {
      return publishViaAutoSocial(request, message);
    }
    if (request.dryRun) {
      return { platform: "tiktok", ok: true, status: "dry-run", raw: { ...request, final_text: message } };
    }
    if (request.mediaUrls.length !== 1) {
      throw new Error("TikTok API posting requires exactly one public video URL in mediaUrls[0]. Use TIKTOK_PUBLISH_MODE=autosocial for local files.");
    }

    const accessToken = requireEnv("TIKTOK_ACCESS_TOKEN");
    const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: message.slice(0, 150),
          privacy_level: process.env.TIKTOK_PRIVACY_LEVEL || "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: request.mediaUrls[0],
        },
      }),
    });
    const data = await initResponse.json().catch(() => ({}));
    if (!initResponse.ok) throw new Error(`TikTok publish init failed: ${JSON.stringify(data)}`);
    return { platform: "tiktok", ok: true, status: "initialized", raw: data };
  }
}