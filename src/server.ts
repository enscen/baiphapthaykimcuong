import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { GetItemRequestSchema, ListNewRequestSchema, PostRequestSchema } from "./types.js";
import { getPublisher, getReader } from "./publishers.js";
import { filterUnprocessed, markProcessed } from "./state.js";
import { createManualJob, deleteJob, getJob, listJobs, updateJob, upsertJobsFromItems } from "./jobs.js";
import { readTranscriptIfExists, transcribeWithAgentReach } from "./agent-reach.js";
import { reconcileFacebookJob } from "./facebook-reconcile.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const agentToken = process.env.AGENT_API_TOKEN;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(process.cwd(), "public")));

app.use((request: Request, response: Response, next: NextFunction) => {
  if (!agentToken) return next();
  if (request.path === "/" || request.path.startsWith("/assets") || request.path.endsWith(".js") || request.path.endsWith(".css")) return next();
  const auth = request.header("authorization") || request.header("x-agent-token");
  if (auth !== `Bearer ${agentToken}` && auth !== agentToken) {
    response.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  next();
});

app.get("/health", (_request: Request, response: Response) => {
  response.json({ ok: true, service: "social-publisher-agent" });
});

app.post("/validate", async (request: Request, response: Response) => {
  try {
    const platform = String(request.body?.platform || "");
    const result = await getPublisher(platform).validate();
    response.json(result);
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/post", async (request: Request, response: Response) => {
  try {
    const payload = PostRequestSchema.parse(request.body);
    const result = await getPublisher(payload.platform).publish(payload);
    response.json(result);
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

function inferCategory(job: any) {
  const raw = `${job.source?.title || ""}\n${job.original_text || ""}`.toLowerCase();
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (text.includes("phap giai thoat")) return "Phap giai thoat";
  if (text.includes("thien")) return "Thien";
  if (text.includes("bat nha") || text.includes("sac tuc thi ko") || text.includes("sac tuc thi khong")) return "Bat Nha";
  if (text.includes("tinh yeu") || text.includes("dai bi")) return "Tinh yeu/Dai bi";
  if (text.includes("vo minh") || text.includes("giai thoat")) return "Giao phap";
  if (text.includes("sinh nhat")) return "Chuc mung";
  if (job.source?.source_platform === "youtube") return "Video phap thoai";
  if (job.source?.source_platform === "tiktok") return "Short video";
  return "Khac";
}

function sortTime(job: any) {
  return job.source?.published_at || job.created_at || job.updated_at || "";
}


function isDecorationLine(line: string) {
  const value = (line || "").trim();
  if (!value) return true;
  if (new RegExp("^\\d{1,2}\\s+Th?ng\\s+\\d{1,2}").test(value)) return true;
  if (new RegExp("^\\d+\\s+(gi?|ph?t|ng?y)$", "i").test(value)) return true;
  if (value === "V? Kim C??ng" || value === "V? Kim C??ng\u200b") return true;
  const stripped = value.replace(new RegExp("[\\s\\-_=?]", "g"), "");
  return stripped.length < 3;
}

function isHeartLine(line: string) {
  const value = (line || "").trim();
  if (!value) return false;
  const letters = value.match(/[A-Za-z?-?]/g) || [];
  return letters.length === 0 && value.length >= 3;
}

function pickFacebookTitle(job: any) {
  const lines = String(job.original_text || "").split(new RegExp("\\r?\\n")).map((line: string) => line.trim()).filter(Boolean);
  const titleLines: string[] = [];
  for (const line of lines) {
    if (line === "V? Kim C??ng" || line === "V? Kim C??ng\u200b") continue;
    if (new RegExp("^\\d+\\s+(gi?|ph?t|ng?y)$", "i").test(line)) continue;
    if (new RegExp("^\\d{1,2}\\s+Th?ng\\s+\\d{1,2}").test(line)) continue;
    if (isHeartLine(line)) break;
    if (line === line.toUpperCase()) titleLines.push(line);
    else if (titleLines.length > 0) break;
  }
  if (titleLines.length > 0) return titleLines.join("\n");
  const firstMeaningful = lines.find((line: string) => !isDecorationLine(line));
  return firstMeaningful || job.source.title || job.id;
}
app.get("/api/jobs", async (request: Request, response: Response) => {
  const query = String(request.query.q || "").trim().toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
  const platform = String(request.query.platform || "").trim();
  const category = String(request.query.category || "").trim();
  const mediaReview = String(request.query.media_review || "").trim();
  let jobs = await listJobs(String(request.query.status || "") || undefined);
  const summaries = jobs.map((job) => ({
    id: job.id,
    status: job.status,
    media_review_status: job.media_review_status || "unknown",
    category: inferCategory(job),
    sort_time: sortTime(job),
    source: {
      source_platform: job.source.source_platform,
      source_account: job.source.source_account,
      source_item_id: job.source.source_item_id,
      source_url: job.source.source_url,
      title: job.source.source_platform === "facebook" ? pickFacebookTitle(job) : job.source.title,
      published_at: job.source.published_at,
    },
    original_text_length: job.original_text.length,
    excerpt: (job.proposed_text || job.original_text || "").slice(0, 220),
    searchable: `${job.source.title || ""}\n${job.original_text || ""}\n${job.source_compare_note || ""}`.toLowerCase(),
    created_at: job.created_at,
    updated_at: job.updated_at,
  })).filter((job) => {
    if (platform && job.source.source_platform !== platform) return false;
    if (category && job.category !== category) return false;
    if (mediaReview && job.media_review_status !== mediaReview) return false;
    if (query && !job.searchable.includes(query)) return false;
    return true;
  }).map(({ searchable, ...job }) => job);
  const counts = {
    total: summaries.length,
    by_platform: summaries.reduce((acc: Record<string, number>, job) => ((acc[job.source.source_platform] = (acc[job.source.source_platform] || 0) + 1), acc), {}),
    by_category: summaries.reduce((acc: Record<string, number>, job) => ((acc[job.category] = (acc[job.category] || 0) + 1), acc), {}),
    needs_review: summaries.filter((job) => job.media_review_status === "needs_review").length,
  };
  response.json({ ok: true, counts, jobs: summaries });
});

app.get("/api/blog/posts", async (request: Request, response: Response) => {
  const platform = String(request.query.platform || "");
  const category = String(request.query.category || "");
  const q = String(request.query.q || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const all = await listJobs();
  const posts = all
    .filter((job) => job.status !== "rejected")
    .map((job) => {
      const text = `${job.source.title || ""}\n${job.original_text || ""}`;
      return {
        id: job.id,
        title: job.source.source_platform === "facebook" ? pickFacebookTitle(job) : (job.source.title || job.original_text.split(/\r?\n/).find(Boolean) || job.id),
        platform: job.source.source_platform,
        category: inferCategory(job),
        media_review_status: job.media_review_status || "unknown",
        source_url: job.source.source_url,
        source_account: job.source.source_account || "",
        thumbnail_url: job.source.thumbnail_url || "",
        published_at: job.source.published_at || job.created_at,
        excerpt: job.original_text.slice(0, 320),
        text_length: job.original_text.length,
        searchable: text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
      };
    })
    .filter((post) => !platform || post.platform === platform)
    .filter((post) => !category || post.category === category)
    .filter((post) => !q || post.searchable.includes(q))
    .sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")))
    .map(({ searchable, ...post }) => post);
  response.json({ ok: true, posts });
});

app.get("/api/blog/posts/:id", async (request: Request, response: Response) => {
  const job = await getJob(String(request.params.id));
  if (!job) return response.status(404).json({ ok: false, error: "Post not found" });
  response.json({
    ok: true,
    post: {
      id: job.id,
      title: job.source.source_platform === "facebook" ? pickFacebookTitle(job) : (job.source.title || job.original_text.split(/\r?\n/).find(Boolean) || job.id),
      platform: job.source.source_platform,
      category: inferCategory(job),
      media_review_status: job.media_review_status || "unknown",
      source_url: job.source.source_url,
      source_account: job.source.source_account || "",
      published_at: job.source.published_at || job.created_at,
      original_text: job.original_text,
      source_compare_note: job.source_compare_note || "",
      media_type: job.source.media_type || "unknown",
      media_urls: job.source.media_urls || [],
      thumbnail_url: job.source.thumbnail_url || "",
    },
  });
});

app.get("/api/jobs/:id", async (request: Request, response: Response) => {
  const job = await getJob(String(request.params.id));
  if (!job) return response.status(404).json({ ok: false, error: "Job not found" });
  response.json({ ok: true, job });
});

app.post("/api/jobs/manual", async (request: Request, response: Response) => {
  try {
    const text = String(request.body?.text || "").trim();
    if (!text) throw new Error("text required");
    response.json({ ok: true, job: await createManualJob(text, String(request.body?.title || "Manual post"), request.body?.source_url, request.body?.source_platform || "facebook") });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});



app.post("/api/jobs/:id/reconcile-facebook", async (request: Request, response: Response) => {
  try {
    const id = String(request.params.id);
    const job = await getJob(id);
    if (!job) return response.status(404).json({ ok: false, error: "Job not found" });
    const result = await reconcileFacebookJob(job);
    if (!result.best) {
      response.json({ ok: false, query: result.query, candidates: result.candidates, error: "No matching Facebook source found" });
      return;
    }
    const mergedSource = {
      ...job.source,
      source_url: result.best.source_url || job.source.source_url,
      media_type: result.best.media_type || job.source.media_type,
      media_urls: result.best.media_urls?.length ? result.best.media_urls : job.source.media_urls,
      thumbnail_url: result.best.thumbnail_url || job.source.thumbnail_url,
      raw: { previous: job.source.raw, reconcile: result },
    };
    const note = `${job.source_compare_note || ""}\n\n[FB reconcile]\nQuery: ${result.query}\nSource: ${result.best.source_url}`.trim();
    const next = await updateJob(id, { source: mergedSource, source_compare_note: note, media_review_status: (result.best.media_urls?.length || 0) > 0 ? "reviewed" : job.media_review_status });
    response.json({ ok: true, result, job: next });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/jobs/:id/transcribe-media", async (request: Request, response: Response) => {
  try {
    const id = String(request.params.id);
    const job = await getJob(id);
    if (!job) return response.status(404).json({ ok: false, error: "Job not found" });
    const source = String(request.body?.source || request.body?.video_file || job.source.source_url || "").trim();
    if (!source) throw new Error("source required");
    const result = await transcribeWithAgentReach(source, id);
    const transcript = result.ok ? await readTranscriptIfExists(result.outputFile) : "";
    const noteAppend = result.ok
      ? `\n\n[Agent-Reach transcript]\n${transcript.slice(0, 4000)}`
      : `\n\n[Agent-Reach error]\n${(result.stderr || result.stdout).slice(0, 1000)}`;
    const next = await updateJob(id, {
      source_compare_note: `${job.source_compare_note || ""}${noteAppend}`.trim(),
      media_review_status: result.ok ? "reviewed" : job.media_review_status,
    });
    response.json({ ok: result.ok, transcript, result, job: next });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/jobs/:id/refresh-source", async (request: Request, response: Response) => {
  try {
    const id = String(request.params.id);
    const job = await getJob(id);
    if (!job) return response.status(404).json({ ok: false, error: "Job not found" });
    const action = job.source.source_platform === "facebook" ? "get_facebook_post" : job.source.source_platform === "tiktok" ? "get_tiktok_video" : "get_youtube_video";
    const item = await getReader(action).getItem({ account: job.source.source_account, source_item_id: job.source.source_item_id, source_url: job.source.source_url });
    const merged = (await upsertJobsFromItems([item])).refreshed?.[0] || (await getJob(id));
    response.json({ ok: true, job: merged, item });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});


app.post("/api/import/pasted-post", async (request: Request, response: Response) => {
  try {
    const text = String(request.body?.text || "").trim();
    if (!text) throw new Error("text required");
    const sourceUrl = String(request.body?.source_url || "https://localhost/pasted-facebook-post");
    const title = String(request.body?.title || text.split(/\r?\n/).find(Boolean)?.slice(0, 120) || "Pasted Facebook post");
    const sourcePlatform = request.body?.source_platform || "facebook";
    if (request.body?.job_id) {
      const current = await getJob(String(request.body.job_id));
      if (!current) throw new Error("job_id not found");
      const replaceProposed = !current.proposed_text || current.proposed_text.trim() === current.original_text.trim();
      const job = await updateJob(String(request.body.job_id), {
        original_text: text,
        proposed_text: replaceProposed ? text : current.proposed_text,
      });
      response.json({ ok: true, mode: "updated", job });
      return;
    }
    const job = await createManualJob(text, title, sourceUrl, sourcePlatform);
    response.json({ ok: true, mode: "created", job });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
app.patch("/api/jobs/:id", async (request: Request, response: Response) => {
  const job = await updateJob(String(request.params.id), request.body || {});
  if (!job) return response.status(404).json({ ok: false, error: "Job not found" });
  response.json({ ok: true, job });
});

app.delete("/api/jobs/:id", async (request: Request, response: Response) => {
  response.json({ ok: await deleteJob(String(request.params.id)) });
});

app.post("/api/jobs/:id/publish", async (request: Request, response: Response) => {
  try {
    const id = String(request.params.id);
    const job = await getJob(id);
    if (!job) return response.status(404).json({ ok: false, error: "Job not found" });
    const platform = String(request.body?.platform || job.platform_targets[0] || "facebook");
    const result = await getPublisher(platform).publish({
      platform: platform as "facebook" | "tiktok",
      text: job.proposed_text || job.original_text,
      append_personal_comment: job.personal_comment,
      mediaUrls: job.source.media_urls || [],
      image_urls: [],
      dryRun: Boolean(request.body?.dryRun),
      video_file: request.body?.video_file,
      file_reference: request.body?.file_reference,
    });
    const next = await updateJob(id, { status: result.ok && !request.body?.dryRun ? "published" : job.status, publish_result: result, published_at: result.ok && !request.body?.dryRun ? new Date().toISOString() : job.published_at });
    response.json({ ok: true, result, job: next });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/scan", async (request: Request, response: Response) => {
  try {
    const sources = Array.isArray(request.body?.sources) ? request.body.sources : ["youtube", "facebook", "tiktok"];
    const limit = Number(request.body?.limit || 10);
    const results = [];
    for (const source of sources) {
      const action = source === "youtube" ? "list_new_youtube_videos" : source === "facebook" ? "list_new_facebook_posts" : "list_new_tiktok_videos";
      const reader = getReader(action);
      const items = await reader.listNew({ limit, account: request.body?.account, mark_seen: false });
      const jobs = await upsertJobsFromItems(items);
      results.push({ source, count: items.length, ...jobs });
    }
    response.json({ ok: true, results });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/actions/:action", async (request: Request, response: Response) => {
  try {
    const action = String(request.params.action || "");
    if (action.startsWith("list_new_")) {
      const payload = ListNewRequestSchema.parse(request.body || {});
      const reader = getReader(action);
      let items = await reader.listNew(payload);
      items = await filterUnprocessed(items);
      if (payload.mark_seen) await markProcessed(items);
      response.json({ ok: true, items });
      return;
    }
    if (action.startsWith("get_")) {
      const payload = GetItemRequestSchema.parse(request.body || {});
      const reader = getReader(action);
      const item = await reader.getItem(payload);
      response.json({ ok: true, item });
      return;
    }
    response.status(404).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});


type AutoScanSource = { label: string; platform: "facebook" | "youtube" | "tiktok"; account: string; limit: number };

const autoScanSources: AutoScanSource[] = [
  { label: "Facebook V? Kim C??ng", platform: "facebook", account: "https://www.facebook.com/vukim.cuong.71", limit: Number(process.env.AUTO_SCAN_FACEBOOK_LIMIT || 20) },
  { label: "TikTok Th?y Kim C??ng", platform: "tiktok", account: "https://www.tiktok.com/@diamond.paramita", limit: Number(process.env.AUTO_SCAN_TIKTOK_LIMIT || 50) },
  { label: "YouTube Enscen", platform: "youtube", account: "https://www.youtube.com/@enscen", limit: Number(process.env.AUTO_SCAN_YOUTUBE_LIMIT || 80) },
  { label: "TikTok ?T Qu?n Th? ?m", platform: "tiktok", account: "https://www.tiktok.com/@daotrangquantheam", limit: Number(process.env.AUTO_SCAN_TIKTOK_LIMIT || 50) },
  { label: "TikTok ?T Qu?n Th? ?m B? T?t", platform: "tiktok", account: "https://www.tiktok.com/@ommani.padmehum", limit: Number(process.env.AUTO_SCAN_TIKTOK_LIMIT || 50) },
  { label: "YouTube Master Kim C??ng", platform: "youtube", account: "https://www.youtube.com/@KimCuongMaster", limit: Number(process.env.AUTO_SCAN_YOUTUBE_LIMIT || 80) },
];

const autoScanState: { running: boolean; last_started_at?: string; last_finished_at?: string; last_error?: string; last_results: unknown[] } = { running: false, last_results: [] };

function scanAction(platform: AutoScanSource["platform"]) {
  return platform === "youtube" ? "list_new_youtube_videos" : platform === "facebook" ? "list_new_facebook_posts" : "list_new_tiktok_videos";
}

async function runAutoScan(reason = "timer") {
  if (autoScanState.running) return { ok: false, skipped: true, reason: "already_running" };
  autoScanState.running = true;
  autoScanState.last_started_at = new Date().toISOString();
  autoScanState.last_error = undefined;
  const results = [];
  try {
    for (const source of autoScanSources) {
      try {
        const reader = getReader(scanAction(source.platform));
        const items = await reader.listNew({ account: source.account, limit: source.limit, mark_seen: false });
        const jobs = await upsertJobsFromItems(items);
        const result = { label: source.label, platform: source.platform, count: items.length, created: jobs.created.length, refreshed: jobs.refreshed.length, skipped: jobs.skipped.length };
        results.push(result);
        console.log(`[auto-scan:${reason}] ${source.label}: found=${result.count} created=${result.created} refreshed=${result.refreshed}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ label: source.label, platform: source.platform, error: message });
        console.warn(`[auto-scan:${reason}] ${source.label} failed: ${message}`);
      }
    }
    autoScanState.last_results = results;
    autoScanState.last_finished_at = new Date().toISOString();
    return { ok: true, results };
  } catch (error) {
    autoScanState.last_error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    autoScanState.running = false;
  }
}

app.get("/api/auto-scan/status", (_request: Request, response: Response) => {
  response.json({ ok: true, enabled: process.env.AUTO_SCAN_ENABLED !== "false", interval_minutes: Number(process.env.AUTO_SCAN_INTERVAL_MINUTES || 60), state: autoScanState, sources: autoScanSources });
});

app.post("/api/auto-scan/run", async (_request: Request, response: Response) => {
  try {
    const result = await runAutoScan("manual");
    response.json(result);
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

function startAutoScanScheduler() {
  if (process.env.AUTO_SCAN_ENABLED === "false") {
    console.log("auto-scan disabled");
    return;
  }
  const intervalMinutes = Number(process.env.AUTO_SCAN_INTERVAL_MINUTES || 60);
  const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;
  console.log(`auto-scan enabled: every ${intervalMinutes} minutes`);
  setTimeout(() => runAutoScan("startup").catch((error) => console.warn("auto-scan startup failed", error)), 15000);
  setInterval(() => runAutoScan("timer").catch((error) => console.warn("auto-scan timer failed", error)), intervalMs);
}

app.listen(port, () => {
  console.log(`social-publisher-agent listening on http://127.0.0.1:${port}`);
  startAutoScanScheduler();
});

