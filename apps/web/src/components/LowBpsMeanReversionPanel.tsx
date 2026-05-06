type TrialSummary = {
  trials: number;
  wins: number;
  losses: number;
  flat: number;
  total_pnl_bps: number;
  avg_pnl_bps: number;
  win_rate: number;
  best_pnl_bps: number;
  worst_pnl_bps: number;
};

type ThresholdSummary = TrialSummary & {
  threshold_bps: number;
};

type ModelSummary = TrialSummary & {
  model: string;
  threshold_bps: number;
};

type LowBpsSummary = {
  mode: "shadow_only";
  active: boolean;
  byThreshold: ThresholdSummary[];
  bestModel: ModelSummary | null;
  topModels: ModelSummary[];
  warning: string;
};

function pnlColor(value: number) {
  if (value > 0) return "#84cc16";
  if (value < 0) return "#ef4444";
  return "var(--text)";
}

function modelLabel(model: string) {
  return model.replace("low_mr_", "").replace("_", " · ").replace("tp", "TP ").replace("_sl", " / SL ");
}

export default function LowBpsMeanReversionPanel({ summary }: { summary: LowBpsSummary }) {
  return (
    <section
      className="mb-6 rounded-[2rem] border p-5"
      style={{
        borderColor: "color-mix(in oklab, #f59e0b 45%, var(--line))",
        background:
          "radial-gradient(circle at 12% 10%, color-mix(in oklab, #f59e0b 18%, transparent), transparent 32%), color-mix(in oklab, var(--card) 94%, transparent)"
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--muted)" }}>Low-BPS MR Shadow</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold">Alacsony spread teszt</h2>
            <span
              className="rounded-full px-4 py-2 text-sm font-bold"
              style={{
                background: summary.active ? "#fef3c7" : "#e2e8f0",
                color: "#0f172a",
                border: `1px solid ${summary.active ? "#f59e0b" : "#94a3b8"}`
              }}
            >
              {summary.active ? "Shadow hipotézis aktív" : "Shadow mérés alatt"}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm" style={{ color: "var(--muted)" }}>
            2/3/4 bps mean-reversion próba. Ez direkt nem nyitási stratégia: azt méri, hogy kisebb szétnyílásnál is van-e stabil záródási profit.
          </p>
        </div>
        <div className="rounded-2xl border px-4 py-3 text-right" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 35%, transparent)" }}>
          <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>Legjobb shadow modell</p>
          {summary.bestModel ? (
            <>
              <strong className="text-xl" style={{ color: pnlColor(summary.bestModel.total_pnl_bps) }}>
                {summary.bestModel.total_pnl_bps.toFixed(2)} bps
              </strong>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{modelLabel(summary.bestModel.model)}</p>
              <p className="text-sm">{summary.bestModel.trials} trial · win {(summary.bestModel.win_rate * 100).toFixed(0)}%</p>
            </>
          ) : (
            <>
              <strong className="text-xl">Nincs minta</strong>
              <p className="text-sm" style={{ color: "var(--muted)" }}>Még nincs low-bps MR trial.</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {summary.byThreshold.map((row) => (
          <div key={row.threshold_bps} className="rounded-2xl border p-4" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 35%, transparent)" }}>
            <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>{row.threshold_bps} bps shadow</p>
            <strong className="mt-2 block text-3xl" style={{ color: pnlColor(row.total_pnl_bps) }}>{row.total_pnl_bps.toFixed(2)} bps</strong>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {row.trials} trial · W/L/F {row.wins}/{row.losses}/{row.flat} · win {(row.win_rate * 100).toFixed(0)}%
            </p>
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              TP3/SL3 proxy · avg {row.avg_pnl_bps.toFixed(2)}
            </p>
          </div>
        ))}
      </div>

      {summary.topModels.length > 0 && (
        <div className="mt-5 rounded-2xl border p-4" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 30%, transparent)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Top shadow modellek</h3>
              <p className="text-sm" style={{ color: "var(--muted)" }}>Csak kutatási rangsor. Ha 7-14 napig stabil, később paper-entry jelölt lehet.</p>
            </div>
            <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "#fee2e2", color: "#7f1d1d" }}>nem nyit</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {summary.topModels.map((row) => (
              <div key={row.model} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
                <span><strong>{modelLabel(row.model)}</strong> · {row.trials} trial</span>
                <span><strong style={{ color: pnlColor(row.total_pnl_bps) }}>{row.total_pnl_bps.toFixed(2)} bps</strong> · {(row.win_rate * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>{summary.warning}</p>
    </section>
  );
}
