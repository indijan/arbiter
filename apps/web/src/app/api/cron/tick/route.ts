import { NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/server/cron/auth";
import { runIngestStep } from "@/server/engine/pipeline/ingest";
import { runValidateStep } from "@/server/engine/pipeline/validate";
import { runStrategyStep } from "@/server/engine/pipeline/strategies";
import { runEvaluateStep } from "@/server/engine/pipeline/evaluate";
import { runWatchlistStep } from "@/server/engine/pipeline/watchlist";
import { runStoreStep } from "@/server/engine/pipeline/store";

export const maxDuration = 300;

async function handleTick(request: Request) {
  const unauthorized = ensureCronAuthorized(request);
  if (unauthorized) return unauthorized;

  try {
    const ingest = await runIngestStep();
    const validate = await runValidateStep();
    const strategy = await runStrategyStep();
    const evaluated = runEvaluateStep(strategy.opportunities);
    const watchlist = runWatchlistStep(evaluated);

    await runStoreStep({
      ingestInserted: ingest.inserted,
      ingestSkipped: ingest.skipped + validate.skipped,
      ingestErrors: ingest.errors,
      strategyInserted: strategy.inserted,
      evaluated,
      top: watchlist.top,
      nearMisses: watchlist.nearMisses
    });

    return NextResponse.json({
      ok: true,
      ts: new Date().toISOString(),
      pipeline: ["ingest", "validate", "strategies", "evaluate", "watchlist", "store"],
      ingest,
      validate: {
        valid_snapshots: validate.valid.length,
        skipped: validate.skipped
      },
      strategies: strategy.inserted,
      evaluation: {
        total: evaluated.length,
        decisions: watchlist.counts
      },
      watchlist: {
        top: watchlist.top,
        near_misses: watchlist.nearMisses
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "tick_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleTick(request);
}

export async function POST(request: Request) {
  return handleTick(request);
}
