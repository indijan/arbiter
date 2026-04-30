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
  bySymbol: LabSlice[];
  byExchange: LabSlice[];
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
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SliceTable title="Symbol bontás" rows={summary.bySymbol} />
        <SliceTable title="Exchange-pair bontás" rows={summary.byExchange} />
      </div>
    </section>
  );
}
