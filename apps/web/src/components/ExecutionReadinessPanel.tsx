type ExecutionRow = {
  id: number;
  ts: string;
  symbol: string;
  exchange: string;
  score: number;
  maker_net_edge_bps: number;
  taker_net_edge_bps: number | null;
  persistence_ticks: number;
  lifetime_minutes: number;
  execution_recommendation_state: string;
  execution_viability_score: number | null;
  paper_trade_ready: boolean;
  execution_grade: string;
  net_edge_stability_score: number;
  paper_peak_bps_after_signal: number;
  paper_worst_bps_after_signal: number;
  paper_exit_reason: string;
  time_to_first_decision_capable_minutes: number | null;
};

function badgeStyle(state: string) {
  if (state === "execution_ready") return { background: "#14532d", color: "#bbf7d0" };
  if (state === "conditional_execution") return { background: "#78350f", color: "#fde68a" };
  if (state === "watch_only") return { background: "#3f3f46", color: "#d4d4d8" };
  return { background: "#1e3a8a", color: "#bfdbfe" };
}

export default function ExecutionReadinessPanel({
  rows,
  summary
}: {
  rows: ExecutionRow[];
  summary: {
    execution_ready_count: number;
    paper_trade_ready_count: number;
    conditional_execution_count: number;
    watch_only_fragile_count: number;
    avg_positive_taker_bps: number;
  };
}) {
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>Execution ready</p>
          <p className="mt-2 text-2xl font-semibold">{summary.execution_ready_count}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>Paper ready</p>
          <p className="mt-2 text-2xl font-semibold">{summary.paper_trade_ready_count}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>Conditional</p>
          <p className="mt-2 text-2xl font-semibold">{summary.conditional_execution_count}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>Watch fragile</p>
          <p className="mt-2 text-2xl font-semibold">{summary.watch_only_fragile_count}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>Avg taker +bps</p>
          <p className="mt-2 text-2xl font-semibold">{summary.avg_positive_taker_bps.toFixed(2)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--line)" }}>
        <table className="min-w-full text-sm">
          <thead style={{ background: "color-mix(in oklab, var(--bg-alt) 55%, transparent)" }}>
            <tr>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="px-3 py-2 text-left">Pair</th>
              <th className="px-3 py-2 text-left">State</th>
              <th className="px-3 py-2 text-left">Paper</th>
              <th className="px-3 py-2 text-left">Maker</th>
              <th className="px-3 py-2 text-left">Taker</th>
              <th className="px-3 py-2 text-left">Stability</th>
              <th className="px-3 py-2 text-left">Peak/Worst</th>
              <th className="px-3 py-2 text-left">Persist</th>
              <th className="px-3 py-2 text-left">Audit</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-3 py-2 font-semibold">{row.symbol}</td>
                  <td className="px-3 py-2">{row.exchange}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full px-2 py-1 text-xs font-semibold" style={badgeStyle(row.execution_recommendation_state)}>
                      {row.execution_recommendation_state}
                    </span>
                  </td>
                  <td className="px-3 py-2">{row.paper_trade_ready ? "ready" : "no"}</td>
                  <td className="px-3 py-2">{row.maker_net_edge_bps.toFixed(2)} bps</td>
                  <td className="px-3 py-2">{(row.taker_net_edge_bps ?? 0).toFixed(2)} bps</td>
                  <td className="px-3 py-2">{row.net_edge_stability_score.toFixed(1)} / {row.execution_grade}</td>
                  <td className="px-3 py-2">
                    {row.paper_peak_bps_after_signal.toFixed(2)} / {row.paper_worst_bps_after_signal.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">{row.persistence_ticks} tick · {row.lifetime_minutes.toFixed(0)}m</td>
                  <td className="px-3 py-2">
                    ttfd {row.time_to_first_decision_capable_minutes ?? "-"}m · {row.paper_exit_reason}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="px-3 py-4" style={{ color: "var(--muted)" }}>
                  Nincs aktuális execution-validációs xarb setup.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
