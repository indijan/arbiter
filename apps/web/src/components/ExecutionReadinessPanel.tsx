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

function HelpTip({ label }: { label: string }) {
  return (
    <span className="group relative ml-1 inline-flex align-middle">
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
        style={{
          background: "color-mix(in oklab, var(--accent) 22%, transparent)",
          color: "var(--accent)",
          border: "1px solid color-mix(in oklab, var(--accent) 40%, transparent)"
        }}
      >
        i
      </span>
      <span
        className="pointer-events-none absolute left-1/2 top-[125%] z-20 hidden w-56 -translate-x-1/2 rounded-lg px-3 py-2 text-xs leading-5 shadow-xl group-hover:block"
        style={{
          background: "#0b2547",
          color: "#e2e8f0",
          border: "1px solid #1e4473"
        }}
      >
        {label}
      </span>
    </span>
  );
}

function explainLabel(key: string) {
  const copy: Record<string, string> = {
    execution_ready: "A setup most végrehajthatónak néz ki: a taker edge is pozitív, és az execution minőség elég jó.",
    paper_ready: "Szigorúbb szint, mint az execution ready. Nem csak most jó, hanem elég stabil és elég tartós is paper teszthez.",
    conditional: "Majdnem végrehajtható setup. Van él, de még valamilyen feltétel miatt óvatos kezelést igényel.",
    watch_fragile: "Figyelni érdemes, de túl fragilis a tényleges végrehajtáshoz.",
    avg_taker: "Azoknak a xarb setupoknak az átlagos taker nettó edge-e, ahol a taker oldal pozitív.",
    symbol: "Melyik instrumentumra vonatkozik a setup.",
    pair: "Melyik exchange-pár között látta a rendszer a cross-exchange opportunity-t.",
    state: "Execution állapot: most végrehajtható, feltételes vagy csak figyelendő.",
    paper: "Paper tesztre alkalmas-e. Ez szigorúbb, mint az execution ready, mert stabilitás és idő is kell hozzá.",
    maker: "Optimistább nettó edge maker-assisted végrehajtási feltételekkel.",
    taker: "Konzervatívabb, azonnali végrehajtás melletti nettó edge. Ez a fontosabb realitási szám.",
    stability: "Mennyire volt stabil az edge a megfigyelt időszakban. Minél magasabb, annál jobb.",
    peak_worst: "A jel után látott legjobb és legrosszabb bps kimenet egyszerű paper proxy szerint.",
    persist: "Hány tickig és mennyi ideig maradt fenn a setup.",
    audit: "Mennyi idő alatt vált decision-capable-pé, és mi lett volna az egyszerű paper exit logika."
  };
  return copy[key] ?? "";
}

function badgeStyle(state: string) {
  if (state === "execution_ready") return { background: "#14532d", color: "#bbf7d0" };
  if (state === "conditional_execution") return { background: "#78350f", color: "#fde68a" };
  if (state === "watch_only") return { background: "#3f3f46", color: "#d4d4d8" };
  return { background: "#1e3a8a", color: "#bfdbfe" };
}

function humanState(state: string) {
  if (state === "execution_ready") return "Most végrehajtható";
  if (state === "conditional_execution") return "Feltételes végrehajtás";
  if (state === "watch_only") return "Csak figyelendő";
  if (state === "not_viable") return "Nem életképes";
  return state;
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
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Execution ready
            <HelpTip label={explainLabel("execution_ready")} />
          </p>
          <p className="mt-2 text-2xl font-semibold">{summary.execution_ready_count}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Paper ready
            <HelpTip label={explainLabel("paper_ready")} />
          </p>
          <p className="mt-2 text-2xl font-semibold">{summary.paper_trade_ready_count}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Conditional
            <HelpTip label={explainLabel("conditional")} />
          </p>
          <p className="mt-2 text-2xl font-semibold">{summary.conditional_execution_count}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Watch fragile
            <HelpTip label={explainLabel("watch_fragile")} />
          </p>
          <p className="mt-2 text-2xl font-semibold">{summary.watch_only_fragile_count}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Avg taker +bps
            <HelpTip label={explainLabel("avg_taker")} />
          </p>
          <p className="mt-2 text-2xl font-semibold">{summary.avg_positive_taker_bps.toFixed(2)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--line)" }}>
        <table className="min-w-full text-sm">
          <thead style={{ background: "color-mix(in oklab, var(--bg-alt) 55%, transparent)" }}>
            <tr>
              <th className="px-3 py-2 text-left">Symbol <HelpTip label={explainLabel("symbol")} /></th>
              <th className="px-3 py-2 text-left">Pair <HelpTip label={explainLabel("pair")} /></th>
              <th className="px-3 py-2 text-left">State <HelpTip label={explainLabel("state")} /></th>
              <th className="px-3 py-2 text-left">Paper <HelpTip label={explainLabel("paper")} /></th>
              <th className="px-3 py-2 text-left">Maker <HelpTip label={explainLabel("maker")} /></th>
              <th className="px-3 py-2 text-left">Taker <HelpTip label={explainLabel("taker")} /></th>
              <th className="px-3 py-2 text-left">Stability <HelpTip label={explainLabel("stability")} /></th>
              <th className="px-3 py-2 text-left">Peak/Worst <HelpTip label={explainLabel("peak_worst")} /></th>
              <th className="px-3 py-2 text-left">Persist <HelpTip label={explainLabel("persist")} /></th>
              <th className="px-3 py-2 text-left">Audit <HelpTip label={explainLabel("audit")} /></th>
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
                      {humanState(row.execution_recommendation_state)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{row.paper_trade_ready ? "Paperre kész" : "Még nem"}</td>
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
