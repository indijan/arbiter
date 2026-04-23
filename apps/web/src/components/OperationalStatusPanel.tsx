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

export default function OperationalStatusPanel({
  status,
  attention,
  importantNow,
  activeNow,
  events,
  summary
}: {
  status: OperationalStatus;
  attention: AttentionFlag;
  importantNow: ImportantItem[];
  activeNow: ActiveItem[];
  events: EventItem[];
  summary: Summary;
}) {
  const statusMeta = statusCopy(status);

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

        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
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
            <strong>{summary.paper_trade_profitable_24h}</strong>
          </div>
          <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <p style={{ color: "var(--muted)" }}>Best/Worst</p>
            <strong>{summary.best_paper_outcome_bps.toFixed(2)} / {summary.worst_paper_outcome_bps.toFixed(2)}</strong>
          </div>
        </div>
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
