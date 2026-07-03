import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SourceItem } from "./types.js";

export type JobStatus = "draft" | "approved" | "rejected" | "published" | "failed";
export type MediaReviewStatus = "unknown" | "needs_review" | "reviewed";

export type ContentJob = {
  id: string;
  status: JobStatus;
  source: SourceItem;
  platform_targets: string[];
  original_text: string;
  proposed_text: string;
  personal_comment: string;
  media_review_status?: MediaReviewStatus;
  source_compare_note?: string;
  created_at: string;
  updated_at: string;
  published_at?: string;
  publish_result?: unknown;
  error?: string;
};

const stateDir = path.join(process.cwd(), "state");
const jobsFile = path.join(stateDir, "jobs.json");

type JobsState = Record<string, ContentJob>;

function now() { return new Date().toISOString(); }
function jobKey(item: SourceItem) { return `${item.source_platform}:${item.source_item_id}`; }
function bestText(item: SourceItem) { return item.original_text || item.caption_or_text || item.title || ""; }

async function readJobs(): Promise<JobsState> {
  try { return JSON.parse(await fs.readFile(jobsFile, "utf8")) as JobsState; } catch { return {}; }
}
async function writeJobs(jobs: JobsState) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(jobsFile, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
}

export async function listJobs(status?: string) {
  const jobs = Object.values(await readJobs()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return status ? jobs.filter((job) => job.status === status) : jobs;
}
export async function getJob(id: string) { return (await readJobs())[id] || null; }

export async function upsertJobsFromItems(items: SourceItem[]) {
  const jobs = await readJobs();
  const created: ContentJob[] = [];
  const skipped: ContentJob[] = [];
  const refreshed: ContentJob[] = [];
  for (const item of items) {
    const id = jobKey(item);
    const text = bestText(item);
    const existing = jobs[id];
    if (existing) {
      const oldLen = (existing.original_text || "").length;
      const newLen = text.length;
      const oldMedia = existing.source?.media_urls?.length || 0;
      const newMedia = item.media_urls?.length || 0;
      const shouldRefresh = newLen > oldLen || newMedia > oldMedia || item.thumbnail_url && item.thumbnail_url !== existing.source?.thumbnail_url;
      if (shouldRefresh) {
        const shouldReplaceProposed = (existing.proposed_text || "").trim() === (existing.original_text || "").trim();
        jobs[id] = { ...existing, source: item, original_text: newLen > oldLen ? text : existing.original_text, proposed_text: shouldReplaceProposed && newLen > oldLen ? text : existing.proposed_text, updated_at: now() };
        refreshed.push(jobs[id]);
      } else skipped.push(existing);
      continue;
    }
    const job: ContentJob = {
      id,
      status: "draft",
      source: item,
      platform_targets: item.source_platform === "youtube" ? ["facebook", "tiktok"] : ["facebook"],
      original_text: text,
      proposed_text: text,
      personal_comment: "",
      media_review_status: "unknown",
      source_compare_note: "",
      created_at: now(),
      updated_at: now(),
    };
    jobs[id] = job;
    created.push(job);
  }
  await writeJobs(jobs);
  return { created, skipped, refreshed };
}

export async function updateJob(id: string, patch: Partial<Pick<ContentJob, "status" | "source" | "original_text" | "proposed_text" | "personal_comment" | "platform_targets" | "media_review_status" | "source_compare_note" | "publish_result" | "error" | "published_at">>) {
  const jobs = await readJobs();
  const job = jobs[id];
  if (!job) return null;
  jobs[id] = { ...job, ...patch, updated_at: now() };
  await writeJobs(jobs);
  return jobs[id];
}

export async function deleteJob(id: string) {
  const jobs = await readJobs();
  const existed = Boolean(jobs[id]);
  delete jobs[id];
  await writeJobs(jobs);
  return existed;
}

export function newManualJob(text: string, title = "Manual post", sourceUrl = "https://localhost/manual", sourcePlatform: "facebook" | "tiktok" | "youtube" = "facebook"): ContentJob {
  const id = `manual:${randomUUID()}`;
  const item: SourceItem = { source_platform: sourcePlatform, source_account: "manual", source_item_id: id, source_url: sourceUrl, published_at: now(), title, caption_or_text: text, original_text: text, media_type: "text", media_urls: [], author_name: "manual" };
  return { id, status: "draft", source: item, platform_targets: ["facebook"], original_text: text, proposed_text: text, personal_comment: "", media_review_status: "unknown", source_compare_note: "", created_at: now(), updated_at: now() };
}

export async function createManualJob(text: string, title?: string, sourceUrl?: string, sourcePlatform?: "facebook" | "tiktok" | "youtube") {
  const jobs = await readJobs();
  const job = newManualJob(text, title, sourceUrl, sourcePlatform);
  jobs[job.id] = job;
  await writeJobs(jobs);
  return job;
}