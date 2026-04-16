"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceDot,
  Legend
} from "recharts";

type LearningPoint = {
  ts: string;
  label: string;
  mid: number;
  symbol: string;
};

type OverlayPoint = {
  ts: string;
  label: string;
  symbol: string;
  score: number;
  decision: string;
};

type Props = {
  points: LearningPoint[];
  overlays: OverlayPoint[];
};

function dotColor(decision: string) {
  if (decision === "future_auto_candidate") return "#34d399";
  if (decision === "paper_candidate") return "#22c55e";
  if (decision === "strong_watch") return "#f59e0b";
  return "#94a3b8";
}

export default function LearningViewChart({ points, overlays }: Props) {
  const domain = (() => {
    const mids = points.map((p) => p.mid).filter((v) => Number.isFinite(v) && v > 0);
    if (mids.length === 0) return [0, 1] as [number, number];
    const min = Math.min(...mids);
    const max = Math.max(...mids);
    const pad = (max - min) * 0.08 || min * 0.02 || 1;
    return [Math.max(0, min - pad), max + pad] as [number, number];
  })();

  return (
    <div className="h-[20rem] w-full rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--card) 76%, transparent)" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 20, right: 20, bottom: 16, left: 8 }}>
          <CartesianGrid stroke="rgba(148,163,184,0.2)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 12 }} minTickGap={28} />
          <YAxis
            domain={domain}
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            width={90}
            tickFormatter={(v) => Number(v).toLocaleString("hu-HU", { maximumFractionDigits: 2 })}
          />
          <Tooltip
            contentStyle={{
              background: "#0b2547",
              border: "1px solid #1e4473",
              borderRadius: 12,
              color: "#e2e8f0"
            }}
            labelStyle={{ color: "#93c5fd", fontWeight: 700 }}
            formatter={(value: unknown, _name, item) => {
              const row = item?.payload as LearningPoint | undefined;
              const pretty = Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 4 });
              return [
                `${pretty} (${row?.symbol ?? "?"})`,
                "Spot mid"
              ];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="mid"
            stroke="#7dd3fc"
            strokeWidth={2.6}
            dot={false}
            activeDot={{ r: 5, stroke: "#bae6fd", strokeWidth: 1 }}
            name="Spot mid price"
          />

          {overlays.map((o, idx) => (
            <ReferenceDot
              key={`${o.ts}-${idx}`}
              x={o.label}
              y={points.find((p) => p.label === o.label)?.mid}
              r={4}
              fill={dotColor(o.decision)}
              stroke="#0f172a"
              label={{
                value: `${o.symbol} ${Math.round(o.score)}`,
                position: "top",
                fill: "#cbd5e1",
                fontSize: 10
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
