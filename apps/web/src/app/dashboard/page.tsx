import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

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

type DecisionRow = {
  ts: string;
  chosen: boolean;
  score: number | string | null;
  variant: string;
  reject_reason: string | null;
};

type TickRow = {
  ts: string;
  ingest_errors: number;
  detect_summary: Record<string, unknown> | null;
};

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatTs(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("hu-HU");
}

function decisionFromScore(score: number) {
  if (score < 25) return "ignore";
  if (score < 45) return "watch";
  if (score < 65) return "strong_watch";
  if (score < 80) return "paper_candidate";
  return "future_auto_candidate";
}

function scoreOpportunity(opportunity: OpportunityRow) {
  const netEdge = asNumber(opportunity.net_edge_bps);
  const confidence = asNumber(opportunity.confidence, 0.5);
  const funding = asNumber(opportunity.details?.funding_rate);
  const base = netEdge * 3.6 + confidence * 18 + funding * 250;
  return Math.max(0, Math.min(100, Number(base.toFixed(1))));
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

  const [{ data: latestTick }, { data: opportunities }, { data: decisions }, { data: snapshots }] = await Promise.all([
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
      .from("opportunity_decisions")
      .select("ts, chosen, score, variant, reject_reason")
      .order("ts", { ascending: false })
      .limit(20),
    supabase
      .from("market_snapshots")
      .select("ts")
      .order("ts", { ascending: false })
      .limit(40)
  ]);

  const typedOpportunities = (opportunities ?? []) as OpportunityRow[];
  const ranked = typedOpportunities
    .map((opp) => {
      const score = scoreOpportunity(opp);
      const decision = decisionFromScore(score);
      return { opp, score, decision };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const hasOpportunity = ranked.some((r) => r.decision !== "ignore");
  const latestTickTs = latestTick?.ts ?? null;
  const marketCount = new Set(typedOpportunities.map((o) => `${o.exchange}:${o.symbol}`)).size;
  const learningPoints = (snapshots ?? []).slice(0, 24);
  const latestDecisions = (decisions ?? []) as DecisionRow[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--accent)" }}>Watcher-first platform</p>
        <h1 className="mt-1 text-3xl font-semibold">Arbiter v2</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Determinisztikus opportunity szelekció. Nincs runtime AI döntés, nincs automatikus trade trigger.
        </p>
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
          <div className="flex gap-2 text-xs">
            <a className="tag" href="/api/report/export?type=latest">Export Report</a>
            <a className="tag" href="/api/report/export?type=24h">24h</a>
            <a className="tag" href="/api/report/export?type=7d">7d</a>
            <a className="tag" href="/api/report/export?type=strategy&key=carry_spot_perp">Carry</a>
          </div>
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
          Egyszerű idősoros nézet: a legfrissebb snapshot pontok, hogy lásd mit látott a rendszer.
        </p>
        <div className="mt-3 h-44 overflow-hidden rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--card) 76%, transparent)" }}>
          <div className="flex h-full items-end gap-1">
            {learningPoints.length > 0 ? (
              learningPoints
                .slice()
                .reverse()
                .map((point, idx) => {
                  const hour = new Date(point.ts).getHours();
                  const height = 20 + ((hour / 23) * 80);
                  return (
                    <div
                      key={`${point.ts}-${idx}`}
                      className="flex-1 rounded-t"
                      style={{
                        height: `${height}%`,
                        background: "linear-gradient(180deg, var(--accent), color-mix(in oklab, var(--accent) 60%, transparent))"
                      }}
                      title={formatTs(point.ts)}
                    />
                  );
                })
            ) : (
              <p className="text-sm" style={{ color: "var(--muted)" }}>Nincs snapshot adat.</p>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold">Advanced View</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Debug és evaluator output (utolsó döntések) ellenőrzéshez.
        </p>
        <div className="mt-3 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--line)" }}>
          <table className="min-w-full text-sm">
            <thead style={{ background: "color-mix(in oklab, var(--bg-alt) 55%, transparent)" }}>
              <tr>
                <th className="px-3 py-2 text-left">Idő</th>
                <th className="px-3 py-2 text-left">Variant</th>
                <th className="px-3 py-2 text-left">Score</th>
                <th className="px-3 py-2 text-left">Chosen</th>
                <th className="px-3 py-2 text-left">Reject reason</th>
              </tr>
            </thead>
            <tbody>
              {latestDecisions.length > 0 ? (
                latestDecisions.map((row, idx) => (
                  <tr key={`${row.ts}-${idx}`} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="px-3 py-2">{formatTs(row.ts)}</td>
                    <td className="px-3 py-2">{row.variant}</td>
                    <td className="px-3 py-2">{asNumber(row.score).toFixed(1)}</td>
                    <td className="px-3 py-2">{row.chosen ? "yes" : "no"}</td>
                    <td className="px-3 py-2">{row.reject_reason ?? "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-4" style={{ color: "var(--muted)" }}>
                    Nincs decision log.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
