type ProposalRow = {
  id: string;
  created_at: string;
  model: string | null;
  decision: string;
  decision_reason: string | null;
};

type RolloutRow = {
  id: string;
  status: string;
  canary_ratio: number;
  start_ts: string;
  end_ts: string | null;
};

type EventRow = {
  id: number;
  ts: string;
  event_type: string;
};

type RolloutPerformanceRow = {
  rollout_id: string;
  config_id: string | null;
  status: string;
  opens: number;
  closed: number;
  pnl_sum_usd: number;
  expectancy_usd: number;
  canary_opens: number;
  last_entry_ts: string | null;
};

type PolicyControllerPanelProps = {
  diagnostics: Record<string, unknown> | null;
  proposals: ProposalRow[];
  rollouts: RolloutRow[];
  events: EventRow[];
  performance: RolloutPerformanceRow[];
  error?: string | null;
};

function formatPct(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

export default function PolicyControllerPanel({
  diagnostics,
  proposals,
  rollouts,
  events,
  performance,
  error
}: PolicyControllerPanelProps) {
  const blockedTypes = Array.isArray(diagnostics?.strategy_blocked_types)
    ? (diagnostics?.strategy_blocked_types as string[])
    : [];
  const rolloutStatus = String(diagnostics?.policy_rollout_status ?? "-");
  const isCanary = Boolean(diagnostics?.policy_is_canary ?? false);
  const controllerAction = String(diagnostics?.policy_controller_action ?? "-");
  const autoOpensShort = Number(diagnostics?.auto_opens_6h ?? 0);
  const autoPnlShort = Number(diagnostics?.auto_pnl_6h_usd ?? 0);
  const autoPnlLong = Number(diagnostics?.auto_pnl_30d_usd ?? 0);

  return (
    <section className="card">
      <h2 className="text-xl font-semibold">Policy Controller</h2>
      <p className="mt-1 text-sm text-brand-100/70">
        AI + guardrails policy lifecycle (canary, promote, rollback).
      </p>

      {error ? (
        <p className="mt-3 text-sm text-red-200">{error}</p>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-brand-300/15 p-3 text-sm">
          <p className="text-brand-100/60">Controller action</p>
          <p className="mt-1 font-medium">{controllerAction}</p>
        </div>
        <div className="rounded-xl border border-brand-300/15 p-3 text-sm">
          <p className="text-brand-100/60">Rollout status</p>
          <p className="mt-1 font-medium">
            {rolloutStatus} {isCanary ? "(canary)" : ""}
          </p>
        </div>
        <div className="rounded-xl border border-brand-300/15 p-3 text-sm">
          <p className="text-brand-100/60">Blocked strategy types</p>
          <p className="mt-1 font-medium">
            {blockedTypes.length > 0 ? blockedTypes.join(", ") : "none"}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-brand-300/15 p-3 text-sm">
          <p className="text-brand-100/60">Auto opens (short window)</p>
          <p className="mt-1 font-medium">{autoOpensShort}</p>
        </div>
        <div className="rounded-xl border border-brand-300/15 p-3 text-sm">
          <p className="text-brand-100/60">Auto PnL (short window)</p>
          <p className="mt-1 font-medium">{autoPnlShort.toFixed(4)} USD</p>
        </div>
        <div className="rounded-xl border border-brand-300/15 p-3 text-sm">
          <p className="text-brand-100/60">Auto PnL (30d)</p>
          <p className="mt-1 font-medium">{autoPnlLong.toFixed(4)} USD</p>
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-4">
        <div>
          <h3 className="text-sm font-semibold text-brand-100/80">Rollout Performance</h3>
          <div className="mt-2 space-y-2 text-xs">
            {performance.map((row) => (
              <div key={row.rollout_id} className="rounded-lg border border-brand-300/15 p-2">
                <p className="font-medium">{row.status}</p>
                <p className="text-brand-100/70">opens: {row.opens} | closed: {row.closed}</p>
                <p className="text-brand-100/70">
                  pnl: {row.pnl_sum_usd.toFixed(4)} | exp: {row.expectancy_usd.toFixed(4)}
                </p>
                <p className="text-brand-100/70">canary opens: {row.canary_opens}</p>
                <p className="text-brand-100/70">
                  {row.last_entry_ts ? new Date(row.last_entry_ts).toLocaleString("hu-HU") : "no entries"}
                </p>
              </div>
            ))}
            {performance.length === 0 ? (
              <p className="text-brand-100/60">Nincs rollout performance adat.</p>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-brand-100/80">Live Rollouts</h3>
          <div className="mt-2 space-y-2 text-xs">
            {rollouts.map((row) => (
              <div key={row.id} className="rounded-lg border border-brand-300/15 p-2">
                <p className="font-medium">{row.status}</p>
                <p className="text-brand-100/70">canary: {formatPct(Number(row.canary_ratio ?? 0))}</p>
                <p className="text-brand-100/70">{new Date(row.start_ts).toLocaleString("hu-HU")}</p>
              </div>
            ))}
            {rollouts.length === 0 ? (
              <p className="text-brand-100/60">Nincs rollout adat.</p>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-brand-100/80">Latest Proposals</h3>
          <div className="mt-2 space-y-2 text-xs">
            {proposals.map((row) => (
              <div key={row.id} className="rounded-lg border border-brand-300/15 p-2">
                <p className="font-medium">{row.decision}</p>
                <p className="text-brand-100/70">{row.model ?? "-"}</p>
                <p className="text-brand-100/70">{row.decision_reason ?? "-"}</p>
                <p className="text-brand-100/70">{new Date(row.created_at).toLocaleString("hu-HU")}</p>
              </div>
            ))}
            {proposals.length === 0 ? (
              <p className="text-brand-100/60">Nincs proposal adat.</p>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-brand-100/80">Recent Events</h3>
          <div className="mt-2 space-y-2 text-xs">
            {events.map((row) => (
              <div key={row.id} className="rounded-lg border border-brand-300/15 p-2">
                <p className="font-medium">{row.event_type}</p>
                <p className="text-brand-100/70">{new Date(row.ts).toLocaleString("hu-HU")}</p>
              </div>
            ))}
            {events.length === 0 ? (
              <p className="text-brand-100/60">Nincs event adat.</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
