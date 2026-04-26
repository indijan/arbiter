import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import ReportExportButtons from "@/components/ReportExportButtons";
import AdvancedViewTable from "@/components/AdvancedViewTable";
import AutoRefreshClient from "@/components/AutoRefreshClient";
import ExecutionReadinessPanel from "@/components/ExecutionReadinessPanel";
import OperationalStatusPanel from "@/components/OperationalStatusPanel";
import DecisionViewPanel from "@/components/DecisionViewPanel";
import { evaluateOpportunity } from "@/lib/decision/evaluator";

type OpportunityRow = {
  id: number;
  ts: string;
  exchange: string;
  symbol: string;
  type: string;
  net_edge_bps: number | string | null;
  confidence: number | string | null;
  details: Record<string, unknown> | null;
};

type TickRow = {
  ts: string;
  ingest_errors: number;
  detect_summary: Record<string, unknown> | null;
};

type SnapshotPoint = {
  ts: string;
  symbol: string;
  spot_bid: number | string | null;
  spot_ask: number | string | null;
};

function canonicalSymbol(raw: string) {
  return raw.replace(/USDT$/i, "USD");
}

function learningSymbolsFrom(opportunities: OpportunityRow[]) {
  const counts = new Map<string, number>();
  for (const opportunity of opportunities) {
    const canonical = canonicalSymbol(opportunity.symbol);
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
  }

  const preferred = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([symbol]) => symbol);

  if (preferred.length > 0) return preferred;
  return ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD"];
}

