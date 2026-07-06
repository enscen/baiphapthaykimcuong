import type { PostRequest, PublishResult, Publisher } from "./types.js";
import { composePostText } from "./content-rules.js";
import { graphGet, graphPost, requireEnv } from "./http.js";

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || "v20.0";

export class FacebookPublisher implements Publisher {
  async validate() {
    const pageId = requireEnv("FACEBOOK_PAGE_ID");
    const pageAccessToken = requireEnv("FACEBOOK_PAGE_ACCESS_TOKEN");
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}?fields=id,name&access_token=${pageAccessToken}`;
    const page = await graphGet<{ id: string; name?: string }>(url);
    return { ok: true, message: `Facebook page OK: ${page.name || page.id}` };
  }

  async publish(request: PostRequest): Promise<PublishResult> {
    const message = composePostText(request.text, request.append_personal_comment);
    if (request.dryRun) {
      return { platform: "facebook", ok: true, status: "dry-run", raw: { ...request, final_text: message } };
    }

    const pageId = requireEnv("FACEBOOK_PAGE_ID");
    const pageAccessToken = requireEnv("FACEBOOK_PAGE_ACCESS_TOKEN");

    if (request.mediaUrls.length > 0) {
      const photoIds = [];
      for (const mediaUrl of request.mediaUrls) {
        const photo = await graphPost<{ id: string }>(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`, {
          url: mediaUrl,
          published: false,
          access_token: pageAccessToken,
        });
        photoIds.push({ media_fbid: photo.id });
      }
      const feed = await graphPost<{ id: string }>(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`, {
        message,
        attached_media: photoIds,
        link: request.linkUrl,
        access_token: pageAccessToken,
      });
      return { platform: "facebook", ok: true, id: feed.id, raw: feed };
    }

    const feed = await graphPost<{ id: string }>(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`, {
      message,
      link: request.linkUrl,
      access_token: pageAccessToken,
    });
    return { platform: "facebook", ok: true, id: feed.id, raw: feed };
  }
}