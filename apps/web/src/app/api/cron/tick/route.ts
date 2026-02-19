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

type AutoOpenBucket = "normal" | "calibration" | "recovery" | "reentry" | "pilot";

type AutoExpectancySnapshot = {
  window_hours: number;
  total: {
    closed_count: number;
    pnl_sum_usd: number;
    expectancy_usd: number;
    win_rate: number;
  };
  by_open_type: Record<
    AutoOpenBucket,
    {
      closed_count: number;
      pnl_sum_usd: number;
      expectancy_usd: number;
      win_rate: number;
    }
  >;
};

function pickAutoOpenType(meta: Record<string, unknown>): AutoOpenBucket {
  if (meta.pilot_open === true) return "pilot";
  if (meta.recovery_open === true) return "recovery";
  if (meta.reentry_open === true) return "reentry";
  if (meta.calibration_open === true) return "calibration";
  return "normal";
}

function buildBucketStats(pnls: number[]) {
  const closedCount = pnls.length;
  const pnlSum = pnls.reduce((sum, v) => sum + v, 0);
  const wins = pnls.filter((v) => v > 0).length;
  return {
    closed_count: closedCount,
    pnl_sum_usd: Number(pnlSum.toFixed(4)),
    expectancy_usd: Number((closedCount > 0 ? pnlSum / closedCount : 0).toFixed(4)),
    win_rate: Number((closedCount > 0 ? wins / closedCount : 0).toFixed(4))
  };
}

async function computeAutoExpectancy24h() {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await adminSupabase
    .from("positions")
    .select("realized_pnl_usd, meta")
    .eq("status", "closed")
    .gte("exit_ts", since)
    .not("realized_pnl_usd", "is", null)
    .limit(1000);

  if (error) {
    throw new Error(error.message);
  }

  const bucketPnls: Record<AutoOpenBucket, number[]> = {
    normal: [],
    calibration: [],
    recovery: [],
    reentry: [],
    pilot: []
  };

  for (const row of data ?? []) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    if (meta.auto_execute !== true) {
      continue;
    }
    const pnl = Number(row.realized_pnl_usd ?? 0);
    if (!Number.isFinite(pnl)) {
      continue;
    }
    const bucket = pickAutoOpenType(meta);
    bucketPnls[bucket].push(pnl);
  }

  const allPnls = [
    ...bucketPnls.normal,
    ...bucketPnls.calibration,
    ...bucketPnls.recovery,
    ...bucketPnls.reentry,
    ...bucketPnls.pilot
  ];

  return {
    window_hours: 24,
    total: buildBucketStats(allPnls),
    by_open_type: {
      normal: buildBucketStats(bucketPnls.normal),
      calibration: buildBucketStats(bucketPnls.calibration),
      recovery: buildBucketStats(bucketPnls.recovery),
      reentry: buildBucketStats(bucketPnls.reentry),
      pilot: buildBucketStats(bucketPnls.pilot)
    }
  } satisfies AutoExpectancySnapshot;
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
  const autoExpectancy = await runJob(() => computeAutoExpectancy24h());

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
  if (!autoExpectancy.ok) jobErrors.push(`auto_expectancy_failed: ${autoExpectancy.error}`);

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
              expectancy_24h: autoExpectancy.ok ? autoExpectancy.data : null,
              llm_used: autoResult.data.llm_used,
              llm_remaining: autoResult.data.llm_remaining
            }
          : {
              attempted: 0,
              created: 0,
              skipped: 0,
              reasons_top: [],
              diagnostics: null,
              expectancy_24h: autoExpectancy.ok ? autoExpectancy.data : null,
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
            expectancy_24h: autoExpectancy.ok ? autoExpectancy.data : null,
            llm_used: autoResult.data.llm_used,
            llm_remaining: autoResult.data.llm_remaining
          }
        : {
            attempted: 0,
            created: 0,
            skipped: 0,
            reasons: [],
            diagnostics: null,
            expectancy_24h: autoExpectancy.ok ? autoExpectancy.data : null,
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
