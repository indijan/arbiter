type LabSlice = {
  key: string;
  trials: number;
  wins: number;
  losses: number;
  flat: number;
  total_pnl_bps: number;
  avg_pnl_bps: number;
  win_rate: number;
};

type StrategyLabSummary = {
  baseline: {
    trials: number;
    wins: number;
    losses: number;
    flat: number;
    total_pnl_bps: number;
    avg_pnl_bps: number;
    win_rate: number;
  };
  exploratory: {
    trials: number;
    wins: number;
    losses: number;
    flat: number;
    total_pnl_bps: number;
    avg_pnl_bps: number;
    win_rate: number;
  };
  bySymbol: LabSlice[];
  byExchange: LabSlice[];
  promotionCandidates: LabSlice[];
  quarantineCandidates: LabSlice[];
  targetedProbe: {
    active: boolean;
    policy: string;
    trials: number;
    wins: number;
    losses: number;
    flat: number;
    total_pnl_bps: number;
    avg_pnl_bps: number;
    win_rate: number;
    exit_models: string[];
  };
  meanReversionProbe: {
    active: boolean;
    policy: string;
    trials: number;
    wins: number;
    losses: number;
    flat: number;
    total_pnl_bps: number;
    avg_pnl_bps: number;
    win_rate: number;
    exit_models: string[];
  };
};

function tone(value: number) {
  if (value > 0) return "#84cc16";
  if (value < 0) return "#ef4444";
  return "var(--text)";
}

function SliceTable({ title, rows }: { title: string; rows: LabSlice[] }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 32%, transparent)" }}>
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.length > 0 ? rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
            <div>
              <p className="font-semibold">{row.key}</p>
              <p style={{ color: "var(--muted)" }}>{row.trials} trial · W/L/F {row.wins}/{row.losses}/{row.flat} · win {(row.win_rate * 100).toFixed(0)}%</p>
            </div>
            <div className="text-right">
              <strong style={{ color: tone(row.total_pnl_bps) }}>{row.total_pnl_bps.toFixed(2)} bps</strong>
              <p style={{ color: "var(--muted)" }}>avg {row.avg_pnl_bps.toFixed(2)}</p>
            </div>
          </div>
        )) : (
          <p className="text-sm" style={{ color: "var(--muted)" }}>Nincs elég paper trial ehhez a bontáshoz.</p>
        )}
      </div>
    </div>
  );
}

