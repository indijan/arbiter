type OperationalStatus = "idle" | "watching" | "go_candidate_live" | "paper_position_active" | "profit_event_logged" | "risk_event_logged";
type AttentionFlag = "none" | "watch" | "actionable" | "resolved";

type ImportantItem = {
  type: string;
  ts: string;
  headline: string;
  details: string;
};

type ActiveItem = {
  kind: string;
  symbol: string;
  strategy: string;
  exchange: string;
  state: string;
  summary: string;
};

type EventItem = {
  event_type: string;
  ts: string;
  symbol: string;
  strategy: string;
  exchange: string;
  severity: "info" | "watch" | "action" | "profit" | "risk";
  headline: string;
  details: string;
};

type Summary = {
  had_go_candidate_today: boolean;
  go_candidate_count_24h: number;
  active_go_candidate_now: boolean;
  paper_trade_started_24h: number;
  paper_trade_profitable_24h: number;
  paper_trade_stopped_24h: number;
  best_paper_outcome_bps: number;
  worst_paper_outcome_bps: number;
  total_paper_pnl_bps: number;
  avg_paper_outcome_bps: number;
  paper_trade_loss_24h: number;
  paper_trade_flat_24h: number;
};

type PnlPoint = {
  ts: string;
  symbol: string;
  exchange: string;
  pnl_bps: number;
  cumulative_bps: number;
};

function statusCopy(status: OperationalStatus) {
  const copy: Record<OperationalStatus, { label: string; tone: string; explainer: string }> = {
    idle: {
      label: "Nincs akció",
      tone: "#64748b",
      explainer: "Most nincs nyitható setup és nincs friss lezárt esemény."
    },
    watching: {
      label: "Figyelni kell",
      tone: "#f59e0b",
      explainer: "Van érdekes setup, de még nem nyitható."
    },
    go_candidate_live: {
      label: "Akció van",
      tone: "#22c55e",
      explainer: "Van aktív xarb opening-trial go candidate."
    },
    paper_position_active: {
      label: "Paper futna",
      tone: "#38bdf8",
      explainer: "Paper-first próba aktívnak tekinthető."
    },
    profit_event_logged: {
      label: "Profit event",
      tone: "#84cc16",
      explainer: "Volt pozitív paper outcome a vizsgált ablakban."
    },
    risk_event_logged: {
      label: "Risk event",
      tone: "#ef4444",
      explainer: "Volt invalidálás, stop vagy negatív paper outcome."
    }
  };
  return copy[status];
}

function attentionCopy(flag: AttentionFlag) {
  const copy: Record<AttentionFlag, string> = {
    none: "Nem kell nézni",
    watch: "Érdemes figyelni",
    actionable: "Nézd meg most",
    resolved: "Esemény lezárult"
  };
  return copy[flag];
}

function eventTone(severity: EventItem["severity"]) {
  if (severity === "action") return "#22c55e";
  if (severity === "profit") return "#84cc16";
  if (severity === "risk") return "#ef4444";
  if (severity === "watch") return "#f59e0b";
  return "var(--accent)";
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
}

function pnlColor(value: number) {
  if (value > 0) return "#84cc16";
  if (value < 0) return "#ef4444";
  return "var(--text)";
}

