import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { evaluateOpportunity, opportunityKey } from "@/lib/decision/evaluator";

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

function buildPersistence(
  opportunities: Array<{ ts: string; type: string; exchange: string; symbol: string }>
) {
  const map = new Map<string, { count: number; first: string | null; last: string | null }>();
  for (const item of opportunities) {
    const key = opportunityKey({ strategy: item.type, exchange: item.exchange, symbol: item.symbol });
    const existing = map.get(key) ?? { count: 0, first: null, last: null };
    existing.count += 1;
    if (!existing.first || item.ts < existing.first) existing.first = item.ts;
    if (!existing.last || item.ts > existing.last) existing.last = item.ts;
    map.set(key, existing);
  }
  return map;
}

function consumedRiskFor(strategy: string, decisions: Array<{ variant: string; reject_reason: string | null }>) {
  const relevant = decisions.filter((d) => d.variant === strategy || d.variant === "A");
  if (relevant.length === 0) return 0;
  const consumed = relevant.filter((d) => d.reject_reason === "opportunity_already_consumed").length;
  return Math.min(100, (consumed / relevant.length) * 100);
}

function countFailed(evaluated: Array<{ failed_checks: string[] }>, check: string) {
  return evaluated.filter((item) => item.failed_checks.includes(check)).length;
}

function summarizeRelativeStrength(
  evaluated: Array<{
    strategy: string;
    decision_support_state: string;
    confidence_score: number;
    failed_checks: string[];
  }>
) {
  const rows = evaluated.filter((item) => item.strategy === "relative_strength");
  return {
    total: rows.length,
    observation_noise: rows.filter(
      (item) =>
        (item.decision_support_state === "ignored" || item.decision_support_state === "watch") &&
        item.confidence_score < 6
    ).length,
    outliers: rows.filter((item) => item.confidence_score >= 8).length,
    near_decision_capable: rows.filter((item) => item.decision_support_state === "near_decision_capable").length,
    decision_capable: rows.filter((item) => item.decision_support_state === "decision_capable").length,
    capped_by_strategy_filter: rows.filter((item) => item.failed_checks.includes("strategy_filter_relative_strength")).length
  };
}

