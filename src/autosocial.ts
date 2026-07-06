import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { PostRequest, PublishResult } from "./types.js";

const execFileAsync = promisify(execFile);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv"]);

function requireAutoSocialRoot() {
  const root = process.env.AUTOSOCIAL_ROOT || path.resolve(process.cwd(), "..", "_research", "AutoSocial");
  return path.resolve(root);
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "video";
}

function resolveQueueDir(root: string) {
  const queue = process.env.AUTOSOCIAL_TIKTOK_QUEUE_DIR || "queue/default/tiktok/pending";
  return path.isAbsolute(queue) ? queue : path.join(root, queue);
}

export async function publishViaAutoSocial(request: PostRequest, finalText: string): Promise<PublishResult> {
  const root = requireAutoSocialRoot();
  const videoFile = request.video_file || request.file_reference;
  if (!videoFile) {
    return {
      platform: "tiktok",
      ok: false,
      status: "draft-required-local-video",
      raw: { message: "AutoSocial requires local video_file/file_reference. Remote video_url/mediaUrls not copied automatically." },
    };
  }

  const sourcePath = path.resolve(videoFile);
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`AutoSocial video file not found: ${sourcePath}`);

  const ext = path.extname(sourcePath).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(ext)) throw new Error(`Unsupported AutoSocial video extension: ${ext}`);

  const queueDir = resolveQueueDir(root);
  await fs.mkdir(queueDir, { recursive: true });
  const targetBase = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeName(path.basename(sourcePath, ext))}`;
  const targetVideo = path.join(queueDir, `${targetBase}${ext}`);
  const targetCaption = path.join(queueDir, `${targetBase}.txt`);

  if (!request.dryRun) {
    await fs.copyFile(sourcePath, targetVideo);
    await fs.writeFile(targetCaption, finalText, "utf8");
  }

  const publishNow = process.env.AUTOSOCIAL_TIKTOK_PUBLISH_NOW === "true";
  if (!publishNow || request.dryRun) {
    return {
      platform: "tiktok",
      ok: true,
      status: request.dryRun ? "autosocial-dry-run" : "autosocial-draft-created",
      raw: { root, queueDir, targetVideo, targetCaption, final_text: finalText },
    };
  }

  const { stdout, stderr } = await execFileAsync("npm.cmd", ["run", "post", "--", "--video", targetVideo, "--caption", finalText], {
    cwd: root,
    windowsHide: true,
    timeout: Number(process.env.AUTOSOCIAL_POST_TIMEOUT_MS || 600000),
  });

  return {
    platform: "tiktok",
    ok: true,
    status: "autosocial-post-command-finished",
    raw: { root, targetVideo, stdout, stderr },
  };
}