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

function opportunityLimitForType(type: PacketWindow) {
  if (type === "latest") return 40;
  if (type === "24h") return 1500;
  if (type === "7d") return 5000;
  return 1500;
}

function decisionLimitForType(type: PacketWindow) {
  if (type === "latest") return 30;
  if (type === "24h") return 1000;
  if (type === "7d") return 3000;
  return 1000;
}

function paperResultLimitForType(type: PacketWindow) {
  if (type === "latest") return 20;
  if (type === "24h") return 300;
  if (type === "7d") return 1000;
  return 300;
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

function dedupeByRegime<T extends { regime_key: string | null; id: number }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.regime_key ?? `id:${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeRelativeStrength(
  evaluated: Array<{
    strategy: string;
    decision_support_state: string;
    decision_capable_market_signal: boolean;
    confidence_score: number;
    failed_checks: string[];
    regime_key: string | null;
  }>
) {
  const rows = evaluated.filter((item) => item.strategy === "relative_strength");
  const regimeCounts = rows.reduce(
    (acc, item) => {
      const key = item.regime_key ?? "unknown_regime";
      const current = acc[key] ?? { regime_key: key, total: 0, decision_capable_market_signal: 0 };
      current.total += 1;
      if (item.decision_capable_market_signal) current.decision_capable_market_signal += 1;
      acc[key] = current;
      return acc;
    },
    {} as Record<string, { regime_key: string; total: number; decision_capable_market_signal: number }>
  );
  return {
    total: rows.length,
    observation_noise: rows.filter(
      (item) =>
        (item.decision_support_state === "ignored" || item.decision_support_state === "watch") &&
        item.confidence_score < 6
    ).length,
    outliers: rows.filter((item) => item.confidence_score >= 8).length,
    near_decision_capable: rows.filter((item) => item.decision_support_state === "near_decision_capable").length,
    decision_capable_market_signal: rows.filter((item) => item.decision_capable_market_signal).length,
    capped_by_strategy_filter: rows.filter((item) => item.failed_checks.includes("strategy_filter_relative_strength")).length,
    regimes: Object.values(regimeCounts).sort((a, b) => b.total - a.total)
  };
}

function summarizeStrategyDiagnostics(
  evaluated: Array<{
    strategy: string;
    decision_support_state: string;
    qualified_for_top_list: boolean;
    qualified_for_decision_capable: boolean;
    decision_capable_market_signal: boolean;
    decision_capable_execution_signal: boolean;
    strategy_local_decision_capable: boolean;
    strategy_signal_family: string;
    execution_recommendation_state: string;
    failed_checks: string[];
  }>
) {
  const grouped = evaluated.reduce(
    (acc, item) => {
      const current = acc[item.strategy] ?? {
        strategy: item.strategy,
        strategy_signal_family: item.strategy_signal_family,
        total: 0,
        top_qualified: 0,
        global_execution_decision_capable: 0,
        strategy_local_decision_capable: 0,
        decision_capable_market_signal: 0,
        decision_capable_execution_signal: 0,
        near_decision_capable: 0,
        conditional_execution: 0,
        failed_due_to_strategy_filter: 0,
        failed_due_to_consumed_risk: 0,
        failed_due_to_persistence: 0,
        failed_due_to_insufficient_edge: 0,
        failed_due_to_execution_fragility: 0
      };
      current.total += 1;
      if (item.qualified_for_top_list) current.top_qualified += 1;
      if (item.qualified_for_decision_capable) current.global_execution_decision_capable += 1;
      if (item.strategy_local_decision_capable) current.strategy_local_decision_capable += 1;
      if (item.decision_capable_market_signal) current.decision_capable_market_signal += 1;
      if (item.decision_capable_execution_signal) current.decision_capable_execution_signal += 1;
      if (item.decision_support_state === "near_decision_capable") current.near_decision_capable += 1;
      if (item.execution_recommendation_state === "conditional_execution") current.conditional_execution += 1;
      if (item.failed_checks.some((check) => check.startsWith("strategy_filter"))) {
        current.failed_due_to_strategy_filter += 1;
      }
      if (item.failed_checks.includes("high_consumption_risk")) current.failed_due_to_consumed_risk += 1;
      if (item.failed_checks.includes("insufficient_persistence")) current.failed_due_to_persistence += 1;
      if (item.failed_checks.includes("insufficient_edge_for_top")) current.failed_due_to_insufficient_edge += 1;
      if (item.failed_checks.includes("execution_fragile")) current.failed_due_to_execution_fragility += 1;
      acc[item.strategy] = current;
      return acc;
    },
    {} as Record<
      string,
      {
        strategy: string;
        strategy_signal_family: string;
        total: number;
        top_qualified: number;
        global_execution_decision_capable: number;
        strategy_local_decision_capable: number;
        decision_capable_market_signal: number;
        decision_capable_execution_signal: number;
        near_decision_capable: number;
        conditional_execution: number;
        failed_due_to_strategy_filter: number;
        failed_due_to_consumed_risk: number;
        failed_due_to_persistence: number;
        failed_due_to_insufficient_edge: number;
        failed_due_to_execution_fragility: number;
      }
    >
  );

  return Object.values(grouped).sort((a, b) => b.total - a.total);
}

function summarizeNearDecisionClusters(evaluated: Array<{ decision_support_state: string; failed_checks: string[] }>) {
  const near = evaluated.filter((item) => item.decision_support_state === "near_decision_capable");
  return {
    total: near.length,
    near_due_to_execution_fragility: near.filter((item) => item.failed_checks.includes("execution_fragile")).length,
    near_due_to_insufficient_edge: near.filter((item) => item.failed_checks.includes("insufficient_edge_for_top")).length,
    near_due_to_persistence: near.filter((item) => item.failed_checks.includes("insufficient_persistence")).length,
    near_due_to_strategy_filter: near.filter((item) =>
      item.failed_checks.some((check) => check.startsWith("strategy_filter"))
    ).length
  };
}

function executionTimelineKey(item: { strategy: string; exchange: string; symbol: string }) {
  return `${item.strategy}:${item.exchange}:${item.symbol}`;
}

function effectiveNetEdge(item: { taker_net_edge_bps: number | null; maker_net_edge_bps: number }) {
  return item.taker_net_edge_bps ?? item.maker_net_edge_bps;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isXarbStrategy(strategy: string) {
  return strategy === "xarb_spot" || strategy === "cross_exchange_spot";
}

type ExecutionAuditRow = {
  id: number;
  ts: string;
  strategy: string;
  exchange: string;
  symbol: string;
  maker_net_edge_bps: number;
  taker_net_edge_bps: number | null;
  persistence_ticks: number;
  lifetime_minutes: number;
  decision_capable_execution_signal: boolean;
  execution_recommendation_state: string;
  primary_failure_reason: string | null;
};

type ExecutionAudit = {
  execution_grade: string;
  taker_positive_margin_bps: number;
  maker_vs_taker_gap_bps: number;
  min_observed_net_edge_bps: number;
  max_observed_net_edge_bps: number;
  avg_observed_net_edge_bps: number;
  net_edge_stability_score: number;
  time_to_first_decision_capable_minutes: number | null;
  execution_ready_duration_minutes: number;
  downgrade_reason: string | null;
  paper_exit_reason: string;
  paper_peak_bps_after_signal: number;
  paper_worst_bps_after_signal: number;
};

function buildExecutionAudit(rows: ExecutionAuditRow[]) {
  const grouped = rows.reduce((acc, item) => {
    const key = executionTimelineKey(item);
    const current = acc.get(key) ?? ([] as ExecutionAuditRow[]);
    current.push(item);
    acc.set(key, current);
    return acc;
  }, new Map<string, ExecutionAuditRow[]>());

  const audits = new Map<string, ExecutionAudit>();

  for (const [key, timeline] of grouped.entries()) {
    const ordered = timeline
      .slice()
      .sort((a: ExecutionAuditRow, b: ExecutionAuditRow) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const nets = ordered.map((item) => item.maker_net_edge_bps);
    const takers = ordered.map((item) => item.taker_net_edge_bps ?? item.maker_net_edge_bps);
    const stableMean = average(nets);
    const range = Math.max(...nets) - Math.min(...nets);
    const stability = stableMean <= 0 ? 0 : Math.max(0, Math.min(100, 100 - (range / stableMean) * 20));

    const firstDecisionCapable = ordered.find((item) => item.decision_capable_execution_signal);
    const readyRows = ordered.filter((item) => item.execution_recommendation_state === "execution_ready");
    const lastReady = readyRows.at(-1) ?? null;
    const afterReady = firstDecisionCapable
      ? ordered.filter((item) => new Date(item.ts).getTime() >= new Date(firstDecisionCapable.ts).getTime())
      : [];
    const downgraded = lastReady
      ? ordered.find((item) => new Date(item.ts).getTime() > new Date(lastReady.ts).getTime() && item.execution_recommendation_state !== "execution_ready")
      : null;
    const readyDuration =
      readyRows.length >= 2
        ? (new Date(readyRows[readyRows.length - 1].ts).getTime() - new Date(readyRows[0].ts).getTime()) / 60000
        : readyRows.length === 1
          ? readyRows[0].lifetime_minutes
          : 0;
    const paperPeak = afterReady.length > 0 ? Math.max(...afterReady.map((item) => effectiveNetEdge(item))) : 0;
    const paperWorst = afterReady.length > 0 ? Math.min(...afterReady.map((item) => effectiveNetEdge(item))) : 0;
    const paperExitReason = afterReady.length === 0
      ? "no_post_signal_window"
      : paperWorst < 0
        ? "edge_reversal"
        : afterReady.length > 1
          ? "window_end"
          : "single_snapshot";

    audits.set(key, {
      execution_grade:
        readyRows.length > 0 && stability >= 75
          ? "A"
          : readyRows.length > 0 && stability >= 55
            ? "B"
            : "C",
      taker_positive_margin_bps: Number(Math.max(0, average(takers)).toFixed(4)),
      maker_vs_taker_gap_bps: Number(Math.max(0, average(nets) - average(takers)).toFixed(4)),
      min_observed_net_edge_bps: Number(Math.min(...nets).toFixed(4)),
      max_observed_net_edge_bps: Number(Math.max(...nets).toFixed(4)),
      avg_observed_net_edge_bps: Number(average(nets).toFixed(4)),
      net_edge_stability_score: Number(stability.toFixed(1)),
      time_to_first_decision_capable_minutes:
        firstDecisionCapable ? Number(((new Date(firstDecisionCapable.ts).getTime() - new Date(ordered[0].ts).getTime()) / 60000).toFixed(1)) : null,
      execution_ready_duration_minutes: Number(readyDuration.toFixed(1)),
      downgrade_reason: downgraded?.primary_failure_reason ?? null,
      paper_exit_reason: paperExitReason,
      paper_peak_bps_after_signal: Number(paperPeak.toFixed(4)),
      paper_worst_bps_after_signal: Number(paperWorst.toFixed(4))
    });
  }

  return audits;
}

type OpeningTrialAudit = {
  post_entry_peak_bps: number;
  post_entry_worst_bps: number;
  minutes_until_peak: number | null;
  minutes_until_invalidated: number | null;
  entry_to_exit_outcome_bps: number;
  paper_trade_exit_ts: string | null;
  paper_trade_hold_minutes: number | null;
  paper_trade_exit_reason: string;
};

function buildOpeningTrialAudit(
  rows: Array<{
    ts: string;
    strategy: string;
    exchange: string;
    symbol: string;
    maker_net_edge_bps: number;
    taker_net_edge_bps: number | null;
    opening_trial_candidate: boolean;
  }>
) {
  const grouped = rows.reduce((acc, item) => {
    const key = executionTimelineKey(item);
    const current = acc.get(key) ?? ([] as typeof rows);
    current.push(item);
    acc.set(key, current);
    return acc;
  }, new Map<string, typeof rows>());

  const audits = new Map<string, OpeningTrialAudit>();

  for (const [key, timeline] of grouped.entries()) {
    const ordered = timeline
      .slice()
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const entry = ordered.find((item) => item.opening_trial_candidate);

    if (!entry) {
      audits.set(key, {
        post_entry_peak_bps: 0,
        post_entry_worst_bps: 0,
        minutes_until_peak: null,
        minutes_until_invalidated: null,
        entry_to_exit_outcome_bps: 0,
        paper_trade_exit_ts: null,
        paper_trade_hold_minutes: null,
        paper_trade_exit_reason: "no_entry"
      });
      continue;
    }

    const entryTs = new Date(entry.ts).getTime();
    const postEntry = ordered.filter((item) => new Date(item.ts).getTime() >= entryTs);
    const postEntryNets = postEntry.map((item) => effectiveNetEdge(item));
    const peakBps = postEntry.length > 0 ? Math.max(...postEntryNets) : 0;
    const worstBps = postEntry.length > 0 ? Math.min(...postEntryNets) : 0;
    const peakRow = postEntry.find((item) => effectiveNetEdge(item) === peakBps) ?? null;
    const invalidatedRow = postEntry.find((item) => effectiveNetEdge(item) <= 0) ?? null;
    const lastRow = postEntry.at(-1) ?? entry;
    const exitRow = invalidatedRow ?? lastRow;
    const holdMinutes = Number(((new Date(exitRow.ts).getTime() - entryTs) / 60000).toFixed(1));
    const exitReason = invalidatedRow ? "signal_invalidated" : postEntry.length > 1 ? "window_end" : "single_snapshot";

    audits.set(key, {
      post_entry_peak_bps: Number(peakBps.toFixed(4)),
      post_entry_worst_bps: Number(worstBps.toFixed(4)),
      minutes_until_peak: peakRow ? Number(((new Date(peakRow.ts).getTime() - entryTs) / 60000).toFixed(1)) : null,
      minutes_until_invalidated: invalidatedRow
        ? Number(((new Date(invalidatedRow.ts).getTime() - entryTs) / 60000).toFixed(1))
        : null,
      entry_to_exit_outcome_bps: Number((effectiveNetEdge(exitRow) - effectiveNetEdge(entry)).toFixed(4)),
      paper_trade_exit_ts: exitRow.ts,
      paper_trade_hold_minutes: holdMinutes,
      paper_trade_exit_reason: exitReason
    });
  }

  return audits;
}

type EventFeedItem = {
  event_type: string;
  ts: string;
  strategy: string;
  symbol: string;
  exchange: string;
  severity: "info" | "watch" | "action" | "profit" | "risk";
  headline: string;
  details: string;
};

function buildEventFeed(
  rows: Array<{
    ts: string;
    strategy: string;
    symbol: string;
    exchange: string;
    regime_key: string | null;
    decision_support_state: string;
    execution_recommendation_state: string;
    opening_trial_candidate: boolean;
    opening_trial_decision: string;
    paper_trade_started: boolean;
    paper_trade_closed: boolean;
    paper_trade_positive: boolean;
    paper_trade_pnl_bps: number;
    taker_net_edge_bps: number | null;
  }>
) {
  const grouped = rows.reduce((acc, item) => {
    const key = executionTimelineKey(item);
    const current = acc.get(key) ?? ([] as typeof rows[number][]);
    current.push(item);
    acc.set(key, current);
    return acc;
  }, new Map<string, Array<(typeof rows)[number]>>());

  const events: EventFeedItem[] = [];

  for (const timeline of grouped.values()) {
    const ordered = timeline
      .slice()
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    for (let i = 0; i < ordered.length; i += 1) {
      const current = ordered[i];
      const previous = i > 0 ? ordered[i - 1] : null;

      if (current.execution_recommendation_state === "execution_ready" && previous?.execution_recommendation_state !== "execution_ready") {
        events.push({
          event_type: "execution_ready_signal_detected",
          ts: current.ts,
          strategy: current.strategy,
          symbol: current.symbol,
          exchange: current.exchange,
          severity: "watch",
          headline: `${current.symbol} execution-ready lett`,
          details: `${current.strategy} setup execution-ready állapotba lépett.`
        });
      }

      if (previous?.execution_recommendation_state === "execution_ready" && current.execution_recommendation_state !== "execution_ready") {
        events.push({
          event_type: "execution_ready_signal_lost",
          ts: current.ts,
          strategy: current.strategy,
          symbol: current.symbol,
          exchange: current.exchange,
          severity: "risk",
          headline: `${current.symbol} execution-ready jel elveszett`,
          details: `Az execution-ready állapot megszűnt, új állapot: ${current.execution_recommendation_state}.`
        });
      }

      if (current.opening_trial_candidate && !previous?.opening_trial_candidate) {
        events.push({
          event_type: "opening_trial_go_created",
          ts: current.ts,
          strategy: current.strategy,
          symbol: current.symbol,
          exchange: current.exchange,
          severity: "action",
          headline: `${current.symbol} go candidate létrejött`,
          details: "A kontrollált nyitási gate teljesült."
        });
      }

      if (current.opening_trial_candidate && previous?.opening_trial_candidate) {
        events.push({
          event_type: "opening_trial_go_still_active",
          ts: current.ts,
          strategy: current.strategy,
          symbol: current.symbol,
          exchange: current.exchange,
          severity: "info",
          headline: `${current.symbol} go candidate továbbra is aktív`,
          details: "A belépési ablak továbbra is nyitva maradt."
        });
      }

      if (previous?.opening_trial_candidate && !current.opening_trial_candidate) {
        events.push({
          event_type: "opening_trial_invalidated",
          ts: current.ts,
          strategy: current.strategy,
          symbol: current.symbol,
          exchange: current.exchange,
          severity: "risk",
          headline: `${current.symbol} go candidate invalidálódott`,
          details: `A belépési ablak bezárult, jelen állapot: ${current.opening_trial_decision}.`
        });
      }

      if (current.paper_trade_started) {
        events.push({
          event_type: "paper_trade_started",
          ts: current.ts,
          strategy: current.strategy,
          symbol: current.symbol,
          exchange: current.exchange,
          severity: "action",
          headline: `${current.symbol} paper trial elindult`,
          details: "A setup paper-first belépési próbára alkalmas volt."
        });
      }

      if (current.paper_trade_closed && current.paper_trade_positive) {
        events.push({
          event_type: "paper_trade_profit_taken",
          ts: current.ts,
          strategy: current.strategy,
          symbol: current.symbol,
          exchange: current.exchange,
          severity: "profit",
          headline: `${current.symbol} paper trade profitot ért volna el`,
          details: `Realizált proxy kimenet: ${current.paper_trade_pnl_bps.toFixed(2)} bps.`
        });
      }

      if (current.paper_trade_closed && !current.paper_trade_positive) {
        events.push({
          event_type: "paper_trade_stopped_out",
          ts: current.ts,
          strategy: current.strategy,
          symbol: current.symbol,
          exchange: current.exchange,
          severity: "risk",
          headline: `${current.symbol} paper trade negatívan zárult volna`,
          details: `Proxy kimenet: ${current.paper_trade_pnl_bps.toFixed(2)} bps.`
        });
      }

      if (
        current.strategy === "relative_strength" &&
        previous &&
        current.regime_key &&
        previous.regime_key &&
        current.regime_key !== previous.regime_key
      ) {
        events.push({
          event_type: "market_signal_regime_change",
          ts: current.ts,
          strategy: current.strategy,
          symbol: current.symbol,
          exchange: current.exchange,
          severity: "watch",
          headline: `${current.symbol} market regime változott`,
          details: "A relative_strength rezsim kulcsa megváltozott."
        });
      }
    }
  }

  return events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

async function buildPacket(args: {
  supabase: NonNullable<ReturnType<typeof createServerSupabase>>;
  userId: string;
  type: PacketWindow;
  strategyKey?: string | null;
}) {
  const { supabase, userId, type, strategyKey = null } = args;
  const since = startFromType(type);
  const opportunityLimit = opportunityLimitForType(type);
  const decisionLimit = decisionLimitForType(type);
  const paperResultLimit = paperResultLimitForType(type);

  let opportunitiesQuery = supabase
    .from("opportunities")
    .select("id, ts, exchange, symbol, type, net_edge_bps, details")
    .order("ts", { ascending: false })
    .limit(opportunityLimit);

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
        .limit(decisionLimit),
      supabase
        .from("positions")
        .select("id, symbol, status, entry_ts, exit_ts, realized_pnl_usd")
        .eq("user_id", userId)
        .order("entry_ts", { ascending: false })
        .limit(paperResultLimit)
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
      strategy_signal_family: evaluation.strategy_signal_family,
      decision_capable_market_signal: evaluation.decision_capable_market_signal,
      decision_capable_execution_signal: evaluation.decision_capable_execution_signal,
      strategy_local_decision_capable: evaluation.strategy_local_decision_capable,
      execution_quality: evaluation.execution_quality,
      execution_recommendation_state: evaluation.execution_recommendation_state,
      execution_viability_score: evaluation.execution_viability_score,
      regime_key: evaluation.regime_key,
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
        strategy_signal_family: evaluation.strategy_signal_family,
        decision_capable_market_signal: evaluation.decision_capable_market_signal,
        decision_capable_execution_signal: evaluation.decision_capable_execution_signal,
        strategy_local_decision_capable: evaluation.strategy_local_decision_capable,
        execution_quality: evaluation.execution_quality,
        execution_recommendation_state: evaluation.execution_recommendation_state,
        execution_viability_score: evaluation.execution_viability_score,
        regime_key: evaluation.regime_key,
        qualified_for_top_list: evaluation.qualified_for_top_list,
        qualified_for_decision_capable: evaluation.qualified_for_decision_capable,
        failed_checks: evaluation.failed_checks,
        primary_failure_reason: evaluation.primary_failure_reason,
        score_components: evaluation.score_components
      }
    };
  });
  const executionAudits = buildExecutionAudit(evaluatedOpps);
  const evaluatedWithAudit = evaluatedOpps.map((item) => {
    const audit = executionAudits.get(executionTimelineKey(item));
    const paperTradeReady =
      item.strategy === "xarb_spot" &&
      item.decision_capable_execution_signal &&
      item.execution_recommendation_state === "execution_ready" &&
      (item.taker_net_edge_bps ?? 0) > 0 &&
      item.persistence_ticks >= 3 &&
      item.lifetime_minutes >= 60 &&
      !item.execution_fragile &&
      (audit?.net_edge_stability_score ?? 0) >= 60;

    return {
      ...item,
      ...audit,
      paper_trade_ready: paperTradeReady
    };
  });

  const openingTrialEvaluated = evaluatedWithAudit.map((item) => {
    const exclusionReasons = [
      ...(item.auto_trade_exclusion_reasons ?? []),
      ...item.failed_checks.filter((check) => check.startsWith("strategy_filter"))
    ];
    const passedChecks: string[] = [];
    const failedChecks: string[] = [];
    const requiredPersistenceTicks = 3;
    const requiredLifetimeMinutes = 30;
    const pushCheck = (name: string, condition: boolean) => {
      if (condition) {
        passedChecks.push(name);
      } else {
        failedChecks.push(name);
      }
    };

    pushCheck("strategy_xarb_spot", item.strategy === "xarb_spot");
    pushCheck("decision_capable_execution_signal", item.decision_capable_execution_signal);
    pushCheck("execution_ready_state", item.execution_recommendation_state === "execution_ready");
    pushCheck("positive_taker_edge", (item.taker_net_edge_bps ?? 0) > 0);
    pushCheck("not_execution_fragile", !item.execution_fragile);
    pushCheck("min_persistence_ticks", item.persistence_ticks >= requiredPersistenceTicks);
    pushCheck("min_lifetime_minutes", item.lifetime_minutes >= requiredLifetimeMinutes);
    pushCheck("min_execution_viability", (item.execution_viability_score ?? 0) >= 80);
    pushCheck("paper_trade_ready", item.paper_trade_ready);
    pushCheck("no_exclusion_reasons", exclusionReasons.length === 0);

    const hardPersistencePass = item.persistence_ticks >= requiredPersistenceTicks && item.lifetime_minutes >= requiredLifetimeMinutes;
    const earlySignalPass =
      item.strategy === "xarb_spot" &&
      item.decision_capable_execution_signal &&
      item.execution_recommendation_state === "execution_ready" &&
      (item.taker_net_edge_bps ?? 0) > 0 &&
      !item.execution_fragile &&
      item.maker_net_edge_bps >= 2 &&
      (item.execution_viability_score ?? 0) >= 80 &&
      !item.paper_trade_ready &&
      (item.persistence_ticks < 3 || item.lifetime_minutes < 30);
    const persistenceOnlyFailures = failedChecks.filter((check) =>
      ["min_persistence_ticks", "min_lifetime_minutes", "paper_trade_ready"].includes(check)
    );
    const blockedByPersistenceOnly =
      item.strategy === "xarb_spot" &&
      (item.taker_net_edge_bps ?? 0) > 0 &&
      !item.execution_fragile &&
      (item.execution_viability_score ?? 0) >= 80 &&
      persistenceOnlyFailures.length > 0 &&
      failedChecks.every((check) =>
        ["min_persistence_ticks", "min_lifetime_minutes", "paper_trade_ready"].includes(check)
      );
    const edgeStrongButImmature =
      item.strategy === "xarb_spot" &&
      (item.taker_net_edge_bps ?? 0) > 0 &&
      item.maker_net_edge_bps >= 2 &&
      !item.execution_fragile &&
      (item.execution_viability_score ?? 0) >= 80 &&
      !hardPersistencePass;

    const openingTrialCandidate = failedChecks.length === 0;
    const watchMoreEligible =
      item.strategy === "xarb_spot" &&
      item.decision_capable_execution_signal &&
      item.execution_recommendation_state === "execution_ready" &&
      (item.taker_net_edge_bps ?? 0) > 0 &&
      !item.execution_fragile &&
      (item.execution_viability_score ?? 0) >= 80 &&
      exclusionReasons.length === 0 &&
      (!item.paper_trade_ready || !hardPersistencePass || blockedByPersistenceOnly || earlySignalPass);
    const preGoWatch = !openingTrialCandidate && (blockedByPersistenceOnly || earlySignalPass);

    const openingTrialDecision = openingTrialCandidate ? "go" : (watchMoreEligible || preGoWatch) ? "watch_more" : "no_go";
    const openingTrialReason = openingTrialCandidate
      ? "xarb_spot execution-ready setup passed all controlled opening gates"
      : preGoWatch
        ? "strong execution signal, but persistence confirmation is still missing"
        : openingTrialDecision === "watch_more"
          ? "setup is close to entry-ready but needs more persistence and/or lifetime"
      : item.primary_failure_reason ?? failedChecks[0] ?? "opening_gate_not_met";
    const entryReadinessTimestamp = openingTrialCandidate ? item.ts : null;
    const healthyEarlyExecutionSignal =
      item.strategy === "xarb_spot" &&
      !openingTrialCandidate &&
      item.execution_recommendation_state === "execution_ready" &&
      (item.taker_net_edge_bps ?? 0) > 0 &&
      !item.execution_fragile &&
      (item.execution_viability_score ?? 0) >= 80 &&
      item.lifetime_minutes >= 20;
    const distanceToGoChecks = openingTrialCandidate ? [] : failedChecks;
    const persistenceGap = Math.max(0, requiredPersistenceTicks - item.persistence_ticks);
    const lifetimeGap = Math.max(0, requiredLifetimeMinutes - item.lifetime_minutes);
    const distanceToGoSummary =
      openingTrialCandidate
        ? "go gate passed"
        : distanceToGoChecks.length === 0
          ? "no missing checks detected"
          : `${distanceToGoChecks.length} check missing: ${distanceToGoChecks.join(", ")}`;

    return {
      ...item,
      hard_persistence_pass: hardPersistencePass,
      early_signal_pass: earlySignalPass,
      pre_go_watch: preGoWatch || healthyEarlyExecutionSignal,
      blocked_by_persistence_only: blockedByPersistenceOnly,
      edge_strong_but_immature: edgeStrongButImmature,
      healthy_early_execution_signal: healthyEarlyExecutionSignal,
      required_persistence_ticks: requiredPersistenceTicks,
      current_persistence_ticks: item.persistence_ticks,
      persistence_gap: persistenceGap,
      required_lifetime_minutes: requiredLifetimeMinutes,
      current_lifetime_minutes: item.lifetime_minutes,
      lifetime_gap: Number(lifetimeGap.toFixed(1)),
      distance_to_go_checks: distanceToGoChecks,
      distance_to_go_summary: distanceToGoSummary,
      opening_trial_candidate: openingTrialCandidate,
      opening_trial_reason: openingTrialReason,
      opening_trial_passed_checks: passedChecks,
      opening_trial_failed_checks: failedChecks,
      entry_readiness_timestamp: entryReadinessTimestamp,
      opening_trial_decision: openingTrialDecision
    };
  });

  const openingTrialAudits = buildOpeningTrialAudit(openingTrialEvaluated);
  const evaluatedFinal = openingTrialEvaluated.map((item) => ({
    ...item,
    ...(openingTrialAudits.get(executionTimelineKey(item)) ?? {
      post_entry_peak_bps: 0,
      post_entry_worst_bps: 0,
      minutes_until_peak: null,
      minutes_until_invalidated: null,
      entry_to_exit_outcome_bps: 0,
      paper_trade_exit_ts: null,
      paper_trade_hold_minutes: null,
      paper_trade_exit_reason: "no_entry"
    })
  })).map((item) => {
    const paperTradeStarted = item.opening_trial_candidate;
    const paperTradeClosed = paperTradeStarted && item.paper_trade_exit_ts !== null;
    const paperTradePnl = item.entry_to_exit_outcome_bps;
    return {
      ...item,
      paper_trade_started: paperTradeStarted,
      paper_trade_closed: paperTradeClosed,
      paper_trade_outcome:
        !paperTradeStarted ? "not_started" : paperTradePnl > 0 ? "profit" : paperTradePnl < 0 ? "loss" : "flat",
      paper_trade_positive: paperTradeStarted && paperTradePnl > 0,
      paper_trade_pnl_bps: paperTradePnl,
      paper_trade_max_favorable_bps: item.post_entry_peak_bps,
      paper_trade_max_adverse_bps: item.post_entry_worst_bps
    };
  });

  const topMarketOpps = dedupeByRegime(
    evaluatedFinal
      .filter((item) => item.decision_capable_market_signal)
      .sort((a, b) => b.score - a.score)
  ).slice(0, 3);

  const topExecutionOpps = evaluatedFinal
    .filter(
      (item) =>
        item.decision_capable_execution_signal ||
        item.execution_recommendation_state === "conditional_execution"
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const topOpps = [...topExecutionOpps, ...topMarketOpps]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const nearTopOpps = evaluatedFinal
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

  const executionReadyXarb = evaluatedFinal.filter(
    (item) =>
      item.strategy === "xarb_spot" &&
      item.decision_capable_execution_signal &&
      item.execution_recommendation_state === "execution_ready" &&
      (item.taker_net_edge_bps ?? 0) > 0
  );
  const conditionalExecutionXarb = evaluatedFinal.filter(
    (item) => item.strategy === "xarb_spot" && item.execution_recommendation_state === "conditional_execution"
  );
  const watchOnlyFragileXarb = evaluatedFinal.filter(
    (item) => item.strategy === "xarb_spot" && item.execution_recommendation_state === "watch_only"
  );
  const persistenceBlockedCandidates = evaluatedFinal
    .filter((item) => item.strategy === "xarb_spot" && item.blocked_by_persistence_only)
    .sort((a, b) => (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0))
    .slice(0, 5);
  const healthyEarlyExecutionCandidates = evaluatedFinal
    .filter((item) => item.strategy === "xarb_spot" && item.healthy_early_execution_signal)
    .sort(
      (a, b) =>
        (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0) ||
        a.distance_to_go_checks.length - b.distance_to_go_checks.length
    )
    .slice(0, 5)
    .map((item) => ({
      ...item,
      attention_reason: `${item.symbol} kozelit a nyithato allapothoz, persistence megerosites szukseges`,
      next_confirmation:
        item.persistence_gap > 0
          ? `${item.persistence_gap} tovabbi tick kell`
          : item.lifetime_gap > 0
            ? `${item.lifetime_gap.toFixed(1)} perc tovabbi lifetime kell`
            : item.distance_to_go_summary
    }));
  const fragileExecutionCandidates = evaluatedFinal
    .filter(
      (item) =>
        item.strategy === "xarb_spot" &&
        (item.execution_fragile || (item.taker_net_edge_bps ?? 0) <= 0 || item.execution_recommendation_state === "conditional_execution")
    )
    .sort((a, b) => (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0))
    .slice(0, 5);
  const earlyAttentionCandidates = evaluatedFinal
    .filter((item) => item.strategy === "xarb_spot" && (item.pre_go_watch || item.edge_strong_but_immature))
    .sort((a, b) => (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0))
    .slice(0, 5)
    .map((item) => ({
      ...item,
      attention_reason:
        item.pre_go_watch
          ? "Pozitív taker nettós setup figyelendő, persistence hiányzik"
          : "Erős edge, de még éretlen execution signal",
      next_confirmation: item.persistence_ticks < 3 ? "következő tick megerősítés kell" : "további életidő kell"
    }));
  const goCandidatesNow = evaluatedFinal
    .filter((item) => item.opening_trial_decision === "go")
    .sort((a, b) => (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0))
    .slice(0, 5)
    .map((item) => ({
      ...item,
      why_now: item.opening_trial_reason,
      entry_window_open: true,
      minutes_since_go: Number(((Date.now() - new Date(item.entry_readiness_timestamp ?? item.ts).getTime()) / 60000).toFixed(1)),
      current_signal_state: item.execution_recommendation_state,
      risk_if_enter_now: item.post_entry_worst_bps < 0 ? "edge already showed downside risk after signal" : "no immediate adverse move seen in observed window"
    }));
  const watchMoreCandidatesNow = evaluatedFinal
    .filter((item) => item.opening_trial_decision === "watch_more")
    .sort((a, b) => (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0))
    .slice(0, 5)
    .map((item) => ({
      ...item,
      why_now: item.opening_trial_reason,
      entry_window_open: false,
      minutes_since_go: null,
      current_signal_state: item.execution_recommendation_state,
      risk_if_enter_now: item.blocked_by_persistence_only ? "setup jó, de persistence megerősítés még hiányzik" : "persistence/lifetime még nem elég stabil"
    }));
  const noGoCandidatesNow = evaluatedFinal
    .filter((item) => item.strategy === "xarb_spot" && item.opening_trial_decision === "no_go")
    .sort((a, b) => (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0))
    .slice(0, 5)
    .map((item) => ({
      ...item,
      why_now: item.opening_trial_reason,
      entry_window_open: false,
      minutes_since_go: null,
      current_signal_state: item.execution_recommendation_state,
      risk_if_enter_now:
        item.opening_trial_failed_checks.includes("positive_taker_edge")
          ? "negative taker edge"
          : item.opening_trial_failed_checks.includes("not_execution_fragile")
            ? "execution fragile"
            : item.opening_trial_failed_checks.includes("min_execution_viability")
              ? "execution viability túl alacsony"
              : "entry gate nem teljesült"
    }));
  const eventFeed = buildEventFeed(evaluatedFinal);
  const profitEvents = evaluatedFinal
    .filter((item) => item.paper_trade_closed && item.paper_trade_positive)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .map((item) => ({
      symbol: item.symbol,
      strategy: item.strategy,
      exchange: item.exchange,
      entry_ts: item.entry_readiness_timestamp,
      exit_ts: item.paper_trade_exit_ts,
      realized_pnl_bps: item.paper_trade_pnl_bps,
      max_favorable_bps: item.paper_trade_max_favorable_bps,
      hold_minutes: item.paper_trade_hold_minutes,
      exit_reason: item.paper_trade_exit_reason
    }));
  const riskEvents = [
    ...eventFeed
      .filter((event) =>
        ["opening_trial_invalidated", "execution_ready_signal_lost", "paper_trade_stopped_out"].includes(event.event_type)
      )
      .map((event) => ({
        event_type: event.event_type,
        symbol: event.symbol,
        strategy: event.strategy,
        exchange: event.exchange,
        ts: event.ts,
        details: event.details
      })),
    ...evaluatedFinal
      .filter((item) => item.paper_trade_closed && !item.paper_trade_positive)
      .map((item) => ({
        event_type: "paper_trade_negative_outcome",
        symbol: item.symbol,
        strategy: item.strategy,
        exchange: item.exchange,
        ts: item.paper_trade_exit_ts ?? item.ts,
        details: `${item.paper_trade_pnl_bps.toFixed(2)} bps, reason=${item.paper_trade_exit_reason}`
      }))
  ]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 25);
  const activeNow = [
    ...goCandidatesNow.map((item) => ({
      kind: "go_candidate",
      symbol: item.symbol,
      strategy: item.strategy,
      exchange: item.exchange,
      state: item.current_signal_state,
      summary: item.why_now
    })),
    ...watchMoreCandidatesNow.slice(0, 2).map((item) => ({
      kind: "watch_more",
      symbol: item.symbol,
      strategy: item.strategy,
      exchange: item.exchange,
      state: item.current_signal_state,
      summary: item.why_now
    })),
    ...healthyEarlyExecutionCandidates.slice(0, 2).map((item) => ({
      kind: "pre_go_watch",
      symbol: item.symbol,
      strategy: item.strategy,
      exchange: item.exchange,
      state: item.execution_recommendation_state,
      summary: item.attention_reason
    })),
    ...earlyAttentionCandidates
      .filter((item) => !item.healthy_early_execution_signal)
      .slice(0, 1)
      .map((item) => ({
        kind: "early_attention",
        symbol: item.symbol,
        strategy: item.strategy,
        exchange: item.exchange,
        state: item.execution_recommendation_state,
        summary: item.attention_reason
    }))
  ].slice(0, 5);
  const happenedRecently = eventFeed.slice(0, 10);
  const totalStrategyCount = (opportunities ?? []).length;
  const marketSignalCount = (opportunities ?? []).filter((row) => row.type === "relative_strength").length;
  const executionSignalCount = (opportunities ?? []).filter((row) => isXarbStrategy(row.type)).length;
  const operationalStatus =
    profitEvents.length > 0
      ? "profit_event_logged"
      : riskEvents.length > 0
        ? "risk_event_logged"
        : goCandidatesNow.length > 0
          ? "go_candidate_live"
          : evaluatedFinal.some((item) => item.paper_trade_started && !item.paper_trade_closed)
            ? "paper_position_active"
            : watchMoreCandidatesNow.length > 0 || evaluatedFinal.some((item) => item.decision_support_state === "watch")
              ? "watching"
              : "idle";
  const userAttentionFlag =
    operationalStatus === "go_candidate_live"
      ? "actionable"
      : operationalStatus === "profit_event_logged" || operationalStatus === "risk_event_logged"
        ? "resolved"
        : operationalStatus === "watching"
          ? "watch"
          : "none";
  const importantNow = goCandidatesNow.length > 0
    ? goCandidatesNow.slice(0, 3).map((item) => ({
        type: "active_go_candidate",
        ts: item.ts,
        headline: `${item.symbol} most nyitható`,
        details: `${item.exchange} · viability ${item.execution_viability_score ?? 0} · taker ${(item.taker_net_edge_bps ?? 0).toFixed(2)} bps`
      }))
    : healthyEarlyExecutionCandidates.length > 0
      ? healthyEarlyExecutionCandidates.slice(0, 3).map((item) => ({
          type: "healthy_early_execution",
          ts: item.ts,
          headline: "Korai, egeszseges execution signal figyelendo",
          details: `${item.symbol} · ${item.exchange} · ${(item.taker_net_edge_bps ?? 0).toFixed(2)} bps taker · ${item.distance_to_go_summary}`
        }))
    : earlyAttentionCandidates.length > 0
      ? earlyAttentionCandidates.slice(0, 3).map((item) => ({
          type: "early_attention",
          ts: item.ts,
          headline: "Korai execution signal érkezett, még nem nyitható",
          details: `${item.symbol} · ${(item.taker_net_edge_bps ?? 0).toFixed(2)} bps taker · ${item.attention_reason}`
        }))
    : watchMoreCandidatesNow.length > 0
      ? watchMoreCandidatesNow.slice(0, 3).map((item) => ({
          type: "watch_more",
          ts: item.ts,
          headline: "Pozitív taker nettós setup figyelendő, persistence hiányzik",
          details: `${item.symbol} · ${item.why_now}`
        }))
      : profitEvents.length > 0
        ? profitEvents.slice(0, 3).map((item) => ({
            type: "profit_event",
            ts: item.exit_ts ?? item.entry_ts ?? new Date().toISOString(),
            headline: `${item.symbol} profit event`,
            details: `${item.realized_pnl_bps.toFixed(2)} bps paper outcome`
          }))
        : riskEvents.length > 0
          ? riskEvents.slice(0, 3).map((item) => ({
              type: "risk_event",
              ts: item.ts,
              headline: `${item.symbol} risk event`,
              details: item.details
            }))
          : [{
              type: "idle",
              ts: new Date().toISOString(),
              headline: "Nincs aktuális akció",
              details:
                executionSignalCount === 0
                  ? "Nincs execution-ready setup, nincs xarb go candidate, a jelen run market-signal dominated és nincs paper action."
                  : noGoCandidatesNow[0]?.why_now ?? "Most nincs execution-ready, nyitható setup."
            }];
  const actionSummary = {
    had_go_candidate_today: evaluatedFinal.some((item) => item.opening_trial_candidate),
    go_candidate_count_24h: evaluatedFinal.filter((item) => item.opening_trial_candidate).length,
    active_go_candidate_now: goCandidatesNow.length > 0,
    paper_trade_started_24h: evaluatedFinal.filter((item) => item.paper_trade_started).length,
    paper_trade_profitable_24h: evaluatedFinal.filter((item) => item.paper_trade_positive).length,
    paper_trade_stopped_24h: evaluatedFinal.filter((item) => item.paper_trade_closed && !item.paper_trade_positive).length,
    best_paper_outcome_bps: evaluatedFinal.reduce((best, item) => Math.max(best, item.paper_trade_pnl_bps), 0),
    worst_paper_outcome_bps: evaluatedFinal.reduce((worst, item) => Math.min(worst, item.paper_trade_pnl_bps), 0)
  };
  const rawXarbRows = evaluatedFinal.filter((item) => isXarbStrategy(item.strategy));
  const xarbAfterCosts = rawXarbRows.filter((item) => item.maker_net_edge_bps > 0);
  const xarbAfterPersistence = xarbAfterCosts.filter((item) => item.hard_persistence_pass || item.early_signal_pass);
  const xarbAfterExecutionViability = xarbAfterPersistence.filter(
    (item) => (item.execution_viability_score ?? 0) >= 80 && (item.taker_net_edge_bps ?? 0) > 0 && !item.execution_fragile
  );
  const xarbAfterOpeningGate = xarbAfterExecutionViability.filter(
    (item) => item.opening_trial_decision === "go" || item.opening_trial_decision === "watch_more"
  );
  const xarbPromotedToGo = xarbAfterOpeningGate.filter((item) => item.opening_trial_candidate);
  const xarbCandidatesMissingFromRun = Math.max(0, rawXarbRows.length - evaluatedFinal.filter((item) => isXarbStrategy(item.strategy)).length);
  const xarbIngestCount = (opportunities ?? []).filter((row) => isXarbStrategy(row.type)).length;
  const xarbEvaluatedCount = rawXarbRows.length;
  const xarbReportedCount =
    executionReadyXarb.length +
    conditionalExecutionXarb.length +
    watchOnlyFragileXarb.length +
    earlyAttentionCandidates.length +
    persistenceBlockedCandidates.length;
  const xarbStrategyActive = true;
  const executionAbsenceReason =
    xarbIngestCount === 0
      ? "xarb_not_triggered"
      : xarbEvaluatedCount === 0
        ? "xarb_data_missing"
        : xarbAfterCosts.length === 0
          ? "no_valid_market_opportunity"
          : xarbAfterOpeningGate.length === 0
            ? "xarb_filtered_out"
            : xarbPromotedToGo.length === 0
              ? "xarb_filtered_out"
              : "no_valid_market_opportunity";
  const xarbCoverageSummary = Object.values(
    rawXarbRows.reduce((acc, item) => {
      const key = item.exchange;
      const current = acc[key] ?? {
        exchange_pair: key,
        raw_candidates: 0,
        passed_cost_filter: 0,
        passed_persistence_filter: 0,
        passed_execution_viability: 0,
        produced_reportable_signal: 0
      };
      current.raw_candidates += 1;
      if (item.maker_net_edge_bps > 0) current.passed_cost_filter += 1;
      if (item.hard_persistence_pass || item.early_signal_pass) current.passed_persistence_filter += 1;
      if ((item.execution_viability_score ?? 0) >= 80 && (item.taker_net_edge_bps ?? 0) > 0 && !item.execution_fragile) {
        current.passed_execution_viability += 1;
      }
      if (item.opening_trial_decision === "go" || item.opening_trial_decision === "watch_more" || item.pre_go_watch) {
        current.produced_reportable_signal += 1;
      }
      acc[key] = current;
      return acc;
    }, {} as Record<
      string,
      {
        exchange_pair: string;
        raw_candidates: number;
        passed_cost_filter: number;
        passed_persistence_filter: number;
        passed_execution_viability: number;
        produced_reportable_signal: number;
      }
    >)
  ).sort((a, b) => b.raw_candidates - a.raw_candidates);
  const xarbRejectedRawSignals = rawXarbRows
    .filter((item) => !item.opening_trial_candidate)
    .sort((a, b) => (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0))
    .slice(0, 5)
    .map((item) => ({
      ts: item.ts,
      symbol: item.symbol,
      strategy: item.strategy,
      exchange: item.exchange,
      maker_net_edge_bps: item.maker_net_edge_bps,
      taker_net_edge_bps: item.taker_net_edge_bps,
      reject_reason:
        item.opening_trial_failed_checks.includes("positive_taker_edge")
          ? "negative_taker"
          : item.opening_trial_failed_checks.includes("min_execution_viability")
            ? "low_execution_viability"
            : item.opening_trial_failed_checks.includes("min_persistence_ticks") ||
                item.opening_trial_failed_checks.includes("min_lifetime_minutes")
              ? "insufficient_persistence"
              : item.maker_net_edge_bps <= 0
                ? "insufficient_edge"
                : "no_cross_exchange_dislocation"
    }));
  const strategyMixHealth = {
    market_signal_share: totalStrategyCount > 0 ? Number((marketSignalCount / totalStrategyCount).toFixed(4)) : 0,
    execution_signal_share: totalStrategyCount > 0 ? Number((executionSignalCount / totalStrategyCount).toFixed(4)) : 0,
    expected_execution_signal_share: 0.1,
    strategy_mix_warning:
      executionSignalCount === 0
        ? "execution_share_zero"
        : executionSignalCount / Math.max(1, totalStrategyCount) < 0.1
          ? "execution_share_low"
          : "balanced"
  };
  const xrpOrSolRegime = evaluatedFinal
    .filter((item) => item.strategy === "relative_strength")
    .slice(0, 3)
    .map((item) => `${item.symbol}`)
    .join(" / ");
  const whatHappenedToday = [
    `volt ${actionSummary.go_candidate_count_24h} go execution setup`,
    `ebből ${actionSummary.paper_trade_started_24h} paper-trade-ready volt`,
    goCandidatesNow.length > 0 ? "maradt aktív go a latest snapshotban" : "nem maradt aktív go a latest snapshotban",
    `volt ${conditionalExecutionXarb.length} conditional execution setup`,
    `volt ${healthyEarlyExecutionCandidates.length} egészséges korai execution signal`,
    `volt ${earlyAttentionCandidates.length} korai execution signal, amit még a persistence tartott vissza`,
    executionSignalCount === 0 ? "az execution ág nem adott reportolható xarb inputot" : `az execution ág ${executionSignalCount} nyers xarb opportunity-t látott`,
    xrpOrSolRegime ? `market regime oldalon ${xrpOrSolRegime} dominancia látszott` : "market regime oldalon nem volt erős dominancia"
  ];
  const eventFeedWithAbsence =
    type !== "latest" && actionSummary.go_candidate_count_24h === 0
      ? [
          {
            event_type: "execution_signal_absent",
            ts: latestTick?.ts ?? new Date().toISOString(),
            strategy: "xarb_spot",
            symbol: "-",
            exchange: "-",
            severity: "info" as const,
            headline: "24h alatt nem volt xarb action",
            details: `execution_absence_reason=${executionAbsenceReason}`
          },
          ...eventFeed
        ]
      : eventFeed;
  const executionReadyRankings = {
    by_taker_positive_margin: executionReadyXarb
      .slice()
      .sort((a, b) => (b.taker_positive_margin_bps ?? 0) - (a.taker_positive_margin_bps ?? 0))
      .slice(0, 5),
    by_stability: executionReadyXarb
      .slice()
      .sort((a, b) => (b.net_edge_stability_score ?? 0) - (a.net_edge_stability_score ?? 0))
      .slice(0, 5),
    by_persistence: executionReadyXarb
      .slice()
      .sort((a, b) => b.persistence_ticks - a.persistence_ticks || b.lifetime_minutes - a.lifetime_minutes)
      .slice(0, 5),
    by_paper_trade_readiness: executionReadyXarb
      .slice()
      .sort((a, b) => Number(b.paper_trade_ready) - Number(a.paper_trade_ready) || (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0))
      .slice(0, 5)
  };
  const bestExecutionReady = executionReadyXarb
    .slice()
      .sort((a, b) => (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0))[0] ?? null;

  return {
    operational_status: operationalStatus,
    user_attention_flag: userAttentionFlag,
    important_now: importantNow,
    go_candidates_now:
      goCandidatesNow.length > 0
        ? goCandidatesNow
        : [{
            entry_window_open: false,
            why_now:
              earlyAttentionCandidates.length > 0
                ? "van korai execution signal, de persistence megerősítés kell"
                : watchMoreCandidatesNow.length > 0
                  ? "csak conditional vagy watch-more setup van"
                : evaluatedFinal.some((item) => item.strategy === "relative_strength")
                  ? "csak market-signal van"
                  : "nincs execution-ready setup",
            current_signal_state: "idle",
            risk_if_enter_now: "nincs belépési ablak",
            minutes_since_go: null
          }],
    active_now: activeNow,
    happened_recently: happenedRecently,
    event_feed: eventFeedWithAbsence.slice(0, type === "latest" ? 20 : 60),
    run_meta: {
      run_id: latestTick?.id ?? null,
      time_window: type,
      exchanges: [...new Set((opportunities ?? []).map((x) => x.exchange))],
      strategies: [...new Set((opportunities ?? []).map((x) => x.type))],
      tick_interval_minutes: 10,
      opportunity_query_limit: opportunityLimit,
      opportunity_rows_returned: (opportunities ?? []).length,
      opportunity_limit_hit: (opportunities ?? []).length >= opportunityLimit,
      decision_query_limit: decisionLimit,
      decision_rows_returned: allDecisions.length
    },
    system_health: {
      ingest_inserted: (opportunities ?? []).length,
      ingest_skipped: normalizeNumber(latestTick?.ingest_errors),
      errors: (latestTick?.detect_summary as any)?.errors ?? []
    },
    top_opportunities: topOpps,
    top_market_opportunities: topMarketOpps,
    top_execution_opportunities: topExecutionOpps,
    execution_ready_xarb_opportunities: executionReadyXarb,
    conditional_execution_xarb_opportunities: conditionalExecutionXarb,
    watch_only_fragile_xarb_opportunities: watchOnlyFragileXarb,
    execution_ready_rankings: executionReadyRankings,
    watch_more_candidates_now: watchMoreCandidatesNow,
    no_go_candidates_now: noGoCandidatesNow,
    pre_go_watch_now: healthyEarlyExecutionCandidates,
    early_attention_candidates: earlyAttentionCandidates,
    healthy_early_execution_candidates: healthyEarlyExecutionCandidates,
    fragile_execution_candidates: fragileExecutionCandidates,
    persistence_blocked_candidates: persistenceBlockedCandidates,
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
      global_execution_decision_capable_count: evaluatedFinal.filter((x) => x.qualified_for_decision_capable).length,
      strategy_local_decision_capable_count: evaluatedFinal.filter((x) => x.strategy_local_decision_capable).length,
      decision_capable_market_signal_count: evaluatedFinal.filter((x) => x.decision_capable_market_signal).length,
      decision_capable_execution_signal_count: evaluatedFinal.filter((x) => x.decision_capable_execution_signal).length,
      decision_capable_opportunities: evaluatedFinal.filter((x) => x.qualified_for_decision_capable).length,
      top_opportunities_count: topOpps.length,
      top_market_opportunities_count: topMarketOpps.length,
      top_execution_opportunities_count: topExecutionOpps.length,
      near_decision_capable_count: evaluatedFinal.filter((x) => x.decision_support_state === "near_decision_capable").length,
      execution_fragile_count: evaluatedFinal.filter((x) => x.execution_fragile).length,
      execution_conditionally_viable_count: evaluatedFinal.filter((x) => x.execution_recommendation_state === "conditional_execution").length,
      execution_ready_count: evaluatedFinal.filter((x) => x.execution_recommendation_state === "execution_ready").length,
      failed_due_to_consumed_risk: countFailed(evaluatedFinal, "high_consumption_risk"),
      failed_due_to_persistence: countFailed(evaluatedFinal, "insufficient_persistence"),
      failed_due_to_insufficient_edge: countFailed(evaluatedFinal, "insufficient_edge_for_top"),
      failed_due_to_execution_fragility: countFailed(evaluatedFinal, "execution_fragile"),
      failed_due_to_strategy_filter: evaluatedFinal.filter((x) =>
        x.failed_checks.some((check) => check.startsWith("strategy_filter"))
      ).length,
      chosen_count: allDecisions.filter((d) => d.chosen).length,
      skipped_count: allDecisions.filter((d) => !d.chosen).length
    },
    execution_summary: {
      execution_ready_count: executionReadyXarb.length,
      paper_trade_ready_count: executionReadyXarb.filter((item) => item.paper_trade_ready).length,
      conditional_execution_count: conditionalExecutionXarb.length,
      watch_only_fragile_count: watchOnlyFragileXarb.length,
      positive_taker_count: evaluatedWithAudit.filter((item) => item.strategy === "xarb_spot" && (item.taker_net_edge_bps ?? 0) > 0).length,
      avg_positive_taker_bps: Number(
        average(
          evaluatedWithAudit
            .filter((item) => item.strategy === "xarb_spot" && (item.taker_net_edge_bps ?? 0) > 0)
            .map((item) => item.taker_net_edge_bps ?? 0)
        ).toFixed(4)
      ),
      best_execution_ready_symbol: bestExecutionReady?.symbol ?? null,
      best_execution_ready_exchange_pair: bestExecutionReady?.exchange ?? null
    },
    execution_pipeline_diagnostics: {
      raw_xarb_candidates_seen: rawXarbRows.length,
      xarb_candidates_after_costs: xarbAfterCosts.length,
      xarb_candidates_after_persistence_filter: xarbAfterPersistence.length,
      xarb_candidates_after_execution_viability_filter: xarbAfterExecutionViability.length,
      xarb_candidates_after_opening_gate: xarbAfterOpeningGate.length,
      xarb_candidates_promoted_to_go: xarbPromotedToGo.length,
      xarb_candidates_missing_from_run: xarbCandidatesMissingFromRun,
      xarb_strategy_active: xarbStrategyActive,
      xarb_ingest_count: xarbIngestCount,
      xarb_evaluated_count: xarbEvaluatedCount,
      xarb_reported_count: xarbReportedCount
    },
    execution_absence_reason: executionAbsenceReason,
    xarb_coverage_summary: xarbCoverageSummary,
    xarb_rejected_raw_signals: xarbRejectedRawSignals,
    strategy_mix_health: strategyMixHealth,
    action_summary: actionSummary,
    opening_trial_summary: {
      opening_trial_candidate_count: evaluatedFinal.filter((item) => item.opening_trial_candidate).length,
      execution_ready_xarb_count: executionReadyXarb.length,
      paper_trade_ready_count: executionReadyXarb.filter((item) => item.paper_trade_ready).length,
      healthy_early_execution_count: evaluatedFinal.filter((item) => item.healthy_early_execution_signal).length,
      fragile_execution_count: evaluatedFinal.filter(
        (item) =>
          item.strategy === "xarb_spot" &&
          (item.execution_fragile || (item.taker_net_edge_bps ?? 0) <= 0 || item.execution_recommendation_state === "conditional_execution")
      ).length,
      near_go_but_not_ready_count: evaluatedFinal.filter(
        (item) => item.strategy === "xarb_spot" && item.pre_go_watch && !item.opening_trial_candidate
      ).length,
      blocked_by_persistence_only_count: evaluatedFinal.filter((item) => item.blocked_by_persistence_only).length,
      early_attention_candidate_count: earlyAttentionCandidates.length,
      positive_taker_but_short_lived_count: evaluatedFinal.filter(
        (item) =>
          item.strategy === "xarb_spot" &&
          (item.taker_net_edge_bps ?? 0) > 0 &&
          (item.persistence_ticks < 3 || item.lifetime_minutes < 30)
      ).length,
      watch_more_due_to_persistence_count: evaluatedFinal.filter(
        (item) => item.opening_trial_decision === "watch_more" && item.blocked_by_persistence_only
      ).length,
      rejected_due_to_low_persistence: evaluatedFinal.filter(
        (item) =>
          item.strategy === "xarb_spot" &&
          item.opening_trial_failed_checks.includes("min_persistence_ticks")
      ).length,
      rejected_due_to_negative_taker: evaluatedFinal.filter(
        (item) =>
          item.strategy === "xarb_spot" &&
          item.opening_trial_failed_checks.includes("positive_taker_edge")
      ).length,
      rejected_due_to_execution_fragility: evaluatedFinal.filter(
        (item) =>
          item.strategy === "xarb_spot" &&
          item.opening_trial_failed_checks.includes("not_execution_fragile")
      ).length,
      rejected_due_to_low_execution_viability: evaluatedFinal.filter(
        (item) =>
          item.strategy === "xarb_spot" &&
          item.opening_trial_failed_checks.includes("min_execution_viability")
      ).length
    },
    near_decision_capable_breakdown: summarizeNearDecisionClusters(evaluatedFinal),
    consumed_risk_diagnostics: {
      scored_items: evaluatedFinal.length,
      non_zero_count: evaluatedFinal.filter((x) => x.consumed_risk_score > 0).length,
      max_score: evaluatedFinal.reduce((max, item) => Math.max(max, item.consumed_risk_score), 0),
      source_decisions_sampled: allDecisions.length,
      opportunity_already_consumed_count: allDecisions.filter((d) => d.reject_reason === "opportunity_already_consumed").length
    },
    relative_strength_summary: summarizeRelativeStrength(evaluatedFinal),
    strategy_filter_diagnostics: summarizeStrategyDiagnostics(evaluatedFinal),
    profit_events: profitEvents,
    risk_events: riskEvents,
    what_happened_today: whatHappenedToday,
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
