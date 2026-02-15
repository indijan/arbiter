import { NextResponse } from "next/server";
import { ingestBinance } from "@/server/jobs/ingestBinance";
import { ingestKraken } from "@/server/jobs/ingestKraken";
import { detectCarry } from "@/server/jobs/detectCarry";
import { detectCrossExchangeSpot } from "@/server/jobs/detectCrossExchangeSpot";
import { detectTriangular } from "@/server/jobs/detectTriangular";
import { createAdminSupabase } from "@/lib/supabase/server-admin";
import { computeDailyPnl } from "@/server/jobs/computeDailyPnl";
import { autoExecutePaper } from "@/server/jobs/autoExecutePaper";
import { autoClosePaper } from "@/server/jobs/autoClosePaper";

type JobSuccess<T> = { ok: true; data: T };
type JobFailure = { ok: false; error: string };
type JobResult<T> = JobSuccess<T> | JobFailure;

async function runJob<T>(fn: () => Promise<T>): Promise<JobResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown job error"
    };
  }
}

async function handleTick(request: Request) {
  const expected = process.env.CRON_SECRET;
  const headerSecret = request.headers.get("x-cron-secret");
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const provided = headerSecret ?? querySecret;
  const userAgent = request.headers.get("user-agent") ?? "";
  const isVercelCron = userAgent.toLowerCase().includes("vercel-cron");

  if (!isVercelCron && (!expected || !provided || provided !== expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const ingestBinanceResult = await runJob(() => ingestBinance());
  const ingestKrakenResult = await runJob(() => ingestKraken());
  const carryResult = await runJob(() =>
    detectCarry({ holding_hours: body?.holding_hours })
  );
  const crossResult = await runJob(() => detectCrossExchangeSpot());
  const triResult = await runJob(() => detectTriangular());
  const autoResult = await runJob(() => autoExecutePaper());
  const closeResult = await runJob(() => autoClosePaper());
  const pnlRows = await runJob(() => computeDailyPnl());

  const ingestErrors: string[] = [];
  if (ingestBinanceResult.ok) {
    ingestErrors.push(
      ...ingestBinanceResult.data.errors.map((e) => `${e.symbol}: ${e.error}`)
    );
  } else {
    ingestErrors.push(`ingest_binance_failed: ${ingestBinanceResult.error}`);
  }
  if (ingestKrakenResult.ok) {
    ingestErrors.push(
      ...ingestKrakenResult.data.errors.map((e) => `${e.symbol}: ${e.error}`)
    );
  } else {
    ingestErrors.push(`ingest_kraken_failed: ${ingestKrakenResult.error}`);
  }

  const jobErrors: string[] = [];
  if (!carryResult.ok) jobErrors.push(`detect_carry_failed: ${carryResult.error}`);
  if (!crossResult.ok) jobErrors.push(`detect_xarb_failed: ${crossResult.error}`);
  if (!triResult.ok) jobErrors.push(`detect_tri_failed: ${triResult.error}`);
  if (!autoResult.ok) jobErrors.push(`auto_execute_failed: ${autoResult.error}`);
  if (!closeResult.ok) jobErrors.push(`auto_close_failed: ${closeResult.error}`);
  if (!pnlRows.ok) jobErrors.push(`compute_pnl_failed: ${pnlRows.error}`);

  const autoReasons = autoResult.ok ? autoResult.data.reasons : [];
  const autoReasonCounts = autoReasons.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const autoTopReasons = Object.entries(autoReasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  const adminSupabase = createAdminSupabase();
  if (adminSupabase) {
    await adminSupabase.from("system_ticks").insert({
      ingest_errors: ingestErrors.length,
      ingest_errors_json: ingestErrors,
      detect_summary: {
        carry_spot_perp: carryResult.ok
          ? {
              inserted: carryResult.data.inserted,
              watchlist: carryResult.data.watchlist,
              skipped: carryResult.data.skipped
            }
          : { inserted: 0, watchlist: 0, skipped: 0 },
        xarb_spot: crossResult.ok
          ? {
              inserted: crossResult.data.inserted,
              skipped: crossResult.data.skipped
            }
          : { inserted: 0, skipped: 0 },
        tri_arb: triResult.ok
          ? {
              inserted: triResult.data.inserted,
              skipped: triResult.data.skipped
            }
          : { inserted: 0, skipped: 0 },
        auto_execute: autoResult.ok
          ? {
              attempted: autoResult.data.attempted,
              created: autoResult.data.created,
              skipped: autoResult.data.skipped,
              reasons_top: autoTopReasons,
              diagnostics: autoResult.data.diagnostics,
              llm_used: autoResult.data.llm_used,
              llm_remaining: autoResult.data.llm_remaining
            }
          : {
              attempted: 0,
              created: 0,
              skipped: 0,
              reasons_top: [],
              diagnostics: null,
              llm_used: 0,
              llm_remaining: 0
            },
        auto_close: closeResult.ok
          ? {
              attempted: closeResult.data.attempted,
              closed: closeResult.data.closed,
              skipped: closeResult.data.skipped
            }
          : { attempted: 0, closed: 0, skipped: 0 },
        job_errors: jobErrors
      }
    });
  }

  return NextResponse.json({
    ts: new Date().toISOString(),
    partial_failures: jobErrors.length > 0,
    job_errors: jobErrors,
    ingest: {
      bybit_okx: ingestBinanceResult.ok
        ? ingestBinanceResult.data
        : { ok: false, error: ingestBinanceResult.error },
      kraken: ingestKrakenResult.ok
        ? ingestKrakenResult.data
        : { ok: false, error: ingestKrakenResult.error }
    },
    detect: {
      carry_spot_perp: carryResult.ok
        ? {
            inserted: carryResult.data.inserted,
            watchlist: carryResult.data.watchlist,
            skipped: carryResult.data.skipped
          }
        : { inserted: 0, watchlist: 0, skipped: 0, error: carryResult.error },
      xarb_spot: crossResult.ok
        ? {
            inserted: crossResult.data.inserted,
            skipped: crossResult.data.skipped
          }
        : { inserted: 0, skipped: 0, error: crossResult.error },
      tri_arb: triResult.ok
        ? {
            inserted: triResult.data.inserted,
            skipped: triResult.data.skipped
          }
        : { inserted: 0, skipped: 0, error: triResult.error },
      auto_execute: autoResult.ok
        ? {
            attempted: autoResult.data.attempted,
            created: autoResult.data.created,
            skipped: autoResult.data.skipped,
            reasons: autoResult.data.reasons,
            diagnostics: autoResult.data.diagnostics,
            llm_used: autoResult.data.llm_used,
            llm_remaining: autoResult.data.llm_remaining
          }
        : {
            attempted: 0,
            created: 0,
            skipped: 0,
            reasons: [],
            diagnostics: null,
            llm_used: 0,
            llm_remaining: 0,
            error: autoResult.error
          },
      auto_close: closeResult.ok
        ? {
            attempted: closeResult.data.attempted,
            closed: closeResult.data.closed,
            skipped: closeResult.data.skipped,
            reasons: closeResult.data.reasons
          }
        : {
            attempted: 0,
            closed: 0,
            skipped: 0,
            reasons: [],
            error: closeResult.error
          }
    },
    pnl: pnlRows.ok ? pnlRows.data : [],
    pnl_error: pnlRows.ok ? null : pnlRows.error
  });
}

export async function POST(request: Request) {
  return handleTick(request);
}

export async function GET(request: Request) {
  return handleTick(request);
}