export default function OperationalStatusPanel({
  status,
  attention,
  importantNow,
  activeNow,
  events,
  summary,
  pnlSeries
}: {
  status: OperationalStatus;
  attention: AttentionFlag;
  importantNow: ImportantItem[];
  activeNow: ActiveItem[];
  events: EventItem[];
  summary: Summary;
  pnlSeries: PnlPoint[];
}) {
  const statusMeta = statusCopy(status);
  const minSaldo = Math.min(0, ...pnlSeries.map((point) => point.cumulative_bps));
  const maxSaldo = Math.max(0, ...pnlSeries.map((point) => point.cumulative_bps));
  const saldoRange = Math.max(1, maxSaldo - minSaldo);

  return (
    <section
      className="mb-6 overflow-hidden rounded-[2rem] border p-5"
      style={{
        borderColor: "color-mix(in oklab, var(--accent) 28%, var(--line))",
        background:
          "radial-gradient(circle at 12% 18%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 34%), color-mix(in oklab, var(--card) 92%, transparent)"
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--muted)" }}>
            Operational status
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span
              className="rounded-full px-4 py-2 text-sm font-bold"
              style={{ background: `${statusMeta.tone}22`, color: statusMeta.tone, border: `1px solid ${statusMeta.tone}66` }}
            >
              {statusMeta.label}
            </span>
            <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "var(--bg-alt)", color: "var(--text)" }}>
              {attentionCopy(attention)}
            </span>
          </div>
          <p className="mt-3 max-w-2xl text-sm" style={{ color: "var(--muted)" }}>
            {statusMeta.explainer}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>Go 24h</p>
            <strong>{summary.go_candidate_count_24h}</strong>
          </div>
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>Aktív go</p>
            <strong>{summary.active_go_candidate_now ? "igen" : "nem"}</strong>
          </div>
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>Profit</p>
            <strong>{summary.paper_trade_profitable_24h}/{summary.paper_trade_loss_24h}/{summary.paper_trade_flat_24h}</strong>
          </div>
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>Paper PnL 24h</p>
            <strong style={{ color: summary.total_paper_pnl_bps > 0 ? "#84cc16" : summary.total_paper_pnl_bps < 0 ? "#ef4444" : "var(--text)" }}>
              {summary.total_paper_pnl_bps.toFixed(2)} bps
            </strong>
          </div>
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>Átlag</p>
            <strong>{summary.avg_paper_outcome_bps.toFixed(2)} bps</strong>
          </div>
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>Best/Worst</p>
            <strong>{summary.best_paper_outcome_bps.toFixed(2)} / {summary.worst_paper_outcome_bps.toFixed(2)}</strong>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border p-4" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 35%, transparent)" }}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Gördített paper saldo 24h</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Minden 24H go jel proxy kimenete időrendben összeadva. Ez mutatja, mit termelt volna saldóban.
            </p>
          </div>
          <strong className="text-2xl" style={{ color: pnlColor(summary.total_paper_pnl_bps) }}>
            {summary.total_paper_pnl_bps.toFixed(2)} bps
          </strong>
        </div>

        {pnlSeries.length > 0 ? (
          <>
            <div className="mt-4 flex h-28 items-end gap-1 rounded-xl border px-3 py-3" style={{ borderColor: "var(--line)" }}>
              {pnlSeries.map((point, index) => {
                const height = 12 + ((point.cumulative_bps - minSaldo) / saldoRange) * 76;
                return (
                  <div
                    key={`${point.ts}:${point.symbol}:${point.exchange}:${index}`}
                    className="min-w-[8px] flex-1 rounded-t-md"
                    title={`${formatTime(point.ts)} ${point.symbol} ${point.pnl_bps.toFixed(2)} bps, saldo ${point.cumulative_bps.toFixed(2)} bps`}
                    style={{
                      height,
                      background: point.cumulative_bps >= 0 ? "linear-gradient(180deg, #bef264, #16a34a)" : "linear-gradient(180deg, #fca5a5, #dc2626)",
                      opacity: 0.9
                    }}
                  />
                );
              })}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {pnlSeries.slice(-6).reverse().map((point, index) => (
                <div key={`${point.ts}:${point.symbol}:${point.exchange}:row:${index}`} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
                  <span>
                    <strong>{point.symbol}</strong> · {point.exchange} · {formatTime(point.ts)}
                  </span>
                  <span>
                    <span style={{ color: pnlColor(point.pnl_bps) }}>{point.pnl_bps.toFixed(2)} bps</span>
                    <span style={{ color: "var(--muted)" }}> · saldo </span>
                    <strong style={{ color: pnlColor(point.cumulative_bps) }}>{point.cumulative_bps.toFixed(2)}</strong>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            Még nincs 24H paper/opening trial, ezért nincs gördített saldo.
          </p>
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg-alt) 42%, transparent)" }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Most fontos</h2>
            <span className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>
              {summary.had_go_candidate_today ? "volt go jel" : "nincs go jel"}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {importantNow.map((item) => (
              <article key={`${item.type}:${item.ts}:${item.headline}`} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{item.headline}</p>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{formatTime(item.ts)}</span>
                </div>
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{item.details}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--line)" }}>
          <h3 className="font-semibold">Aktív most</h3>
          <div className="mt-3 space-y-2">
            {activeNow.length > 0 ? (
              activeNow.map((item) => (
                <div key={`${item.kind}:${item.symbol}:${item.exchange}`} className="rounded-xl px-3 py-2" style={{ background: "var(--bg-alt)" }}>
                  <p className="font-semibold">{item.symbol} · {item.exchange}</p>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{item.summary}</p>
                </div>
              ))
            ) : (
              <p className="text-sm" style={{ color: "var(--muted)" }}>Nincs aktív go vagy watch-more jel.</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: "var(--line)" }}>
        <h3 className="font-semibold">Friss események</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {events.length > 0 ? (
            events.slice(0, 6).map((event) => (
              <div key={`${event.event_type}:${event.ts}:${event.symbol}`} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold" style={{ color: eventTone(event.severity) }}>{event.headline}</p>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{formatTime(event.ts)}</span>
                </div>
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{event.details}</p>
              </div>
            ))
          ) : (
            <p className="text-sm" style={{ color: "var(--muted)" }}>Még nincs érdemi esemény a vizsgált ablakban.</p>
          )}
        </div>
      </div>
    </section>
  );
}
