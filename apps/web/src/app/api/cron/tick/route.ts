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

  try {
    const ingestBinanceResult = await ingestBinance();
    const ingestKrakenResult = await ingestKraken();

    const carryResult = await detectCarry({
      holding_hours: body?.holding_hours
    });
    const crossResult = await detectCrossExchangeSpot();
    const triResult = await detectTriangular();
    const autoResult = await autoExecutePaper();
    const closeResult = await autoClosePaper();

    const autoReasonCounts = autoResult.reasons.reduce((acc, item) => {
      acc[item.reason] = (acc[item.reason] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const autoTopReasons = Object.entries(autoReasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    const pnlRows = await computeDailyPnl();

    const adminSupabase = createAdminSupabase();
    if (adminSupabase) {
      const ingestErrors = [...ingestBinanceResult.errors, ...ingestKrakenResult.errors];
      await adminSupabase.from("system_ticks").insert({
        ingest_errors: ingestErrors.length,
        ingest_errors_json: ingestErrors,
        detect_summary: {
          carry_spot_perp: {
            inserted: carryResult.inserted,
            watchlist: carryResult.watchlist,
            skipped: carryResult.skipped
          },
          xarb_spot: {
            inserted: crossResult.inserted,
            skipped: crossResult.skipped
          },
          tri_arb: {
            inserted: triResult.inserted,
            skipped: triResult.skipped
          },
          auto_execute: {
            attempted: autoResult.attempted,
            created: autoResult.created,
            skipped: autoResult.skipped,
            reasons_top: autoTopReasons,
            diagnostics: autoResult.diagnostics,
            llm_used: autoResult.llm_used,
            llm_remaining: autoResult.llm_remaining
          },
          auto_close: {
            attempted: closeResult.attempted,
            closed: closeResult.closed,
            skipped: closeResult.skipped
          }
        }
      });
    }

    return NextResponse.json({
      ts: new Date().toISOString(),
      ingest: {
        bybit_okx: ingestBinanceResult,
        kraken: ingestKrakenResult
      },
      detect: {
        carry_spot_perp: {
          inserted: carryResult.inserted,
          watchlist: carryResult.watchlist,
          skipped: carryResult.skipped
        },
        xarb_spot: {
          inserted: crossResult.inserted,
          skipped: crossResult.skipped
        },
        tri_arb: {
          inserted: triResult.inserted,
          skipped: triResult.skipped
        },
        auto_execute: {
          attempted: autoResult.attempted,
          created: autoResult.created,
          skipped: autoResult.skipped,
          reasons: autoResult.reasons,
          diagnostics: autoResult.diagnostics,
          llm_used: autoResult.llm_used,
          llm_remaining: autoResult.llm_remaining
        },
        auto_close: {
          attempted: closeResult.attempted,
          closed: closeResult.closed,
          skipped: closeResult.skipped,
          reasons: closeResult.reasons
        }
      },
      pnl: pnlRows
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to run cron tick.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handleTick(request);
}

export async function GET(request: Request) {
  return handleTick(request);
}
