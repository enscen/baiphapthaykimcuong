import { spawn } from "node:child_process";
import type { SourceItem } from "./types.js";

export function normalizeVietnamese(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function toIso(dateLike?: string | number) {
  if (!dateLike) return undefined;
  if (typeof dateLike === "number") return new Date(dateLike * 1000).toISOString();
  if (/^\d{8}$/.test(dateLike)) return `${dateLike.slice(0, 4)}-${dateLike.slice(4, 6)}-${dateLike.slice(6, 8)}T00:00:00.000Z`;
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function afterSince(item: SourceItem, since?: string) {
  if (!since) return true;
  if (!item.published_at) return true;
  return item.published_at > since;
}

export async function runYtDlp(url: string, limit: number, extraArgs: string[] = []) {
  const args = [
    "-m", "yt_dlp",
    "--dump-json",
    "--ignore-errors",
    "--no-warnings",
    "--skip-download",
    "--playlist-end", String(limit),
    ...extraArgs,
    url,
  ];
  return await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    const child = spawn(process.platform === "win32" ? "py" : "python3", args, { windowsHide: true, cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}
