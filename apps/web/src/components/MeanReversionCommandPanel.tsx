type MeanReversionPoint = {
  ts: string;
  symbol: string;
  exchange: string;
  model: string;
  pnl_bps: number;
  cumulative_bps: number;
};

type MeanReversionSummary = {
  active: boolean;
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

type MeanReversionCandidate = {
  symbol: string;
  exchange: string;
  taker_edge_bps: number;
  persistence_ticks: number;
  lifetime_minutes: number;
  ts: string;
};

function pnlColor(value: number) {
  if (value > 0) return "#84cc16";
  if (value < 0) return "#ef4444";
  return "var(--text)";
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleString("hu-HU", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className="inline-flex rounded-full px-4 py-2 text-sm font-bold"
      style={{
        background: active ? "#bbf7d0" : "#fef3c7",
        color: active ? "#14532d" : "#78350f",
        border: `1px solid ${active ? "#22c55e" : "#f59e0b"}`
      }}
    >
      {active ? "MR hipotézis aktív" : "MR figyelés alatt"}
    </span>
  );
}

export default function MeanReversionCommandPanel({
  summary24h,
  summary7d,
  summary30d,
  latestCandidate,
  series
}: {
  summary24h: MeanReversionSummary;
  summary7d: MeanReversionSummary;
  summary30d: MeanReversionSummary;
  latestCandidate: MeanReversionCandidate | null;
  series: MeanReversionPoint[];
}) {
  const minSaldo = Math.min(0, ...series.map((point) => point.cumulative_bps));
  const maxSaldo = Math.max(0, ...series.map((point) => point.cumulative_bps));
  const range = Math.max(1, maxSaldo - minSaldo);

  return (
    <section
      className="mb-6 overflow-hidden rounded-[2rem] border p-5"
      style={{
        borderColor: "color-mix(in oklab, #22c55e 45%, var(--line))",
        background:
          "radial-gradient(circle at 14% 18%, color-mix(in oklab, #22c55e 24%, transparent), transparent 34%), radial-gradient(circle at 88% 12%, color-mix(in oklab, #38bdf8 18%, transparent), transparent 30%), color-mix(in oklab, var(--card) 94%, transparent)"
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--muted)" }}>Mean Reversion Command</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold">High spread closing</h2>
            <StatusPill active={summary30d.active} />
          </div>
          <p className="mt-2 max-w-3xl text-sm" style={{ color: "var(--muted)" }}>
            Amit most keresünk: xarb taker spread legalább 5 bps, majd a spread záródása. Paper proxy: entry edge - exit edge, preferált exit: TP 8 bps / SL 5 bps.
          </p>
        </div>
        <div className="rounded-2xl border px-4 py-3 text-right" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 35%, transparent)" }}>
          <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>Aktuális MR setup</p>
          {latestCandidate ? (
            <>
              <strong className="text-xl">{latestCandidate.symbol}</strong>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{latestCandidate.exchange}</p>
              <p className="text-sm">edge {latestCandidate.taker_edge_bps.toFixed(2)} bps · {latestCandidate.persistence_ticks} tick</p>
            </>
          ) : (
            <>
              <strong className="text-xl">Nincs most</strong>
              <p className="text-sm" style={{ color: "var(--muted)" }}>Nincs friss 5+ bps MR candidate.</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {[
          ["24H", summary24h],
          ["7D", summary7d],
          ["30D", summary30d]
        ].map(([label, summary]) => {
          const s = summary as MeanReversionSummary;
          return (
            <div key={label as string} className="rounded-2xl border p-4" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 35%, transparent)" }}>
              <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>{label as string} MR saldo</p>
              <strong className="mt-2 block text-3xl" style={{ color: pnlColor(s.total_pnl_bps) }}>{s.total_pnl_bps.toFixed(2)} bps</strong>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {s.trials} trial · W/L/F {s.wins}/{s.losses}/{s.flat} · win {(s.win_rate * 100).toFixed(0)}%
              </p>
              <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                avg {s.avg_pnl_bps.toFixed(2)} · best/worst {s.best_pnl_bps.toFixed(2)} / {s.worst_pnl_bps.toFixed(2)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 rounded-2xl border p-4" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 30%, transparent)" }}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Gördülő MR saldo 30D</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>A mean-reversion paper trialok időrendben összeadva. Ezt akartuk látni: termelne-e saldóban.</p>
          </div>
          <strong className="text-2xl" style={{ color: pnlColor(summary30d.total_pnl_bps) }}>{summary30d.total_pnl_bps.toFixed(2)} bps</strong>
        </div>
        {series.length > 0 ? (
          <>
            <div className="mt-4 flex h-32 items-end gap-1 rounded-xl border px-3 py-3" style={{ borderColor: "var(--line)" }}>
              {series.map((point, index) => {
                const height = 10 + ((point.cumulative_bps - minSaldo) / range) * 92;
                return (
                  <div
                    key={`${point.ts}:${point.symbol}:${point.exchange}:${point.model}:${index}`}
                    className="min-w-[5px] flex-1 rounded-t-md"
                    title={`${formatTime(point.ts)} ${point.symbol} ${point.model} ${point.pnl_bps.toFixed(2)} bps, saldo ${point.cumulative_bps.toFixed(2)} bps`}
                    style={{
                      height,
                      background: point.cumulative_bps >= 0 ? "linear-gradient(180deg, #bbf7d0, #16a34a)" : "linear-gradient(180deg, #fecaca, #dc2626)",
                      opacity: 0.92
                    }}
                  />
                );
              })}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {series.slice(-6).reverse().map((point, index) => (
                <div key={`${point.ts}:row:${index}`} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
                  <span><strong>{point.symbol}</strong> · {point.exchange} · {formatTime(point.ts)}</span>
                  <span><span style={{ color: pnlColor(point.pnl_bps) }}>{point.pnl_bps.toFixed(2)} bps</span><span style={{ color: "var(--muted)" }}> · saldo </span><strong style={{ color: pnlColor(point.cumulative_bps) }}>{point.cumulative_bps.toFixed(2)}</strong></span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>Még nincs MR paper trial a kiválasztott ablakban.</p>
        )}
      </div>
    </section>
  );
}
