import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import ReportExportButtons from "@/components/ReportExportButtons";
import AdvancedViewTable from "@/components/AdvancedViewTable";
import StrategyLearningPanel from "@/components/StrategyLearningPanel";
import AutoRefreshClient from "@/components/AutoRefreshClient";
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

type PositionRow = {
  symbol: string;
  entry_ts: string | null;
  exit_ts: string | null;
};

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

  const [{ data: latestTick }, { data: opportunities }, { data: snapshots }, { data: positions }] = await Promise.all([
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
      .limit(20),
    supabase
      .from("market_snapshots")
      .select("ts, symbol, spot_bid, spot_ask")
      .gte("ts", snapshotsSince)
      .order("ts", { ascending: false })
      .limit(5000),
    supabase
      .from("positions")
      .select("symbol, entry_ts, exit_ts")
      .order("entry_ts", { ascending: false })
      .limit(80)
  ]);

  const typedOpportunities = (opportunities ?? []) as OpportunityRow[];
  const ranked = typedOpportunities
    .map((opp) => {
      const evaluation = scoreOpportunity(opp);
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

  const learningOpportunitySeries = typedOpportunities.slice(0, 40).map((opp) => {
    const evaluation = scoreOpportunity(opp);
    return {
      ts: opp.ts,
      symbol: opp.symbol,
      strategy: opp.type,
      decision: evaluation.decision,
      score: evaluation.score,
      reason: evaluation.reason,
      net_edge_bps: evaluation.maker_net_edge_bps,
      break_even_hours: asNumber(opp.details?.break_even_hours, 0),
      risk_score: 100 - evaluation.score
    };
  });

  const learningTradeSeries = ((positions ?? []) as PositionRow[]).map((p) => ({
    symbol: p.symbol,
    entry_ts: p.entry_ts,
    exit_ts: p.exit_ts
  }));

  const liveAdvancedRows = typedOpportunities.slice(0, 20).map((opp) => {
    const evaluation = scoreOpportunity(opp);
    return {
      ts: opp.ts,
      strategy: opp.type,
      symbol: opp.symbol,
      score: evaluation.score,
      decision: evaluation.decision,
      reason: evaluation.auto_trade_exclusion_reasons.join(", ") || evaluation.reason
    };
  });

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
        <h2 className="text-xl font-semibold">Learning View</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Árfolyam görbe + stratégia döntési pontok (belépési helyek). Válassz symbolt és nézd az overlay jelöléseket.
        </p>
        <StrategyLearningPanel
          snapshots={learningSnapshotSeries}
          opportunities={learningOpportunitySeries}
          trades={learningTradeSeries}
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
