import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

type ExportType = "latest" | "24h" | "7d" | "strategy" | "full";
type PacketWindow = Exclude<ExportType, "full">;

function startFromType(type: ExportType) {
  const now = Date.now();
  if (type === "24h") return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  if (type === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

function normalizeNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function topReasons(decisions: Array<{ reject_reason: string | null }>) {
  const counts: Record<string, number> = {};
  for (const row of decisions) {
    if (!row.reject_reason) continue;
    counts[row.reject_reason] = (counts[row.reject_reason] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));
}

async function buildPacket(args: {
  supabase: NonNullable<ReturnType<typeof createServerSupabase>>;
  userId: string;
  type: PacketWindow;
  strategyKey?: string | null;
}) {
  const { supabase, userId, type, strategyKey = null } = args;
  const since = startFromType(type);

  let opportunitiesQuery = supabase
    .from("opportunities")
    .select("id, ts, exchange, symbol, type, net_edge_bps, details")
    .order("ts", { ascending: false })
    .limit(type === "latest" ? 5 : 120);

  if (since) opportunitiesQuery = opportunitiesQuery.gte("ts", since);
  if (type === "strategy" && strategyKey) opportunitiesQuery = opportunitiesQuery.eq("type", strategyKey);

  const [{ data: latestTick }, { data: opportunities }, { data: decisions }, { data: paperResults }] =
    await Promise.all([
      supabase
        .from("system_ticks")
        .select("id, ts, ingest_errors, detect_summary")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle(),
      opportunitiesQuery,
      supabase
        .from("opportunity_decisions")
        .select("ts, variant, score, chosen, reject_reason")
        .order("ts", { ascending: false })
        .limit(type === "latest" ? 30 : 240),
      supabase
        .from("positions")
        .select("id, symbol, status, entry_ts, exit_ts, realized_pnl_usd")
        .eq("user_id", userId)
        .order("entry_ts", { ascending: false })
        .limit(type === "latest" ? 20 : 200)
    ]);

  const topOpps = (opportunities ?? []).slice(0, 5).map((item) => {
    const score = Math.max(0, Math.min(100, normalizeNumber(item.net_edge_bps) * 4));
    return {
      id: item.id,
      ts: item.ts,
      strategy: item.type,
      exchange: item.exchange,
      symbol: item.symbol,
      net_edge_bps: normalizeNumber(item.net_edge_bps),
      execution_ready: true,
      auto_trade_candidate: score >= 70,
      confidence_score: Number(score.toFixed(1)),
      metadata: item.details ?? {}
    };
  });

  const allDecisions = (decisions ?? []) as Array<{
    ts: string;
    variant: string;
    score: number | string | null;
    chosen: boolean;
    reject_reason: string | null;
  }>;

  const nearMisses = allDecisions
    .filter((d) => !d.chosen)
    .slice(0, 25)
    .map((d) => ({
      ts: d.ts,
      strategy: d.variant,
      score: normalizeNumber(d.score),
      reason: d.reject_reason ?? "not_chosen"
    }));

  return {
    run_meta: {
      run_id: latestTick?.id ?? null,
      time_window: type,
      exchanges: [...new Set((opportunities ?? []).map((x) => x.exchange))],
      strategies: [...new Set((opportunities ?? []).map((x) => x.type))],
      tick_interval_minutes: 10
    },
    system_health: {
      ingest_inserted: (opportunities ?? []).length,
      ingest_skipped: normalizeNumber(latestTick?.ingest_errors),
      errors: (latestTick?.detect_summary as any)?.errors ?? []
    },
    top_opportunities: topOpps,
    near_misses: nearMisses,
    paper_results: (paperResults ?? []).map((row) => ({
      id: row.id,
      symbol: row.symbol,
      status: row.status,
      entry_ts: row.entry_ts,
      exit_ts: row.exit_ts,
      realized_pnl_usd: normalizeNumber(row.realized_pnl_usd)
    })),
    period_summary: {
      total_opportunities: (opportunities ?? []).length,
      chosen_count: allDecisions.filter((d) => d.chosen).length,
      skipped_count: allDecisions.filter((d) => !d.chosen).length
    },
    by_strategy: Object.entries(
      (opportunities ?? []).reduce((acc, row) => {
        const k = row.type;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).map(([strategy, count]) => ({ strategy, count })),
    top_reasons_for_skip: topReasons(allDecisions)
  };
}

export async function GET(request: NextRequest) {
  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env vars." }, { status: 500 });
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const typeParam = request.nextUrl.searchParams.get("type") ?? "latest";
  const key = request.nextUrl.searchParams.get("key") ?? null;
  const fullWindow = request.nextUrl.searchParams.get("window");
  const type = (["latest", "24h", "7d", "strategy", "full"].includes(typeParam) ? typeParam : "latest") as ExportType;

  if (type === "full") {
    const baseWindow: "24h" | "7d" = fullWindow === "7d" ? "7d" : "24h";
    const [latest, h24, d7, carry] = await Promise.all([
      buildPacket({ supabase, userId: user.id, type: "latest" }),
      buildPacket({ supabase, userId: user.id, type: "24h" }),
      buildPacket({ supabase, userId: user.id, type: "7d" }),
      buildPacket({ supabase, userId: user.id, type: "strategy", strategyKey: "carry_spot_perp" })
    ]);

    const fullPacket = {
      run_meta: {
        generated_at: new Date().toISOString(),
        export_type: "full",
        base_window: baseWindow,
        includes: ["latest", "24h", "7d", "carry_spot_perp"]
      },
      latest,
      h24,
      d7,
      carry
    };

    return NextResponse.json(fullPacket, {
      headers: {
        "content-disposition": "attachment; filename=arbiter-report-full.json"
      }
    });
  }

  const packet = await buildPacket({
    supabase,
    userId: user.id,
    type,
    strategyKey: type === "strategy" ? key : null
  });

  return NextResponse.json(packet, {
    headers: {
      "content-disposition": `attachment; filename=arbiter-report-${type}.json`
    }
  });
}
