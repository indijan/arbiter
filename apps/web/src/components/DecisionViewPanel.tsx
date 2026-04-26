"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type SnapshotPoint = {
  ts: string;
  symbol: string;
  mid: number;
};

export type DecisionOpportunity = {
  id: number;
  ts: string;
  symbol: string;
  exchange: string;
  maker_net_edge_bps: number;
  taker_net_edge_bps: number | null;
  persistence_ticks: number;
  lifetime_minutes: number;
  execution_recommendation_state: string;
  execution_viability_score: number | null;
  execution_fragile: boolean;
  decision_capable_execution_signal: boolean;
  paper_trade_ready: boolean;
  opening_trial_candidate: boolean;
  opening_trial_decision: string;
  opening_trial_reason: string;
  opening_trial_failed_checks: string[];
  healthy_early_execution_signal: boolean;
  distance_to_go_checks: string[];
  distance_to_go_summary: string;
  required_persistence_ticks: number;
  current_persistence_ticks: number;
  persistence_gap: number;
  required_lifetime_minutes: number;
  current_lifetime_minutes: number;
  lifetime_gap: number;
};

function canonicalSymbol(raw: string) {
  return raw.replace(/USDT$/i, "USD");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function statusFor(row: DecisionOpportunity | null) {
  if (!row) return { label: "Not close", tone: "#64748b", text: "Nincs aktuális xarb execution setup." };
  if (row.opening_trial_candidate) return { label: "Entry ready", tone: "#22c55e", text: "A kontrollált nyitási gate teljesült." };
  if (row.healthy_early_execution_signal || row.opening_trial_decision === "watch_more") {
    return { label: "Near entry", tone: "#f59e0b", text: "A setup közel van, de még nem teljes a belépési kép." };
  }
  if (row.execution_recommendation_state === "watch_only" || row.execution_recommendation_state === "conditional_execution") {
    return { label: "Early watch", tone: "#38bdf8", text: "Figyelhető setup, de még nem vállalható nyitásra." };
  }
  return { label: "Not close", tone: "#64748b", text: "A setup jelenleg nem elég erős belépési döntéshez." };
}

function humanState(state: string) {
  if (state === "watch_only") return "figyelendő, még korai";
  if (state === "conditional_execution") return "ígéretes, de execution-kockázatos";
  if (state === "execution_ready") return "nyitásra kész";
  if (state === "not_viable") return "nem vállalható";
  if (state === "market_signal_only") return "csak piaci háttérjel";
  return state;
}

function checkLabel(check: string) {
  const labels: Record<string, string> = {
    strategy_xarb_spot: "xarb_spot stratégia",
    decision_capable_execution_signal: "execution döntésképes",
    execution_ready_state: "execution-ready állapot",
    positive_taker_edge: "pozitív taker net",
    not_execution_fragile: "nem fragilis",
    min_persistence_ticks: "persistence tick",
    min_lifetime_minutes: "lifetime",
    min_execution_viability: "execution viability",
    paper_trade_ready: "paper-ready",
    no_exclusion_reasons: "nincs kizáró ok"
  };
  return labels[check] ?? check;
}

function Gauge({
  label,
  value,
  threshold,
  unit,
  helper,
  max
}: {
  label: string;
  value: number;
  threshold: number;
  unit: string;
  helper: string;
  max?: number;
}) {
  const cap = max ?? Math.max(threshold * 1.5, value, 1);
  const pct = clamp((value / cap) * 100, 0, 100);
  const thresholdPct = clamp((threshold / cap) * 100, 0, 100);
  const passed = value >= threshold;
  const tone = passed ? "#22c55e" : value >= threshold * 0.66 ? "#f59e0b" : "#ef4444";

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 38%, transparent)" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{helper}</p>
        </div>
        <strong className="text-sm" style={{ color: tone }}>{value.toFixed(unit === "bps" ? 2 : 0)} {unit}</strong>
      </div>
      <div className="relative mt-3 h-3 rounded-full" style={{ background: "color-mix(in oklab, var(--line) 65%, transparent)" }}>
        <div className="h-3 rounded-full" style={{ width: `${pct}%`, background: tone }} />
        <div className="absolute top-[-4px] h-5 w-[2px]" style={{ left: `${thresholdPct}%`, background: "var(--text)" }} />
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>küszöb: {threshold} {unit}</p>
    </div>
  );
}

