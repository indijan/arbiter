import { redirect } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";
import DetectSummaryPanel from "@/components/DetectSummaryPanel";
import DevTickButton from "@/components/DevTickButton";
import PolicyControllerPanel from "@/components/PolicyControllerPanel";
import { createServerSupabase } from "@/lib/supabase/server";

type PolicyPositionRow = {
  entry_ts: string;
  exit_ts: string | null;
  realized_pnl_usd: number | string | null;
  meta: Record<string, unknown> | null;
};

type RolloutPerf = {
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

function formatUsd(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USD`;
}

function formatScore(score: number) {
  return `${Math.max(0, Math.min(100, Math.round(score)))}/100`;
}

export default async function DashboardPage() {
  const supabase = createServerSupabase();

  if (!supabase) {
    return (
      <div className="min-h-screen px-6 py-16">
        <div className="card mx-auto max-w-3xl space-y-2">
          <h1 className="text-2xl font-semibold">Dashboard OK</h1>
          <p className="text-sm text-brand-100/70">DB status: ERROR</p>
          <p className="text-sm text-brand-100/70">
            Hiányzó környezeti változók.
          </p>
        </div>
      </div>
    );
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error: opportunitiesError } = await supabase
    .from("opportunities")
    .select("id")
    .limit(5);

  const dbStatus = opportunitiesError ? "ERROR" : "OK";
  const dbMessage = opportunitiesError
    ? opportunitiesError.message
    : "Sikerült lekérni 5 sort.";

  const { data: latestTick } = await supabase
    .from("system_ticks")
    .select("detect_summary")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  const diagnostics = ((latestTick?.detect_summary as Record<string, unknown> | null)?.auto_execute as
    | Record<string, unknown>
    | null)?.diagnostics as Record<string, unknown> | null;

  const { data: policyRollouts, error: policyRolloutsError } = await supabase
    .from("strategy_policy_rollouts")
    .select("id, status, canary_ratio, start_ts, end_ts")
    .order("start_ts", { ascending: false })
    .limit(10);

  const { data: policyProposals, error: policyProposalsError } = await supabase
    .from("strategy_policy_proposals")
    .select("id, created_at, model, decision, decision_reason")
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: policyEvents, error: policyEventsError } = await supabase
    .from("strategy_policy_events")
    .select("id, ts, event_type, details")
    .order("ts", { ascending: false })
    .limit(15);

  const { data: policyPositions, error: policyPositionsError } = await supabase
    .from("positions")
    .select("entry_ts, exit_ts, realized_pnl_usd, meta")
    .eq("user_id", user.id)
    .order("entry_ts", { ascending: false })
    .limit(500);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: positions24h } = await supabase
    .from("positions")
    .select("id, entry_ts, exit_ts, realized_pnl_usd, symbol, status, meta")
    .eq("user_id", user.id)
    .gte("entry_ts", since24h)
    .order("entry_ts", { ascending: false })
    .limit(300);

  const { data: positions7d } = await supabase
    .from("positions")
    .select("id, entry_ts, exit_ts, realized_pnl_usd, symbol, status, meta")
    .eq("user_id", user.id)
    .gte("entry_ts", since7d)
    .order("entry_ts", { ascending: false })
    .limit(1000);

  const { data: recentSignals } = await supabase
    .from("opportunities")
    .select("id, ts, exchange, symbol, type, net_edge_bps, details")
    .eq("type", "xarb_spot")
    .gte("ts", since24h)
    .order("net_edge_bps", { ascending: false })
    .limit(20);

  const policyError =
    policyRolloutsError?.message ??
    policyProposalsError?.message ??
    policyEventsError?.message ??
    policyPositionsError?.message ??
    null;

  const rolloutStatusMap = new Map((policyRollouts ?? []).map((row) => [row.id, row.status]));
  const perfMap = new Map<string, RolloutPerf>();
  for (const row of (policyPositions ?? []) as PolicyPositionRow[]) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    if (meta.auto_execute !== true) continue;
    const rolloutId = String(meta.policy_rollout_id ?? "");
    if (!rolloutId) continue;
    const configId = meta.policy_config_id ? String(meta.policy_config_id) : null;
    const isCanary = meta.policy_is_canary === true;
    const existing = perfMap.get(rolloutId) ?? {
      rollout_id: rolloutId,
      config_id: configId,
      status: rolloutStatusMap.get(rolloutId) ?? "historical",
      opens: 0,
      closed: 0,
      pnl_sum_usd: 0,
      expectancy_usd: 0,
      canary_opens: 0,
      last_entry_ts: null
    };
    existing.opens += 1;
    if (isCanary) existing.canary_opens += 1;
    if (!existing.last_entry_ts || row.entry_ts > existing.last_entry_ts) {
      existing.last_entry_ts = row.entry_ts;
    }
    if (row.exit_ts) {
      existing.closed += 1;
      const pnl = Number(row.realized_pnl_usd ?? 0);
      if (Number.isFinite(pnl)) existing.pnl_sum_usd += pnl;
    }
    perfMap.set(rolloutId, existing);
  }

  const rolloutPerformance = Array.from(perfMap.values())
    .map((row) => ({
      ...row,
      expectancy_usd: row.closed > 0 ? row.pnl_sum_usd / row.closed : 0
    }))
    .sort((a, b) => {
      const at = a.last_entry_ts ?? "";
      const bt = b.last_entry_ts ?? "";
      return bt.localeCompare(at);
    })
    .slice(0, 10);

  const detectSummary = (latestTick?.detect_summary ?? {}) as Record<string, unknown>;
  const xarbSummary = (detectSummary.xarb_spot ?? {}) as Record<string, unknown>;
  const autoSummary = (detectSummary.auto_execute ?? {}) as Record<string, unknown>;
  const reasonsTop = Array.isArray(autoSummary.reasons_top)
    ? (autoSummary.reasons_top as Array<{ reason?: string; count?: number }>)
    : [];
  const topReason = reasonsTop[0]?.reason ?? "none";
  const topReasonCount = Number(reasonsTop[0]?.count ?? 0);

  const positions24hRows = positions24h ?? [];
  const positions7dRows = positions7d ?? [];
  const closed24h = positions24hRows.filter((row) => row.status === "closed");
  const closed7d = positions7dRows.filter((row) => row.status === "closed");
  const opens24h = positions24hRows.length;
  const opens7d = positions7dRows.length;
  const pnl24h = closed24h.reduce(
    (sum, row) => sum + Number(row.realized_pnl_usd ?? 0),
    0
  );
  const pnl7d = closed7d.reduce(
    (sum, row) => sum + Number(row.realized_pnl_usd ?? 0),
    0
  );

  const topSignal = (recentSignals ?? [])[0] as
    | {
        ts: string;
        exchange: string;
        symbol: string;
        net_edge_bps: number | null;
        details: Record<string, unknown> | null;
      }
    | undefined;

  const topSignalLabel = topSignal
    ? `${topSignal.symbol} · ${topSignal.exchange}`
    : "No live xarb signal";
  const topSignalEdge = topSignal?.net_edge_bps ?? null;

  let readinessScore = 20;
  if (opens7d >= 2) readinessScore += 15;
  if (closed7d.length >= 2) readinessScore += 15;
  if (pnl7d > 0) readinessScore += 20;
  if (pnl24h > 0) readinessScore += 10;
  if ((Number(xarbSummary.inserted ?? 0) || 0) > 0) readinessScore += 10;
  if (topSignalEdge !== null && topSignalEdge >= 2) readinessScore += 10;
  if (topReason === "live_edge_below_threshold") readinessScore -= 10;
  if (opens24h === 0) readinessScore -= 10;
  readinessScore = Math.max(0, Math.min(100, readinessScore));

  const recommendation =
    readinessScore >= 70
      ? "Paper mehet"
      : readinessScore >= 40
        ? "Observe only"
        : "Ne engedd live-ra";

  const recommendationTone =
    readinessScore >= 70
      ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-100"
      : readinessScore >= 40
        ? "border-amber-300/30 bg-amber-500/10 text-amber-100"
        : "border-rose-300/30 bg-rose-500/10 text-rose-100";

  const blockerLabel =
    topReason === "none"
      ? "Nincs friss nyitási próbálkozás"
      : `${topReason}${topReasonCount > 0 ? ` (${topReasonCount})` : ""}`;

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-brand-300">
              Dashboard
            </p>
            <h1 className="text-3xl font-semibold">Dashboard OK</h1>
            <p className="mt-2 text-sm text-brand-100/70">
              DB status: {dbStatus}
            </p>
            <p className="text-sm text-brand-100/70">{dbMessage}</p>
            <div className="mt-3 flex gap-3 text-sm">
              <a className="text-brand-300 hover:text-white" href="/ops">
                Ops
              </a>
              <a className="text-brand-300 hover:text-white" href="/settings">
                Settings
              </a>
              <a className="text-brand-300 hover:text-white" href="/simple">
                Simple dashboard
              </a>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DevTickButton />
            <LogoutButton />
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-12">
          <div className="card lg:col-span-4">
            <p className="text-sm uppercase tracking-[0.24em] text-brand-300">Recommendation</p>
            <div className={`mt-4 rounded-2xl border px-4 py-4 ${recommendationTone}`}>
              <p className="text-sm text-current/70">Current mode</p>
              <p className="mt-1 text-2xl font-semibold">{recommendation}</p>
              <p className="mt-3 text-sm text-current/80">
                Main blocker: {blockerLabel}
              </p>
            </div>
          </div>

          <div className="card lg:col-span-2">
            <p className="text-sm uppercase tracking-[0.24em] text-brand-300">Readiness</p>
            <p className="mt-4 text-4xl font-semibold">{formatScore(readinessScore)}</p>
            <p className="mt-2 text-sm text-brand-100/70">
              Replay + live feed confidence
            </p>
          </div>

          <div className="card lg:col-span-2">
            <p className="text-sm uppercase tracking-[0.24em] text-brand-300">24h</p>
            <p className="mt-4 text-3xl font-semibold">{opens24h}</p>
            <p className="mt-1 text-sm text-brand-100/70">opens</p>
            <p className="mt-3 text-lg font-semibold">{formatUsd(pnl24h)}</p>
            <p className="text-sm text-brand-100/70">closed pnl</p>
          </div>

          <div className="card lg:col-span-2">
            <p className="text-sm uppercase tracking-[0.24em] text-brand-300">7d</p>
            <p className="mt-4 text-3xl font-semibold">{opens7d}</p>
            <p className="mt-1 text-sm text-brand-100/70">opens</p>
            <p className="mt-3 text-lg font-semibold">{formatUsd(pnl7d)}</p>
            <p className="text-sm text-brand-100/70">closed pnl</p>
          </div>

          <div className="card lg:col-span-2">
            <p className="text-sm uppercase tracking-[0.24em] text-brand-300">Top pair</p>
            <p className="mt-4 text-xl font-semibold">{topSignalLabel}</p>
            <p className="mt-2 text-sm text-brand-100/70">
              {topSignalEdge !== null ? `${topSignalEdge.toFixed(2)} bps net` : "No edge"}
            </p>
            <p className="mt-3 text-sm text-brand-100/70">
              Xarb inserted: {Number(xarbSummary.inserted ?? 0)}
            </p>
          </div>
        </section>

        <DetectSummaryPanel />
        <PolicyControllerPanel
          diagnostics={diagnostics}
          proposals={policyProposals ?? []}
          rollouts={policyRollouts ?? []}
          events={policyEvents ?? []}
          performance={rolloutPerformance}
          error={policyError}
        />
      </div>
    </div>
  );
}