function summarizeStrategyDiagnostics(
  evaluated: Array<{
    strategy: string;
    decision_support_state: string;
    qualified_for_top_list: boolean;
    qualified_for_decision_capable: boolean;
    failed_checks: string[];
  }>
) {
  const grouped = evaluated.reduce(
    (acc, item) => {
      const current = acc[item.strategy] ?? {
        strategy: item.strategy,
        total: 0,
        top_qualified: 0,
        decision_capable: 0,
        near_decision_capable: 0,
        failed_due_to_strategy_filter: 0,
        failed_due_to_consumed_risk: 0,
        failed_due_to_persistence: 0,
        failed_due_to_insufficient_edge: 0
      };
      current.total += 1;
      if (item.qualified_for_top_list) current.top_qualified += 1;
      if (item.qualified_for_decision_capable) current.decision_capable += 1;
      if (item.decision_support_state === "near_decision_capable") current.near_decision_capable += 1;
      if (item.failed_checks.some((check) => check.startsWith("strategy_filter"))) {
        current.failed_due_to_strategy_filter += 1;
      }
      if (item.failed_checks.includes("high_consumption_risk")) current.failed_due_to_consumed_risk += 1;
      if (item.failed_checks.includes("insufficient_persistence")) current.failed_due_to_persistence += 1;
      if (item.failed_checks.includes("insufficient_edge_for_top")) current.failed_due_to_insufficient_edge += 1;
      acc[item.strategy] = current;
      return acc;
    },
    {} as Record<
      string,
      {
        strategy: string;
        total: number;
        top_qualified: number;
        decision_capable: number;
        near_decision_capable: number;
        failed_due_to_strategy_filter: number;
        failed_due_to_consumed_risk: number;
        failed_due_to_persistence: number;
        failed_due_to_insufficient_edge: number;
      }
    >
  );

  return Object.values(grouped).sort((a, b) => b.total - a.total);
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

  const allDecisions = (decisions ?? []) as Array<{
    ts: string;
    variant: string;
    score: number | string | null;
    chosen: boolean;
    reject_reason: string | null;
  }>;
  const persistence = buildPersistence((opportunities ?? []) as Array<{ ts: string; type: string; exchange: string; symbol: string }>);
  const evaluatedOpps = (opportunities ?? []).map((item) => {
    const key = opportunityKey({ strategy: item.type, exchange: item.exchange, symbol: item.symbol });
    const seen = persistence.get(key);
    const first = seen?.first ?? item.ts;
    const last = seen?.last ?? item.ts;
    const lifetime = (new Date(last).getTime() - new Date(first).getTime()) / 60000;
    const evaluation = evaluateOpportunity({
      strategy: item.type,
      exchange: item.exchange,
      symbol: item.symbol,
      net_edge_bps: normalizeNumber(item.net_edge_bps),
      metadata: item.details ?? {},
      persistence_ticks: seen?.count ?? 1,
      first_seen_ts: first,
      last_seen_ts: last,
      lifetime_minutes: lifetime,
      consumed_risk_score: consumedRiskFor(item.type, allDecisions)
    });

    return {
      id: item.id,
      ts: item.ts,
      strategy: item.type,
      exchange: item.exchange,
      symbol: item.symbol,
      net_edge_bps: normalizeNumber(item.net_edge_bps),
      maker_net_edge_bps: evaluation.maker_net_edge_bps,
      taker_net_edge_bps: evaluation.taker_net_edge_bps,
      execution_ready: true,
      auto_trade_candidate: evaluation.auto_trade_candidate,
      confidence_score: evaluation.confidence_score,
      score: evaluation.score,
      decision: evaluation.decision,
      persistence_ticks: evaluation.persistence_ticks,
      first_seen_ts: evaluation.first_seen_ts,
      last_seen_ts: evaluation.last_seen_ts,
      lifetime_minutes: evaluation.lifetime_minutes,
      execution_fragile: evaluation.execution_fragile,
      consumed_risk_score: evaluation.consumed_risk_score,
      auto_trade_exclusion_reasons: evaluation.auto_trade_exclusion_reasons,
      decision_trace: evaluation.decision_trace,
      decision_support_state: evaluation.decision_support_state,
      qualified_for_top_list: evaluation.qualified_for_top_list,
      qualified_for_decision_capable: evaluation.qualified_for_decision_capable,
      failed_checks: evaluation.failed_checks,
      primary_failure_reason: evaluation.primary_failure_reason,
      score_components: evaluation.score_components,
      metadata: {
        ...(item.details ?? {}),
        execution_fragile: evaluation.execution_fragile,
        auto_trade_exclusion_reasons: evaluation.auto_trade_exclusion_reasons,
        decision_support_state: evaluation.decision_support_state,
        qualified_for_top_list: evaluation.qualified_for_top_list,
        qualified_for_decision_capable: evaluation.qualified_for_decision_capable,
        failed_checks: evaluation.failed_checks,
        primary_failure_reason: evaluation.primary_failure_reason,
        score_components: evaluation.score_components
      }
    };
  });

  const topOpps = evaluatedOpps
    .filter((item) => item.qualified_for_top_list)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const nearTopOpps = evaluatedOpps
    .filter((item) => !item.qualified_for_top_list)
    .filter(
      (item) =>
        item.decision_support_state === "near_decision_capable" ||
        (item.qualified_for_decision_capable && item.failed_checks.length <= 2)
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

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
    near_top_opportunities: nearTopOpps,
    filtered_but_notable_opportunities: nearTopOpps,
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
      decision_capable_opportunities: topOpps.length,
      near_decision_capable_count: evaluatedOpps.filter((x) => x.decision_support_state === "near_decision_capable").length,
      execution_fragile_count: evaluatedOpps.filter((x) => x.execution_fragile).length,
      failed_due_to_consumed_risk: countFailed(evaluatedOpps, "high_consumption_risk"),
      failed_due_to_persistence: countFailed(evaluatedOpps, "insufficient_persistence"),
      failed_due_to_insufficient_edge: countFailed(evaluatedOpps, "insufficient_edge_for_top"),
      failed_due_to_execution_fragility: countFailed(evaluatedOpps, "execution_fragile"),
      failed_due_to_strategy_filter: evaluatedOpps.filter((x) =>
        x.failed_checks.some((check) => check.startsWith("strategy_filter"))
      ).length,
      chosen_count: allDecisions.filter((d) => d.chosen).length,
      skipped_count: allDecisions.filter((d) => !d.chosen).length
    },
    relative_strength_summary: summarizeRelativeStrength(evaluatedOpps),
    strategy_filter_diagnostics: summarizeStrategyDiagnostics(evaluatedOpps),
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
