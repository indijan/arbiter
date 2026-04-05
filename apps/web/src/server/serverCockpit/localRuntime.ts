import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_ROOT = process.env.ARBITER_ROOT_DIR || "/Users/indijan/Projects/arbiter";
const DEFAULT_STATE_DIR = process.env.ARBITER_STATE_DIR || path.join(process.env.HOME || "", ".arbiter");

function ensureSafeRoot(rootDir: string) {
  // Guardrail: only allow running commands inside the repo root we expect.
  if (!rootDir.startsWith("/Users/")) {
    throw new Error("Invalid ARBITER_ROOT_DIR");
  }
}

export type ProcState = { running: boolean; pid: number | null };
export type RuntimeStatus = {
  web: ProcState;
  runner: ProcState;
  caffeinate: ProcState;
  logs: { webErr: string; runnerOut: string };
};

async function readPid(file: string): Promise<number | null> {
  try {
    const raw = (await fs.readFile(file, "utf8")).trim();
    const pid = Number(raw);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isRunning(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const rootDir = process.env.ARBITER_ROOT_DIR || DEFAULT_ROOT;
  ensureSafeRoot(rootDir);

  const stateDir = DEFAULT_STATE_DIR;
  const pidDir = path.join(stateDir, "pids");
  const logDir = path.join(stateDir, "logs");

  const webPid = await readPid(path.join(pidDir, "web.pid"));
  const runnerPid = await readPid(path.join(pidDir, "runner.pid"));
  const caffPid = await readPid(path.join(pidDir, "caffeinate.pid"));

  return {
    web: { pid: webPid, running: isRunning(webPid) },
    runner: { pid: runnerPid, running: isRunning(runnerPid) },
    caffeinate: { pid: caffPid, running: isRunning(caffPid) },
    logs: {
      webErr: path.join(logDir, "web.err.log"),
      runnerOut: path.join(logDir, "runner.out.log")
    }
  };
}

export async function tailFile(filePath: string, maxLines: number): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split("\n");
    const out = lines.slice(Math.max(0, lines.length - maxLines));
    // Drop trailing empty line if present.
    while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
    return out;
  } catch {
    return [];
  }
}

export async function runMba(command: "start" | "stop" | "status" | "update" | "logs" | "envcheck") {
  const rootDir = process.env.ARBITER_ROOT_DIR || DEFAULT_ROOT;
  ensureSafeRoot(rootDir);

  const script = path.join(rootDir, "scripts", "mba.sh");
  const env = {
    ...process.env,
    // Ensure Homebrew node/pnpm are found when executed from Next runtime.
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`
  };

  const { stdout, stderr } = await execFileAsync("/bin/bash", [script, command], {
    env,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024
  });

  return { stdout: String(stdout || ""), stderr: String(stderr || "") };
}

