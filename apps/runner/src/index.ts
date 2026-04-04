import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

// This runner calls the local Next.js cron endpoints over HTTP.
// Advantage: no TS path alias issues, and the runtime matches production logic.

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return false;
  // Use dotenv to match typical .env parsing (escaping etc).
  dotenv.config({ path: filePath, override: false });
  return true;
}

function loadEnv() {
  const runnerEnv = path.resolve(process.cwd(), ".env.local");
  const webEnv = path.resolve(process.cwd(), "..", "web", ".env.local");
  const rootEnv = path.resolve(process.cwd(), "..", "..", ".env.local");

  loadEnvFile(runnerEnv);
  loadEnvFile(webEnv);
  loadEnvFile(rootEnv);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoNow() {
  return new Date().toISOString();
}

function nextBoundaryMs(stepMinutes: number) {
  const stepMs = stepMinutes * 60_000;
  const now = Date.now();
  return now + (stepMs - (now % stepMs));
}

async function callCron(pathname: string) {
  const base = process.env.RUNNER_BASE_URL ?? "http://localhost:3000";
  const secret = process.env.CRON_SECRET ?? "";
  const url = new URL(pathname, base);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {}
  });
  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`${pathname} -> ${response.status} ${payloadText.slice(0, 300)}`);
  }
  return payloadText;
}

async function runTick() {
  const started = Date.now();
  const errors: string[] = [];

  const run = async <T>(name: string, fn: () => Promise<T>) => {
    const t0 = Date.now();
    try {
      const result = await fn();
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[${isoNow()}] ${name}: ok (${dt}s)`);
      return result;
    } catch (err) {
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[${isoNow()}] ${name}: FAIL (${dt}s) ${msg}`);
      errors.push(`${name}: ${msg}`);
      return null;
    }
  };

  await run("cron.ingest", () => callCron("/api/cron/ingest"));
  await run("cron.detect", () => callCron("/api/cron/detect"));
  await run("cron.news", () => callCron("/api/cron/news"));
  await run("cron.execute", () => callCron("/api/cron/execute"));
  await run("cron.close", () => callCron("/api/cron/close"));

  const dt = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[${isoNow()}] tick done (${dt}s) errors=${errors.length}`);
}

async function main() {
  loadEnv();

  const runOnce = process.env.RUN_ONCE === "1";
  const stepMinutes = Number(process.env.RUNNER_STEP_MINUTES ?? 10);
  const lanePolicyHours = Number(process.env.LANE_POLICY_HOURS ?? 1);

  console.log(`[${isoNow()}] runner starting step=${stepMinutes}m runOnce=${runOnce}`);

  let lastLanePolicyAt = 0;

  while (true) {
    const now = Date.now();
    if (now - lastLanePolicyAt >= lanePolicyHours * 60 * 60_000) {
      lastLanePolicyAt = now;
      try {
        await callCron("/api/cron/lane-policy");
        console.log(`[${isoNow()}] cron.lane_policy: ok`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[${isoNow()}] cron.lane_policy: FAIL ${msg}`);
      }
    }

    await runTick();
    if (runOnce) break;

    const wakeAt = nextBoundaryMs(stepMinutes);
    const waitMs = Math.max(1_000, wakeAt - Date.now());
    console.log(`[${isoNow()}] sleeping ${(waitMs / 1000).toFixed(0)}s`);
    await sleep(waitMs);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
