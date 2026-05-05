type RegimePoint = {
  ts: string;
  max_taker_bps: number;
  status: "cold" | "warming" | "armed" | "active";
  candidate_count: number;
  best_symbol: string | null;
  best_exchange: string | null;
};

type RegimeSummary = {
  status: "cold" | "warming" | "armed" | "active";
  label: string;
  max_taker_bps: number;
  candidate_count_30d: number;
  armed_or_active_hours_30d: number;
  last_active_ts: string | null;
  hours_since_last_active: number | null;
};

function statusMeta(status: RegimeSummary["status"]) {
  const copy = {
    cold: { label: "Cold", color: "#94a3b8", bg: "#e2e8f0", text: "MR piac alszik: nincs elég nagy spread." },
    warming: { label: "Warming", color: "#f59e0b", bg: "#fef3c7", text: "Spread kezd éledezni, de még belépési küszöb alatt van." },
    armed: { label: "Armed", color: "#38bdf8", bg: "#cffafe", text: "Megvan az 5+ bps spread, de még nincs teljes MR trigger." },
    active: { label: "Active", color: "#22c55e", bg: "#bbf7d0", text: "MR-kompatibilis piac: spread + persistence együtt megvan." }
  } as const;
  return copy[status];
}

function formatTime(ts: string | null) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("hu-HU", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function yFor(value: number, max: number) {
  const clamped = Math.max(0, Math.min(max, value));
  return 100 - (clamped / max) * 100;
}

export default function MeanReversionRegimePanel({ summary, points }: { summary: RegimeSummary; points: RegimePoint[] }) {
  const meta = statusMeta(summary.status);
  const chartMax = Math.max(12, ...points.map((point) => point.max_taker_bps), 8);
  const path = points
    .map((point, index) => {
      const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = yFor(point.max_taker_bps, chartMax);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const thresholds = [3, 5, 8];

  return (
    <section className="mb-6 rounded-[2rem] border p-5" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--card) 94%, transparent)" }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--muted)" }}>MR Regime Monitor</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold">Spread regime 30D</h2>
            <span className="rounded-full px-4 py-2 text-sm font-bold" style={{ background: meta.bg, color: "#0f172a", border: `1px solid ${meta.color}` }}>
              {meta.label}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm" style={{ color: "var(--muted)" }}>{meta.text}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>Most max spread</p>
            <strong>{summary.max_taker_bps.toFixed(2)} bps</strong>
          </div>
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>MR candidate 30D</p>
            <strong>{summary.candidate_count_30d}</strong>
          </div>
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>Armed/active órák</p>
            <strong>{summary.armed_or_active_hours_30d}</strong>
          </div>
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>Utolsó active</p>
            <strong>{summary.hours_since_last_active === null ? "-" : `${summary.hours_since_last_active.toFixed(1)}h`}</strong>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border p-4" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 30%, transparent)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">30D regime hullámzás</h3>
            <p className="text-sm" style={{ color: "var(--muted)" }}>A vonal az óránkénti max taker spread. A küszöbök mutatják, mikor kezd érdekes lenni a stratégia.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full px-2 py-1" style={{ background: "#e2e8f0", color: "#0f172a" }}>3 bps warming</span>
            <span className="rounded-full px-2 py-1" style={{ background: "#cffafe", color: "#0f172a" }}>5 bps armed</span>
            <span className="rounded-full px-2 py-1" style={{ background: "#bbf7d0", color: "#0f172a" }}>8 bps strong</span>
          </div>
        </div>
        <div className="relative h-56 overflow-hidden rounded-xl border" style={{ borderColor: "var(--line)" }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {thresholds.map((threshold) => {
              const y = yFor(threshold, chartMax);
              return <line key={threshold} x1="0" x2="100" y1={y} y2={y} stroke={threshold === 5 ? "#38bdf8" : threshold === 8 ? "#22c55e" : "#f59e0b"} strokeWidth="0.45" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />;
            })}
            <path d={path} fill="none" stroke="#7dd3fc" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
            <path d={`${path} L 100 100 L 0 100 Z`} fill="rgba(56,189,248,0.12)" />
          </svg>
          <div className="absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "rgba(15,23,42,0.72)", color: "#e2e8f0" }}>
            max {chartMax.toFixed(1)} bps
          </div>
          <div className="absolute bottom-3 left-3 right-3 flex justify-between text-xs" style={{ color: "var(--muted)" }}>
            <span>{formatTime(points[0]?.ts ?? null)}</span>
            <span>{formatTime(points.at(-1)?.ts ?? null)}</span>
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {points.slice(-6).reverse().map((point) => {
            const pointMeta = statusMeta(point.status);
            return (
              <div key={point.ts} className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
                <div className="flex items-center justify-between gap-2">
                  <strong>{formatTime(point.ts)}</strong>
                  <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: pointMeta.bg, color: "#0f172a" }}>{pointMeta.label}</span>
                </div>
                <p className="mt-1" style={{ color: "var(--muted)" }}>{point.max_taker_bps.toFixed(2)} bps · {point.best_symbol ?? "-"} · {point.best_exchange ?? "-"}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