function BooleanGauge({ label, passed, helper }: { label: string; passed: boolean; helper: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 38%, transparent)" }}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{helper}</p>
      <div className="mt-3 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: passed ? "#22c55e" : "#f59e0b" }} />
        <strong className="text-sm">{passed ? "teljesült" : "még nem"}</strong>
      </div>
    </div>
  );
}

function nearestPoint(ts: string, series: Array<{ epoch: number; mid: number; label: string }>) {
  if (series.length === 0) return null;
  const target = new Date(ts).getTime();
  return series.reduce((best, point) => {
    return Math.abs(point.epoch - target) < Math.abs(best.epoch - target) ? point : best;
  }, series[0]);
}

export default function DecisionViewPanel({
  opportunities,
  snapshots,
  marketSignalCount
}: {
  opportunities: DecisionOpportunity[];
  snapshots: SnapshotPoint[];
  marketSignalCount: number;
}) {
  const ranked = useMemo(() => {
    return opportunities
      .slice()
      .sort((a, b) => {
        const aRank = a.opening_trial_candidate ? 4 : a.healthy_early_execution_signal ? 3 : a.opening_trial_decision === "watch_more" ? 2 : 1;
        const bRank = b.opening_trial_candidate ? 4 : b.healthy_early_execution_signal ? 3 : b.opening_trial_decision === "watch_more" ? 2 : 1;
        return bRank - aRank || (b.execution_viability_score ?? 0) - (a.execution_viability_score ?? 0);
      });
  }, [opportunities]);
  const [selectedId, setSelectedId] = useState<number | null>(ranked[0]?.id ?? null);
  const selected = ranked.find((item) => item.id === selectedId) ?? ranked[0] ?? null;
  const status = statusFor(selected);
  const symbol = selected ? canonicalSymbol(selected.symbol) : "";
  const symbolSnapshots = useMemo(() => {
    return snapshots
      .filter((point) => canonicalSymbol(point.symbol) === symbol)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .map((point) => ({
        ...point,
        epoch: new Date(point.ts).getTime(),
        label: new Date(point.ts).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })
      }));
  }, [snapshots, symbol]);
  const marker = selected ? nearestPoint(selected.ts, symbolSnapshots) : null;
  const missing = selected?.distance_to_go_checks ?? [];
  const blocker = missing[0] ? checkLabel(missing[0]) : selected?.opening_trial_candidate ? "nincs blokkoló ok" : "nincs aktuális xarb setup";

  if (!selected) {
    return (
      <div className="mt-4 rounded-xl border p-5" style={{ borderColor: "var(--line)" }}>
        <p className="text-lg font-semibold">Nincs execution opportunity</p>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Market signal: {marketSignalCount}. Entry nincs, mert nincs pozitív taker nettós, reportolható xarb setup.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {ranked.slice(0, 8).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelectedId(item.id)}
            className="rounded-lg border px-3 py-2 text-left text-sm"
            style={{
              borderColor: selected.id === item.id ? statusFor(item).tone : "var(--line)",
              background: selected.id === item.id ? "color-mix(in oklab, var(--accent) 16%, transparent)" : "transparent",
              color: "var(--text)"
            }}
          >
            <strong>{item.symbol}</strong>
            <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>{item.exchange}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--card) 86%, transparent)" }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>Entry barometer</p>
              <h3 className="mt-1 text-2xl font-semibold">{selected.symbol}</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{selected.exchange} · {humanState(selected.execution_recommendation_state)}</p>
            </div>
            <span className="rounded-full px-3 py-1.5 text-sm font-bold" style={{ color: status.tone, background: `${status.tone}22`, border: `1px solid ${status.tone}66` }}>
              {status.label}
            </span>
          </div>
          <p className="mt-4 text-sm">{status.text}</p>
          <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
            <p className="text-sm font-semibold">Miért nem nyitunk most?</p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {selected.opening_trial_candidate ? "Nyitható setup: a controlled opening trial feltételei teljesültek." : selected.opening_trial_reason}
            </p>
          </div>
          <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
            <p className="text-sm font-semibold">Mi hiányzik még?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {missing.length > 0 ? (
                missing.map((check) => (
                  <span key={check} className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "#78350f", color: "#fde68a" }}>
                    {checkLabel(check)}
                  </span>
                ))
              ) : (
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "#14532d", color: "#bbf7d0" }}>minden feltétel teljesült</span>
              )}
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>Fő blokkoló: {blocker}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Gauge label="Net edge" value={selected.maker_net_edge_bps} threshold={2} unit="bps" helper="maker-assisted edge" />
          <Gauge label="Taker net edge" value={selected.taker_net_edge_bps ?? 0} threshold={0.01} unit="bps" helper={(selected.taker_net_edge_bps ?? 0) > 0 ? "pozitív taker net már teljesült" : "taker net még nem pozitív"} />
          <Gauge label="Persistence" value={selected.current_persistence_ticks} threshold={selected.required_persistence_ticks} unit="tick" helper={selected.persistence_gap > 0 ? `még ${selected.persistence_gap} tick hiányzik` : "persistence teljesült"} max={Math.max(5, selected.required_persistence_ticks)} />
          <Gauge label="Lifetime" value={selected.current_lifetime_minutes} threshold={selected.required_lifetime_minutes} unit="min" helper={selected.lifetime_gap > 0 ? `még ${selected.lifetime_gap.toFixed(1)} perc hiányzik` : "lifetime teljesült"} max={Math.max(60, selected.required_lifetime_minutes)} />
          <Gauge label="Execution viability" value={selected.execution_viability_score ?? 0} threshold={80} unit="pt" helper={(selected.execution_viability_score ?? 0) >= 80 ? "execution viability megfelelő" : "execution viability még kevés"} max={100} />
          <BooleanGauge label="Fragility" passed={!selected.execution_fragile} helper={selected.execution_fragile ? "fragility miatt még nem nyitható" : "nem execution-fragile"} />
          <BooleanGauge label="Decision-capable" passed={selected.decision_capable_execution_signal} helper={selected.decision_capable_execution_signal ? "execution döntésképes" : "még nem döntésképes"} />
          <BooleanGauge label="Opening trial" passed={selected.opening_trial_candidate} helper={selected.opening_trial_candidate ? "entry-ready" : selected.distance_to_go_summary} />
        </div>
      </div>

      <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Árfolyam és döntési pont</h3>
          <span className="text-xs" style={{ color: "var(--muted)" }}>{symbolSnapshots.length} pont</span>
        </div>
        <div className="mt-3 h-56">
          {symbolSnapshots.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={symbolSnapshots} margin={{ top: 10, right: 12, left: 0, bottom: 10 }}>
                <XAxis dataKey="label" minTickGap={28} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} width={72} domain={["dataMin", "dataMax"]} />
                <Tooltip contentStyle={{ background: "#0b2547", border: "1px solid #1e4473", borderRadius: 8, color: "#e2e8f0" }} />
                <Area type="monotone" dataKey="mid" stroke="#7dd3fc" strokeWidth={2} fill="rgba(125,211,252,0.12)" name="Spot mid" />
                {marker ? (
                  <ReferenceDot x={marker.label} y={marker.mid} r={7} fill={status.tone} stroke="#ffffff" strokeWidth={2} label={{ value: status.label, fill: status.tone, position: "top" }} />
                ) : null}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm" style={{ color: "var(--muted)" }}>Ehhez az opportunity-hez még nincs elég azonos-symbol árfolyam history.</p>
          )}
        </div>
      </div>
    </div>
  );
}
