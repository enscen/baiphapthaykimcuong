import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function agentReachRoot() {
  return path.resolve(process.env.AGENT_REACH_ROOT || path.join(process.cwd(), "..", "_research", "Agent-Reach"));
}

export async function transcribeWithAgentReach(source: string, jobId: string) {
  const root = agentReachRoot();
  const outDir = path.join(process.cwd(), "state", "transcripts");
  await fs.mkdir(outDir, { recursive: true });
  const outputFile = path.join(outDir, `${jobId.replace(/[^a-z0-9._-]+/gi, "-")}.txt`);

  const args = ["-m", "agent_reach.cli", "transcribe", source, "-o", outputFile];
  return await new Promise<{ ok: boolean; outputFile: string; stdout: string; stderr: string; code: number | null }>((resolve) => {
    const child = spawn("py", args, { cwd: root, windowsHide: true, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ ok: code === 0, outputFile, stdout, stderr, code }));
  });
}

export async function readTranscriptIfExists(file: string) {
  try { return await fs.readFile(file, "utf8"); } catch { return ""; }
}