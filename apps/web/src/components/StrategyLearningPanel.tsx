"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Legend,
  ReferenceDot,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type SnapshotPoint = {
  ts: string;
  symbol: string;
  mid: number;
};

type OpportunityPoint = {
  ts: string;
  symbol: string;
  strategy: string;
  decision: string;
  score: number;
  reason: string;
  net_edge_bps: number;
  break_even_hours: number;
  risk_score: number;
};

type TradePoint = {
  symbol: string;
  entry_ts: string | null;
  exit_ts: string | null;
};

function canonicalSymbol(raw: string) {
  return raw.replace(/USDT$/i, "USD");
}

function dotColor(decision: string) {
  if (decision === "future_auto_candidate") return "#22c55e";
  if (decision === "paper_candidate") return "#84cc16";
  if (decision === "strong_watch") return "#f59e0b";
  if (decision === "watch") return "#fbbf24";
  return "#94a3b8";
}

export default function StrategyLearningPanel({
  snapshots,
  opportunities,
  trades
}: {
  snapshots: SnapshotPoint[];
  opportunities: OpportunityPoint[];
  trades: TradePoint[];
}) {
  const [windowHours, setWindowHours] = useState<1 | 6 | 24 | 168>(24);
  const [percentMode, setPercentMode] = useState(false);
  const symbols = useMemo(() => {
    const merged = [...snapshots.map((s) => canonicalSymbol(s.symbol)), ...opportunities.map((o) => canonicalSymbol(o.symbol))].filter(Boolean);
    return Array.from(new Set(merged));
  }, [snapshots, opportunities]);

  const signalStats = useMemo(() => {
    const oppCount = opportunities.reduce<Record<string, number>>((acc, o) => {
      const s = canonicalSymbol(o.symbol);
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
    const tradeCount = trades.reduce<Record<string, number>>((acc, t) => {
      const extra = (t.entry_ts ? 1 : 0) + (t.exit_ts ? 1 : 0);
      const s = canonicalSymbol(t.symbol);
      if (extra > 0) acc[s] = (acc[s] ?? 0) + extra;
      return acc;
    }, {});
    const merged = new Map<string, { opportunities: number; trades: number; total: number }>();
    for (const s of symbols) {
      const o = oppCount[s] ?? 0;
      const t = tradeCount[s] ?? 0;
      merged.set(s, { opportunities: o, trades: t, total: o + t });
    }
    return merged;
  }, [opportunities, trades, symbols]);
  const preferredSymbol = useMemo(() => {
    const preferred = symbols
      .slice()
      .sort((a, b) => (signalStats.get(b)?.total ?? 0) - (signalStats.get(a)?.total ?? 0))[0];
    return preferred ?? symbols[0] ?? "";
  }, [symbols, signalStats]);
  const [selectedSymbol, setSelectedSymbol] = useState(preferredSymbol);

  useEffect(() => {
    if (!selectedSymbol || !symbols.includes(selectedSymbol)) {
      setSelectedSymbol(preferredSymbol);
    }
  }, [preferredSymbol, selectedSymbol, symbols]);

  const symbol = selectedSymbol;

  const series = useMemo(() => {
    const bySymbol = snapshots
      .filter((s) => canonicalSymbol(s.symbol) === symbol && s.mid > 0)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const latestEpoch = bySymbol.length > 0 ? new Date(bySymbol[bySymbol.length - 1].ts).getTime() : Date.now();
    const from = latestEpoch - windowHours * 60 * 60 * 1000;
    const raw = bySymbol
      .filter((s) => new Date(s.ts).getTime() >= from)
      .map((s) => ({
        ...s,
        epoch: new Date(s.ts).getTime(),
        label: new Date(s.ts).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      }));
    if (!percentMode || raw.length === 0) return raw;
    const base = raw[0].mid || 1;
    return raw.map((p) => ({ ...p, mid: ((p.mid - base) / base) * 100 }));
  }, [snapshots, symbol, windowHours, percentMode]);

  const availableSpanHours = useMemo(() => {
    const all = snapshots
      .filter((s) => canonicalSymbol(s.symbol) === symbol && s.mid > 0)
      .map((s) => new Date(s.ts).getTime())
      .sort((a, b) => a - b);
    if (all.length < 2) return 0;
    return Math.max(0, (all[all.length - 1] - all[0]) / (60 * 60 * 1000));
  }, [snapshots, symbol]);

  const windowBounds = useMemo(() => {
    if (series.length === 0) return null;
    return {
      from: series[0].epoch,
      to: series[series.length - 1].epoch
    };
  }, [series]);

  const overlay = useMemo(() => {
    if (!windowBounds) return [];
    return opportunities
      .filter((o) => canonicalSymbol(o.symbol) === symbol)
      .filter((o) => {
        const t = new Date(o.ts).getTime();
        return t >= windowBounds.from && t <= windowBounds.to;
      })
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }, [opportunities, symbol, windowBounds]);

  const tradeMarkers = useMemo(() => {
    if (!windowBounds) return [];
    return trades
      .filter((t) => canonicalSymbol(t.symbol) === symbol)
      .flatMap((t) => {
        const items: Array<{ ts: string; kind: "entry" | "exit" }> = [];
        if (t.entry_ts) items.push({ ts: t.entry_ts, kind: "entry" });
        if (t.exit_ts) items.push({ ts: t.exit_ts, kind: "exit" });
        return items;
      })
      .filter((m) => {
        const t = new Date(m.ts).getTime();
        return t >= windowBounds.from && t <= windowBounds.to;
      })
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }, [trades, symbol, windowBounds]);

  const overlayByLabel = useMemo(() => {
    const map = new Map<string, OpportunityPoint[]>();
    for (const o of overlay) {
      const label = new Date(o.ts).toLocaleTimeString("hu-HU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
      const list = map.get(label) ?? [];
      list.push(o);
      map.set(label, list);
    }
    return map;
  }, [overlay]);

  const yDomain = useMemo(() => {
    const mids = series.map((s) => s.mid).filter((v) => Number.isFinite(v) && v > 0);
    if (mids.length === 0) return [0, 1] as [number, number];
    const min = Math.min(...mids);
    const max = Math.max(...mids);
    const spread = max - min;
    const pad = spread > 0 ? spread * 0.25 : Math.max(min * 0.002, 1);
    return [min - pad, max + pad] as [number, number];
  }, [series]);

  const strategyScatter = useMemo(() => {
    return overlay
      .map((o) => {
        const near = series.length === 0 ? null : series.reduce((best, p) => {
          const dBest = Math.abs(best.epoch - new Date(o.ts).getTime());
          const dNow = Math.abs(p.epoch - new Date(o.ts).getTime());
          return dNow < dBest ? p : best;
        }, series[0]);
        if (!near) return null;
        return {
          x: near.label,
          y: near.mid,
          decision: o.decision,
          strategy: o.strategy
        };
      })
      .filter((x): x is { x: string; y: number; decision: string; strategy: string } => x !== null);
  }, [overlay, series]);

  const nearestPoint = useMemo(() => {
    return (isoTs: string) => {
      if (series.length === 0) return null;
      const t = new Date(isoTs).getTime();
      let best = series[0];
      let bestDiff = Math.abs(best.epoch - t);
      for (let i = 1; i < series.length; i += 1) {
        const d = Math.abs(series[i].epoch - t);
        if (d < bestDiff) {
          best = series[i];
          bestDiff = d;
        }
      }
      return best;
    };
  }, [series]);

  return (
    <>
      <div className="mt-3 flex items-center gap-2 text-sm">
        <span style={{ color: "var(--muted)" }}>Auto symbol:</span>
        <span className="rounded-lg border px-2 py-1 font-semibold" style={{ borderColor: "var(--line)" }}>
          {symbol || "-"}
        </span>
        <label className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
          Symbol
        </label>
        <select
          value={symbol}
          onChange={(event) => setSelectedSymbol(event.target.value)}
          className="rounded-md border px-2 py-1 text-xs"
          style={{ borderColor: "var(--line)", background: "transparent", color: "var(--text)" }}
        >
          {symbols.map((value) => (
            <option key={value} value={value} style={{ color: "#0f172a" }}>
              {value}
            </option>
          ))}
        </select>
        <div className="ml-2 flex items-center gap-1">
          {[1, 6, 24, 168].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setWindowHours(h as 1 | 6 | 24 | 168)}
              className="rounded-md border px-2 py-1 text-xs"
              disabled={availableSpanHours < Math.min(h, 6) && availableSpanHours > 0}
              style={{
                borderColor: "var(--line)",
                background: windowHours === h ? "var(--accent)" : "transparent",
                color: windowHours === h ? "#fff" : "var(--text)",
                opacity: availableSpanHours < Math.min(h, 6) && availableSpanHours > 0 ? 0.45 : 1,
                cursor: availableSpanHours < Math.min(h, 6) && availableSpanHours > 0 ? "not-allowed" : "pointer"
              }}
            >
              {h === 168 ? "7D" : `${h}H`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPercentMode((v) => !v)}
          className="ml-2 rounded-md border px-2 py-1 text-xs"
          style={{
            borderColor: "var(--line)",
            background: percentMode ? "#2563eb" : "transparent",
            color: percentMode ? "#fff" : "var(--text)"
          }}
        >
          {percentMode ? "% mód" : "Ár mód"}
        </button>
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        Signal count (window): opp {overlay.length} · trade {tradeMarkers.length} · points {series.length}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Window: {windowHours === 168 ? "7D" : `${windowHours}H`} · available history: {availableSpanHours.toFixed(1)}h
      </p>
      {availableSpanHours > 0 && availableSpanHours < windowHours ? (
        <p className="mt-1 text-xs" style={{ color: "#fbbf24" }}>
          Ehhez a symbolhoz az elérhető történet rövidebb a választott időablaknál. A grafikon csak a ténylegesen elérhető adatot mutatja.
        </p>
      ) : null}

      <div className="mt-3 h-[22rem] w-full rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--card) 76%, transparent)" }}>
        {series.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>Nincs elég snapshot adat ehhez a symbolhoz.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 16, right: 16, left: 8, bottom: 24 }}>
              <XAxis dataKey="label" minTickGap={24} tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis
                domain={yDomain}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                width={90}
                tickFormatter={(v) =>
                  percentMode
                    ? `${Number(v).toLocaleString("hu-HU", { maximumFractionDigits: 2 })}%`
                    : Number(v).toLocaleString("hu-HU", { maximumFractionDigits: 2 })
                }
              />
              <Tooltip
                contentStyle={{ background: "#0b2547", border: "1px solid #1e4473", borderRadius: 12, color: "#e2e8f0" }}
                content={({ active, label, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const price = Number(payload[0]?.value ?? 0);
                  const row = payload[0]?.payload as { symbol?: string } | undefined;
                  const points = overlayByLabel.get(String(label)) ?? [];
                  return (
                    <div
                      style={{
                        background: "#0b2547",
                        border: "1px solid #1e4473",
                        borderRadius: 12,
                        color: "#e2e8f0",
                        padding: "10px 12px",
                        minWidth: 260
                      }}
                    >
                      <p style={{ color: "#93c5fd", fontWeight: 700, margin: 0 }}>{String(label)}</p>
                      <p style={{ margin: "4px 0 8px 0" }}>
                        {percentMode ? "Változás" : "Ár"}: {price.toLocaleString("hu-HU", { maximumFractionDigits: 6 })}
                        {percentMode ? "%" : ""} ({row?.symbol ?? "?"})
                      </p>
                      {points.length > 0 ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          {points.slice(0, 2).map((p, i) => (
                            <div key={`${p.ts}-${i}`} style={{ borderTop: "1px solid #1e4473", paddingTop: 6 }}>
                              <p style={{ margin: 0, fontWeight: 700 }}>
                                {p.strategy} · {p.decision}
                              </p>
                              <p style={{ margin: 0, fontSize: 12 }}>
                                score: {p.score.toFixed(1)} | risk: {p.risk_score.toFixed(1)}
                              </p>
                              <p style={{ margin: 0, fontSize: 12 }}>
                                net edge: {p.net_edge_bps.toFixed(2)} bps | break-even: {p.break_even_hours.toFixed(1)} h
                              </p>
                              <p style={{ margin: 0, fontSize: 12, color: "#cbd5e1" }}>miért itt: {p.reason}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>
                          Ennél az időpontnál nincs stratégia entry jelölés.
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="mid" stroke="#7dd3fc" strokeWidth={2.2} fill="rgba(125,211,252,0.16)" name="Spot mid" />
              <Scatter
                data={strategyScatter}
                dataKey="y"
                name="Strategy signals"
                fill="#f59e0b"
                shape={(props: any) => (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={7}
                    fill={dotColor(props.payload?.decision)}
                    stroke="#ffffff"
                    strokeWidth={1.8}
                  />
                )}
              />

              {overlay.map((o, i) => {
                const near = nearestPoint(o.ts);
                if (!near) return null;
                return (
                  <ReferenceDot
                    key={`${o.ts}-${i}`}
                    x={near.label}
                    y={near.mid}
                    r={7}
                    fill={dotColor(o.decision)}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    isFront
                    label={{ value: `${o.strategy} · ${Math.round(o.score)}`, position: "top", fill: "#cbd5e1", fontSize: 10 }}
                  />
                );
              })}

              {tradeMarkers.map((m, i) => {
                const near = nearestPoint(m.ts);
                if (!near) return null;
                return (
                  <ReferenceDot
                    key={`${m.ts}-${i}-${m.kind}`}
                    x={near.label}
                    y={near.mid}
                    r={8}
                    fill={m.kind === "entry" ? "#10b981" : "#ef4444"}
                    stroke="#ffffff"
                    strokeWidth={1.6}
                    isFront
                    label={{
                      value: m.kind === "entry" ? "ENTRY" : "EXIT",
                      position: "bottom",
                      fill: m.kind === "entry" ? "#6ee7b7" : "#fca5a5",
                      fontSize: 10
                    }}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {series.length > 0 && overlay.length === 0 && tradeMarkers.length === 0 ? (
        <p className="mt-2 text-xs" style={{ color: "#fbbf24" }}>
          Nincs strategy/trade jelölés ebben az időablakban. Válts nagyobb ablakra (6H/24H/7D).
        </p>
      ) : null}

      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        A pontok stratégia döntési jelölések: hol jelent meg opportunity az árfolyamgörbén.
      </p>
    </>
  );
}
