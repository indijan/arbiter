import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

import { ingestBinance } from "@/server/jobs/ingestBinance";
import { ingestCoinbase } from "@/server/jobs/ingestCoinbase";
import { ingestKraken } from "@/server/jobs/ingestKraken";
import { ingestBinanceSpotRemote } from "@/server/jobs/ingestBinanceSpotRemote";
import { detectCrossExchangeSpot } from "@/server/jobs/detectCrossExchangeSpot";
import { detectSpreadReversion } from "@/server/jobs/detectSpreadReversion";
import { detectRelativeStrength } from "@/server/jobs/detectRelativeStrength";
import { detectTriArb } from "@/server/jobs/detectTriArb";
import { autoExecutePaper } from "@/server/jobs/autoExecutePaper";
import { autoClosePaper } from "@/server/jobs/autoClosePaper";
import { reviewLanePolicies } from "@/server/jobs/reviewLanePolicies";
import { ingestNews } from "@/server/jobs/ingestNews";
import { reactToNews } from "@/server/jobs/reactToNews";

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

  // Ingest
  await run("ingest.binance", () => ingestBinance());
  await run("ingest.binance_spot_remote", () => ingestBinanceSpotRemote());
  await run("ingest.coinbase", () => ingestCoinbase());
  await run("ingest.kraken", () => ingestKraken());

  // Detect
  await run("detect.cross_exchange_spot", () => detectCrossExchangeSpot());
  await run("detect.spread_reversion", () => detectSpreadReversion());
  await run("detect.relative_strength", () => detectRelativeStrength());
  await run("detect.tri_arb", () => detectTriArb());

  // News (optional; if env missing it will fail but won't block trading)
  await run("news.ingest", () => ingestNews());
  await run("news.react", () => reactToNews());

  // Execute/Close
  await run("auto.execute", () => autoExecutePaper());
  await run("auto.close", () => autoClosePaper());

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
        await reviewLanePolicies();
        console.log(`[${isoNow()}] lane_policy: ok`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[${isoNow()}] lane_policy: FAIL ${msg}`);
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