export default function StrategyLabPanel({ summary }: { summary: StrategyLabSummary }) {
  const baseline = summary.baseline;
  const exploratory = summary.exploratory;
  const probe = summary.targetedProbe;
  const meanReversion = summary.meanReversionProbe;
  return (
    <section className="card mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Strategy Lab</h2>
          <p className="mt-2 max-w-3xl text-sm" style={{ color: "var(--muted)" }}>
            Nem azt nézi, hogy volt-e opportunity, hanem azt, hogy a paper/opening trialok melyik symbolon és exchange-páron termeltek volna. Ez a következő threshold/pair döntések alapja.
          </p>
        </div>
        <div className="rounded-2xl border px-4 py-3 text-right" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>Baseline saldo</p>
          <strong className="text-2xl" style={{ color: tone(baseline.total_pnl_bps) }}>{baseline.total_pnl_bps.toFixed(2)} bps</strong>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{baseline.trials} trial · W/L/F {baseline.wins}/{baseline.losses}/{baseline.flat}</p>
        </div>
        <div className="rounded-2xl border px-4 py-3 text-right" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>Probe saldo</p>
          <strong className="text-2xl" style={{ color: tone(exploratory.total_pnl_bps) }}>{exploratory.total_pnl_bps.toFixed(2)} bps</strong>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{exploratory.trials} probe · W/L/F {exploratory.wins}/{exploratory.losses}/{exploratory.flat}</p>
        </div>
      </div>
      <div
        className="mt-4 rounded-3xl border p-4"
        style={{
          borderColor: probe.active ? "color-mix(in oklab, #84cc16 55%, var(--line))" : "var(--line)",
          background: probe.active
            ? "linear-gradient(135deg, color-mix(in oklab, #84cc16 16%, transparent), color-mix(in oklab, var(--bg-alt) 40%, transparent))"
            : "color-mix(in oklab, var(--bg-alt) 32%, transparent)"
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>Targeted paper probe</p>
            <h3 className="mt-1 text-lg font-semibold">high_stability_70 · TP/SL paper-only</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Csak stabil, pozitív taker nettós xarb setup. Nem live entry, hanem célzott paper validáció.
            </p>
          </div>
          <div className="text-right">
            <strong className="text-2xl" style={{ color: tone(probe.total_pnl_bps) }}>{probe.total_pnl_bps.toFixed(2)} bps</strong>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {probe.trials} trial · W/L/F {probe.wins}/{probe.losses}/{probe.flat} · win {(probe.win_rate * 100).toFixed(0)}%
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full px-3 py-1" style={{ background: probe.active ? "#ecfccb" : "color-mix(in oklab, var(--accent) 18%, transparent)", color: probe.active ? "#365314" : "var(--accent)", border: probe.active ? "1px solid #84cc16" : "1px solid transparent" }}>
            {probe.active ? "Aktív paper-probe jelölt" : "Még nincs elég erős 24h minta"}
          </span>
          {probe.exit_models.map((model) => (
            <span key={model} className="rounded-full px-3 py-1" style={{ background: "color-mix(in oklab, var(--bg-alt) 72%, transparent)", color: "var(--muted)" }}>
              {model}
            </span>
          ))}
        </div>
      </div>
      <div
        className="mt-4 rounded-3xl border p-4"
        style={{
          borderColor: meanReversion.active ? "color-mix(in oklab, #22c55e 60%, var(--line))" : "var(--line)",
          background: meanReversion.active
            ? "linear-gradient(135deg, color-mix(in oklab, #22c55e 18%, transparent), color-mix(in oklab, var(--bg-alt) 42%, transparent))"
            : "color-mix(in oklab, var(--bg-alt) 32%, transparent)"
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>Mean Reversion Probe</p>
            <h3 className="mt-1 text-lg font-semibold">high spread closing · paper-only</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Más profitlogika: akkor nyer, ha a magas xarb spread záródik. Proxy PnL = entry edge - exit edge.
            </p>
          </div>
          <div className="text-right">
            <strong className="text-2xl" style={{ color: tone(meanReversion.total_pnl_bps) }}>{meanReversion.total_pnl_bps.toFixed(2)} bps</strong>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {meanReversion.trials} trial · W/L/F {meanReversion.wins}/{meanReversion.losses}/{meanReversion.flat} · win {(meanReversion.win_rate * 100).toFixed(0)}%
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full px-3 py-1" style={{ background: meanReversion.active ? "#bbf7d0" : "color-mix(in oklab, #22c55e 18%, transparent)", color: meanReversion.active ? "#14532d" : "#86efac", border: meanReversion.active ? "1px solid #22c55e" : "1px solid transparent" }}>
            {meanReversion.active ? "Aktív nyerő hipotézis" : "Még nincs elég friss megerősítés"}
          </span>
          {meanReversion.exit_models.map((model) => (
            <span key={model} className="rounded-full px-3 py-1" style={{ background: "color-mix(in oklab, var(--bg-alt) 72%, transparent)", color: "var(--muted)" }}>
              {model}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SliceTable title="Promotion jelöltek" rows={summary.promotionCandidates} />
        <SliceTable title="Karantén jelöltek" rows={summary.quarantineCandidates} />
        <SliceTable title="Symbol bontás" rows={summary.bySymbol} />
        <SliceTable title="Exchange-pair bontás" rows={summary.byExchange} />
      </div>
    </section>
  );
}