function snapshotSymbolVariants(symbols: string[]) {
  return Array.from(
    new Set(
      symbols.flatMap((symbol) => {
        const base = symbol.replace(/USDT$/i, "").replace(/USD$/i, "");
        return [`${base}USD`, `${base}USDT`];
      })
    )
  );
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatTs(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("hu-HU");
}

function scoreOpportunity(opportunity: OpportunityRow) {
  return evaluateOpportunity({
    strategy: opportunity.type,
    exchange: opportunity.exchange,
    symbol: opportunity.symbol,
    net_edge_bps: asNumber(opportunity.net_edge_bps),
    metadata: opportunity.details ?? {},
    persistence_ticks: 1,
    first_seen_ts: opportunity.ts,
    last_seen_ts: opportunity.ts,
    lifetime_minutes: 0,
    consumed_risk_score: 0
  });
}

function whyInteresting(opportunity: OpportunityRow) {
  const type = opportunity.type;
  if (type.includes("carry")) return "Funding + basis különbség tiszta carry setupot jelez.";
  if (type.includes("xarb") || type.includes("cross")) return "Két piaci helyszín közt tartós árelőny látszik.";
  if (type.includes("tri")) return "Háromszög útvonalon kalkulálható bruttó él jelent meg.";
  return "A nettó edge és a confidence együtt átlag feletti opportunity-t ad.";
}

function canAuto(decision: string) {
  return decision === "future_auto_candidate" || decision === "paper_candidate";
}

function buildOpportunityPersistence(opportunities: OpportunityRow[]) {
  const map = new Map<string, { count: number; first: string; last: string }>();
  for (const opportunity of opportunities) {
    const key = `${opportunity.type}:${opportunity.exchange}:${opportunity.symbol}`;
    const current = map.get(key) ?? { count: 0, first: opportunity.ts, last: opportunity.ts };
    current.count += 1;
    if (opportunity.ts < current.first) current.first = opportunity.ts;
    if (opportunity.ts > current.last) current.last = opportunity.ts;
    map.set(key, current);
  }
  return map;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export default async function DashboardPage() {
  const supabase = createServerSupabase();
  if (!supabase) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="card">
          <h1 className="text-2xl font-semibold">Arbiter v2 Watcher</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>Supabase env hiányzik.</p>
        </div>
      </div>
    );
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const snapshotsSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: latestTick }, { data: opportunities }] = await Promise.all([
    supabase
      .from("system_ticks")
      .select("ts, ingest_errors, detect_summary")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle<TickRow>(),
    supabase
      .from("opportunities")
      .select("id, ts, exchange, symbol, type, net_edge_bps, confidence, details")
      .order("ts", { ascending: false })
      .limit(80)
  ]);

  const typedOpportunities = (opportunities ?? []) as OpportunityRow[];
  const persistence = buildOpportunityPersistence(typedOpportunities);
  const learningSymbols = learningSymbolsFrom(typedOpportunities);
  const snapshotSymbols = snapshotSymbolVariants(learningSymbols);
  const { data: snapshots } = await supabase
    .from("market_snapshots")
    .select("ts, symbol, spot_bid, spot_ask")
    .in("symbol", snapshotSymbols)
    .gte("ts", snapshotsSince)
    .order("ts", { ascending: false })
    .limit(20000);

  const ranked = typedOpportunities
    .map((opp) => {
      const key = `${opp.type}:${opp.exchange}:${opp.symbol}`;
      const seen = persistence.get(key);
      const lifetime = seen ? (new Date(seen.last).getTime() - new Date(seen.first).getTime()) / 60000 : 0;
      const evaluation = evaluateOpportunity({
        strategy: opp.type,
        exchange: opp.exchange,
        symbol: opp.symbol,
        net_edge_bps: asNumber(opp.net_edge_bps),
        metadata: opp.details ?? {},
        persistence_ticks: seen?.count ?? 1,
        first_seen_ts: seen?.first ?? opp.ts,
        last_seen_ts: seen?.last ?? opp.ts,
        lifetime_minutes: lifetime,
        consumed_risk_score: 0
      });
      return { opp, score: evaluation.score, decision: evaluation.decision, evaluation };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const hasOpportunity = ranked.some((r) => r.decision !== "ignore");
  const latestTickTs = latestTick?.ts ?? null;
  const marketCount = new Set(typedOpportunities.map((o) => `${o.exchange}:${o.symbol}`)).size;
  const learningSnapshotSeries = ((snapshots ?? []) as SnapshotPoint[])
    .map((point) => {
      const bid = asNumber(point.spot_bid);
      const ask = asNumber(point.spot_ask);
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
      return { ts: point.ts, symbol: point.symbol, mid };
    })
    .filter((x) => x.mid > 0);

  const liveAdvancedRows = typedOpportunities.slice(0, 20).map((opp) => {
    const key = `${opp.type}:${opp.exchange}:${opp.symbol}`;
    const seen = persistence.get(key);
    const lifetime = seen ? (new Date(seen.last).getTime() - new Date(seen.first).getTime()) / 60000 : 0;
    const evaluation = evaluateOpportunity({
      strategy: opp.type,
      exchange: opp.exchange,
      symbol: opp.symbol,
      net_edge_bps: asNumber(opp.net_edge_bps),
      metadata: opp.details ?? {},
      persistence_ticks: seen?.count ?? 1,
      first_seen_ts: seen?.first ?? opp.ts,
      last_seen_ts: seen?.last ?? opp.ts,
      lifetime_minutes: lifetime,
      consumed_risk_score: 0
    });
    return {
      ts: opp.ts,
      strategy: opp.type,
      symbol: opp.symbol,
      score: evaluation.score,
      decision: evaluation.decision,
      reason: evaluation.auto_trade_exclusion_reasons.join(", ") || evaluation.reason
    };
  });
  const executionRows = typedOpportunities
    .filter((opp) => opp.type === "xarb_spot")
    .map((opp) => {
      const key = `${opp.type}:${opp.exchange}:${opp.symbol}`;
      const seen = persistence.get(key);
      const lifetime = seen ? (new Date(seen.last).getTime() - new Date(seen.first).getTime()) / 60000 : 0;
      const evaluation = evaluateOpportunity({
        strategy: opp.type,
        exchange: opp.exchange,
        symbol: opp.symbol,
        net_edge_bps: asNumber(opp.net_edge_bps),
        metadata: opp.details ?? {},
        persistence_ticks: seen?.count ?? 1,
        first_seen_ts: seen?.first ?? opp.ts,
        last_seen_ts: seen?.last ?? opp.ts,
        lifetime_minutes: lifetime,
        consumed_risk_score: 0
      });
      const maker = evaluation.maker_net_edge_bps;
      const taker = evaluation.taker_net_edge_bps ?? maker;
      const gap = maker - taker;
      const stability = Math.max(0, Math.min(100, 100 - Math.max(0, gap) * 12));
      const paperPeak = Math.max(maker, taker);
      const paperWorst = Math.min(maker, taker);
      const paperTradeReady =
        evaluation.decision_capable_execution_signal &&
        evaluation.execution_recommendation_state === "execution_ready" &&
        taker > 0 &&
        evaluation.persistence_ticks >= 3 &&
        evaluation.lifetime_minutes >= 60 &&
        !evaluation.execution_fragile &&
        stability >= 60;
      const exclusionReasons = evaluation.auto_trade_exclusion_reasons;
      const openingTrialFailedChecks: string[] = [];
      const requiredPersistenceTicks = 3;
      const requiredLifetimeMinutes = 30;
      if (!evaluation.decision_capable_execution_signal) openingTrialFailedChecks.push("decision_capable_execution_signal");
      if (evaluation.execution_recommendation_state !== "execution_ready") openingTrialFailedChecks.push("execution_ready_state");
      if (taker <= 0) openingTrialFailedChecks.push("positive_taker_edge");
      if (evaluation.execution_fragile) openingTrialFailedChecks.push("not_execution_fragile");
      if (evaluation.persistence_ticks < requiredPersistenceTicks) openingTrialFailedChecks.push("min_persistence_ticks");
      if (evaluation.lifetime_minutes < requiredLifetimeMinutes) openingTrialFailedChecks.push("min_lifetime_minutes");
      if ((evaluation.execution_viability_score ?? 0) < 80) openingTrialFailedChecks.push("min_execution_viability");
      if (!paperTradeReady) openingTrialFailedChecks.push("paper_trade_ready");
      if (exclusionReasons.length > 0) openingTrialFailedChecks.push("no_exclusion_reasons");
      const openingTrialCandidate = openingTrialFailedChecks.length === 0;
      const healthyEarlyExecutionSignal =
        !openingTrialCandidate &&
        evaluation.execution_recommendation_state === "execution_ready" &&
        taker > 0 &&
        !evaluation.execution_fragile &&
        (evaluation.execution_viability_score ?? 0) >= 80 &&
        evaluation.lifetime_minutes >= 20;
      const watchMore =
        evaluation.decision_capable_execution_signal &&
        evaluation.execution_recommendation_state === "execution_ready" &&
        taker > 0 &&
        !evaluation.execution_fragile &&
        (evaluation.execution_viability_score ?? 0) >= 80 &&
        (evaluation.persistence_ticks < 3 || evaluation.lifetime_minutes < 30 || !paperTradeReady);
      const paperTradePnl = Number((paperPeak - Math.max(0, taker)).toFixed(2));

      return {
        id: opp.id,
        ts: opp.ts,
        symbol: opp.symbol,
        exchange: opp.exchange,
        score: evaluation.score,
        maker_net_edge_bps: maker,
        taker_net_edge_bps: evaluation.taker_net_edge_bps,
        persistence_ticks: evaluation.persistence_ticks,
        lifetime_minutes: evaluation.lifetime_minutes,
        execution_recommendation_state: evaluation.execution_recommendation_state,
        execution_viability_score: evaluation.execution_viability_score,
        paper_trade_ready: paperTradeReady,
        execution_grade: stability >= 75 ? "A" : stability >= 55 ? "B" : "C",
        net_edge_stability_score: Number(stability.toFixed(1)),
        paper_peak_bps_after_signal: Number(paperPeak.toFixed(2)),
        paper_worst_bps_after_signal: Number(paperWorst.toFixed(2)),
        paper_exit_reason: taker > 0 ? "carry_until_signal_decay" : "taker_flip_negative",
        time_to_first_decision_capable_minutes: evaluation.decision_capable_execution_signal ? 0 : null,
        opening_trial_candidate: openingTrialCandidate,
        opening_trial_decision: openingTrialCandidate ? "go" : watchMore ? "watch_more" : "no_go",
        opening_trial_reason: openingTrialCandidate
          ? "A kontrollált nyitási gate teljesült."
          : watchMore
            ? "Közel van, de még stabilitás/idő kell."
            : openingTrialFailedChecks[0] ?? "Nincs nyitható setup.",
        opening_trial_failed_checks: openingTrialFailedChecks,
        healthy_early_execution_signal: healthyEarlyExecutionSignal,
        distance_to_go_checks: openingTrialCandidate ? [] : openingTrialFailedChecks,
        distance_to_go_summary: openingTrialCandidate
          ? "go gate passed"
          : `${openingTrialFailedChecks.length} feltétel hiányzik: ${openingTrialFailedChecks.join(", ")}`,
        required_persistence_ticks: requiredPersistenceTicks,
        current_persistence_ticks: evaluation.persistence_ticks,
        persistence_gap: Math.max(0, requiredPersistenceTicks - evaluation.persistence_ticks),
        required_lifetime_minutes: requiredLifetimeMinutes,
        current_lifetime_minutes: evaluation.lifetime_minutes,
        lifetime_gap: Number(Math.max(0, requiredLifetimeMinutes - evaluation.lifetime_minutes).toFixed(1)),
        execution_fragile: evaluation.execution_fragile,
        decision_capable_execution_signal: evaluation.decision_capable_execution_signal,
        entry_readiness_timestamp: openingTrialCandidate ? opp.ts : null,
        paper_trade_started: openingTrialCandidate,
        paper_trade_closed: openingTrialCandidate,
        paper_trade_outcome: !openingTrialCandidate ? "not_started" : paperTradePnl > 0 ? "profit" : paperTradePnl < 0 ? "loss" : "flat",
        paper_trade_positive: openingTrialCandidate && paperTradePnl > 0,
        paper_trade_pnl_bps: openingTrialCandidate ? paperTradePnl : 0,
        paper_trade_max_favorable_bps: paperPeak,
        paper_trade_max_adverse_bps: paperWorst
      };
    })
    .sort((a, b) => {
      const rank = { execution_ready: 3, conditional_execution: 2, watch_only: 1, not_viable: 0, market_signal_only: 0 };
      return (rank[b.execution_recommendation_state as keyof typeof rank] ?? 0) - (rank[a.execution_recommendation_state as keyof typeof rank] ?? 0)
        || (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0);
    })
    .slice(0, 12);
  const executionSummary = {
    execution_ready_count: executionRows.filter((row) => row.execution_recommendation_state === "execution_ready").length,
    paper_trade_ready_count: executionRows.filter((row) => row.paper_trade_ready).length,
    conditional_execution_count: executionRows.filter((row) => row.execution_recommendation_state === "conditional_execution").length,
    watch_only_fragile_count: executionRows.filter((row) => row.execution_recommendation_state === "watch_only").length,
    avg_positive_taker_bps: average(executionRows.filter((row) => (row.taker_net_edge_bps ?? 0) > 0).map((row) => row.taker_net_edge_bps ?? 0))
  };
  const goRows = executionRows.filter((row) => row.opening_trial_decision === "go");
  const watchMoreRows = executionRows.filter((row) => row.opening_trial_decision === "watch_more");
  const profitRows = executionRows.filter((row) => row.paper_trade_positive);
  const riskRows = executionRows.filter(
    (row) =>
      row.opening_trial_failed_checks.includes("positive_taker_edge") ||
      row.opening_trial_failed_checks.includes("not_execution_fragile") ||
      (row.paper_trade_closed && !row.paper_trade_positive && row.opening_trial_candidate)
  );
  const operationalStatus =
    goRows.length > 0
      ? "go_candidate_live"
      : profitRows.length > 0
        ? "profit_event_logged"
        : riskRows.length > 0
          ? "risk_event_logged"
          : watchMoreRows.length > 0 || executionRows.some((row) => row.execution_recommendation_state === "watch_only")
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
  const importantNow =
    goRows.length > 0
      ? goRows.slice(0, 3).map((row) => ({
          type: "active_go_candidate",
          ts: row.ts,
          headline: `${row.symbol} most nyitható`,
          details: `${row.exchange} · taker ${(row.taker_net_edge_bps ?? 0).toFixed(2)} bps · viability ${row.execution_viability_score ?? 0}`
        }))
      : watchMoreRows.length > 0
        ? watchMoreRows.slice(0, 3).map((row) => ({
            type: "watch_more",
            ts: row.ts,
            headline: `${row.symbol} figyelendő`,
            details: row.opening_trial_reason
          }))
        : profitRows.length > 0
          ? profitRows.slice(0, 3).map((row) => ({
              type: "profit_event",
              ts: row.ts,
              headline: `${row.symbol} profit event`,
              details: `${row.paper_trade_pnl_bps.toFixed(2)} bps paper proxy`
            }))
          : [{
              type: "idle",
              ts: latestTickTs ?? new Date().toISOString(),
              headline: "Nincs aktuális akció",
              details: riskRows.length > 0 ? "Volt risk event, de nincs nyitható setup." : "Most nincs execution-ready, nyitható xarb setup."
            }];
  const activeNow = [
    ...goRows.map((row) => ({
      kind: "go_candidate",
      symbol: row.symbol,
      strategy: "xarb_spot",
      exchange: row.exchange,
      state: row.execution_recommendation_state,
      summary: `${row.opening_trial_reason} Taker ${(row.taker_net_edge_bps ?? 0).toFixed(2)} bps.`
    })),
    ...watchMoreRows.slice(0, 2).map((row) => ({
      kind: "watch_more",
      symbol: row.symbol,
      strategy: "xarb_spot",
      exchange: row.exchange,
      state: row.execution_recommendation_state,
      summary: row.opening_trial_reason
    }))
  ].slice(0, 5);
  const operationalEvents = [
    ...goRows.map((row) => ({
      event_type: "opening_trial_go_created",
      ts: row.ts,
      symbol: row.symbol,
      strategy: "xarb_spot",
      exchange: row.exchange,
      severity: "action" as const,
      headline: `${row.symbol} go candidate`,
      details: row.opening_trial_reason
    })),
    ...watchMoreRows.map((row) => ({
      event_type: "execution_ready_signal_detected",
      ts: row.ts,
      symbol: row.symbol,
      strategy: "xarb_spot",
      exchange: row.exchange,
      severity: "watch" as const,
      headline: `${row.symbol} figyelendő`,
      details: row.opening_trial_reason
    })),
    ...profitRows.map((row) => ({
      event_type: "paper_trade_profit_taken",
      ts: row.ts,
      symbol: row.symbol,
      strategy: "xarb_spot",
      exchange: row.exchange,
      severity: "profit" as const,
      headline: `${row.symbol} paper profit`,
      details: `${row.paper_trade_pnl_bps.toFixed(2)} bps paper proxy.`
    })),
    ...riskRows.map((row) => ({
      event_type: "risk_event_logged",
      ts: row.ts,
      symbol: row.symbol,
      strategy: "xarb_spot",
      exchange: row.exchange,
      severity: "risk" as const,
      headline: `${row.symbol} risk / no-go`,
      details: row.opening_trial_failed_checks.join(", ") || "Entry gate nem teljesült."
    }))
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const operationalSummary = {
    had_go_candidate_today: goRows.length > 0,
    go_candidate_count_24h: goRows.length,
    active_go_candidate_now: goRows.length > 0,
    paper_trade_started_24h: executionRows.filter((row) => row.paper_trade_started).length,
    paper_trade_profitable_24h: profitRows.length,
    paper_trade_stopped_24h: executionRows.filter((row) => row.paper_trade_closed && !row.paper_trade_positive).length,
    best_paper_outcome_bps: executionRows.reduce((best, row) => Math.max(best, row.paper_trade_pnl_bps), 0),
    worst_paper_outcome_bps: executionRows.reduce((worst, row) => Math.min(worst, row.paper_trade_pnl_bps), 0)
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--accent)" }}>Watcher-first platform</p>
        <h1 className="mt-1 text-3xl font-semibold">Arbiter v2</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Determinisztikus opportunity szelekció. Nincs runtime AI döntés, nincs automatikus trade trigger.
        </p>
        <div className="mt-2">
          <AutoRefreshClient intervalSec={45} />
        </div>
      </header>

      <section className="mb-6 grid gap-3 md:grid-cols-4">
        <div className="kpi">
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>Rendszer állapot</p>
          <p className="mt-2 text-xl font-semibold">{(latestTick?.ingest_errors ?? 0) === 0 ? "Stabil" : "Figyelmeztetés"}</p>
        </div>
        <div className="kpi">
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>Utolsó update</p>
          <p className="mt-2 text-sm font-medium">{formatTs(latestTickTs)}</p>
        </div>
        <div className="kpi">
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>Figyelt piacok</p>
          <p className="mt-2 text-xl font-semibold">{marketCount}</p>
        </div>
        <div className="kpi">
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>Opportunity</p>
          <p className="mt-2 text-xl font-semibold">{hasOpportunity ? "Van jel" : "Nincs jel"}</p>
        </div>
      </section>

      <OperationalStatusPanel
        status={operationalStatus}
        attention={userAttentionFlag}
        importantNow={importantNow}
        activeNow={activeNow}
        events={operationalEvents}
        summary={operationalSummary}
      />

      <section className="card mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Top Opportunities (max 5)</h2>
          <ReportExportButtons />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {ranked.length > 0 ? (
            ranked.map(({ opp, score, decision }) => (
              <article key={opp.id} className="rounded-2xl border p-4" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--card) 80%, transparent)" }}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{opp.symbol} · {opp.type}</p>
                  <span className={`decision-${decision} text-xs font-semibold`}>{decision}</span>
                </div>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  {whyInteresting(opp)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <p>Erősség: <strong>{score}</strong></p>
                  <p>Kockázat: <strong>{Math.max(1, 100 - score)}</strong></p>
                  <p>Net edge: <strong>{asNumber(opp.net_edge_bps).toFixed(2)} bps</strong></p>
                  <p>Auto-ready: <strong>{canAuto(decision) ? "Igen" : "Még nem"}</strong></p>
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm" style={{ color: "var(--muted)" }}>Nincs opportunity adat.</p>
          )}
        </div>
      </section>

      <section className="card mb-6">
        <h2 className="text-xl font-semibold">Execution Readiness</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Az aktuális xarb setupok execution-validációs nézete: mire nyitott volna a rendszer, mennyire volt stabil az edge, és paper tesztre alkalmas lett volna-e.
        </p>
        <ExecutionReadinessPanel rows={executionRows} summary={executionSummary} />
      </section>

      <section className="card mb-6">
        <h2 className="text-xl font-semibold">Decision View</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Opportunity-alapú entry barométer. A fő fókusz az, hogy hol tart a belépési döntés, és mi hiányzik még a nyitáshoz.
        </p>
        <DecisionViewPanel
          opportunities={executionRows}
          snapshots={learningSnapshotSeries}
          marketSignalCount={typedOpportunities.filter((opp) => opp.type === "relative_strength").length}
        />
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold">Advanced View</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Friss opportunity stream. Ez minden auto refresh ciklusban újraolvasódik.
        </p>
        <AdvancedViewTable rows={liveAdvancedRows} />
      </section>
    </div>
  );
}
