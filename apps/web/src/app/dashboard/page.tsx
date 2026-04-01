import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { lanePolicyStateFromRow, type LanePolicyState } from "@/server/lanes/policy";
import ApplyLanePolicyButton from "@/components/ApplyLanePolicyButton";
import CandidatePolicyStatusButton from "@/components/CandidatePolicyStatusButton";

type PositionRow = {
  id: number;
  entry_ts: string;
  exit_ts: string | null;
  symbol: string;
  status: string;
  realized_pnl_usd: number | string | null;
  spot_qty: number | string | null;
  entry_spot_price: number | string | null;
  meta: Record<string, unknown> | null;
};

type ExchangeStats = {
  exchange: string;
  closedCount: number;
  openCount: number;
  pnl24h: number;
  pnl7d: number;
};

type SnapshotRow = {
  ts: string;
  symbol: string;
  spot_bid: number | string | null;
  spot_ask: number | string | null;
};

type LaneState = "active" | "watch" | "standby";
type StrategySettingRow = {
  strategy_key: string;
  enabled: boolean;
  config?: Record<string, unknown> | null;
};

type LanePolicyReviewRow = {
  id: string;
  created_at: string;
  current_btc_regime: string;
  current_btc_momentum_6h_bps: number | string;
  model: string | null;
  used_ai: boolean;
  summary: {
    market_label?: string;
    opening_expectation?: string;
    operator_message?: string;
    next_action?: string;
    news_risk_message?: string | null;
    active_now_count?: number;
    watch_now_count?: number;
    standby_now_count?: number;
    paused_now_count?: number;
    active_after_apply_count?: number;
    watch_after_apply_count?: number;
    standby_after_apply_count?: number;
    paused_after_apply_count?: number;
    candidate_policies?: Array<{
      id?: string;
      symbol: string;
      label: string;
      regime: string;
      why: string;
      rule_hint: string;
      rule_config?: Record<string, unknown>;
      priority: "high" | "medium";
      trade_count: number;
      pnl_30d_usd: number;
      expectancy_30d_usd: number;
      status?: "candidate" | "validated" | "canary" | "rejected";
    }>;
  } | null;
  recommendations: Array<{
    strategy_key: string;
    label: string;
    current_state: LanePolicyState;
    recommended_state: LanePolicyState;
    reason: string;
    confidence: number;
  }> | null;
};

type CandidatePolicyRow = {
  id: string;
  label: string;
  regime: string;
  status: "candidate" | "validated" | "canary" | "rejected";
};

const LANE_LABELS = [
  "XRP core short",
  "XRP bull fade canary",
  "AVAX canary short",
  "SOL soft-bear laggard",
  "SOL deep-bear continuation"
] as const;

const LANE_LABEL_TO_KEY: Record<(typeof LANE_LABELS)[number], string> = {
  "XRP core short": "xrp_shadow_short_core",
  "XRP bull fade canary": "xrp_shadow_short_bull_fade_canary",
  "AVAX canary short": "avax_shadow_short_canary",
  "SOL soft-bear laggard": "sol_shadow_short_soft_bear_laggard",
  "SOL deep-bear continuation": "sol_shadow_short_deep_bear_continuation"
};

function policyToneClass(state: LanePolicyState | LaneState) {
  if (state === "active") return "border-emerald-300/20 bg-emerald-500/10 text-emerald-100";
  if (state === "watch") return "border-amber-300/20 bg-amber-500/10 text-amber-100";
  if (state === "standby") return "border-sky-300/20 bg-sky-500/10 text-sky-100";
  return "border-rose-300/20 bg-rose-500/10 text-rose-100";
}

function stateLabel(state: LanePolicyState | LaneState) {
  if (state === "active") return "Kereskedik";
  if (state === "watch") return "Figyel";
  if (state === "standby") return "Várakozik";
  return "Leállítva";
}

function regimeHumanLabel(regime: string) {
  if (regime === "btc_neg_strong") return "Erős eső piac";
  if (regime === "btc_neg") return "Enyhén eső piac";
  if (regime === "btc_pos") return "Enyhén emelkedő piac";
  if (regime === "btc_pos_strong") return "Erősen emelkedő piac";
  return "Oldalazó / bizonytalan piac";
}

function simpleRecommendationReason(state: LanePolicyState) {
  if (state === "active") return "A rendszer szerint ebben a piaci helyzetben érdemes automatikusan kereskednie.";
  if (state === "watch") return "A rendszer figyelje ezt a setupot, de még ne nyisson rá automatikusan.";
  if (state === "standby") return "Most nem ez a jó piaci helyzet ehhez a lane-hez, ezért maradjon készenlétben.";
  return "A rendszer szerint ezt most teljesen ki kell kapcsolni.";
}

function humanRecommendationReason(reason: string, recommendedState: LanePolicyState) {
  const normalized = reason.trim().toLowerCase();
  if (!normalized) return simpleRecommendationReason(recommendedState);
  if (normalized.includes("recent 7d underperformance")) {
    return "Az utóbbi 7 napban ez a lane gyengén teljesített ebben a piaci helyzetben, ezért a rendszer visszavenné.";
  }
  if (normalized.includes("30d lane expectancy is negative")) {
    return "Az utóbbi 30 nap összképe alapján ez a lane most nem megbízható, ezért a rendszer kivenné az aktív körből.";
  }
  if (normalized.includes("historical lane performance suggests observation-worthy candidate")) {
    return "A múltbeli adatok alapján ezt érdemes figyelni, de még nem elég erős az automatikus kereskedéshez.";
  }
  if (normalized.includes("best historical candidate for this regime")) {
    return "Ebben a piaci helyzetben ez a legjobb történelmi jelölt, ezért a rendszer ezt emelné aktív kereskedésre.";
  }
  if (normalized.startsWith("regime baseline")) {
    return simpleRecommendationReason(recommendedState);
  }
  return reason;
}

function recommendationStrength(confidence: number) {
  if (confidence >= 0.8) return { label: "Erős javaslat", bars: 5 };
  if (confidence >= 0.65) return { label: "Jó javaslat", bars: 4 };
  if (confidence >= 0.5) return { label: "Közepes javaslat", bars: 3 };
  if (confidence >= 0.35) return { label: "Gyenge javaslat", bars: 2 };
  return { label: "Bizonytalan javaslat", bars: 1 };
}

function recommendationStrengthColor(confidence: number) {
  const bars = recommendationStrength(confidence).bars;
  if (bars <= 2) return "bg-rose-300";
  if (bars === 3) return "bg-amber-300";
  return "bg-emerald-300";
}

function candidateStatusTone(status: CandidatePolicyRow["status"] | undefined) {
  if (status === "canary") return "border-emerald-300/20 bg-emerald-500/10 text-emerald-100";
  if (status === "validated") return "border-amber-300/20 bg-amber-500/10 text-amber-100";
  if (status === "rejected") return "border-rose-300/20 bg-rose-500/10 text-rose-100";
  return "border-sky-300/20 bg-sky-500/10 text-sky-100";
}

function candidateStatusLabel(status: CandidatePolicyRow["status"] | undefined) {
  if (status === "canary") return "Canary";
  if (status === "validated") return "Validált";
  if (status === "rejected") return "Elvetve";
  return "Jelölt";
}

function applyImpactSummary(
  recommendations: Array<{ recommended_state: LanePolicyState }> | null | undefined
) {
  const rows = recommendations ?? [];
  const counts = {
    active: rows.filter((row) => row.recommended_state === "active").length,
    watch: rows.filter((row) => row.recommended_state === "watch").length,
    standby: rows.filter((row) => row.recommended_state === "standby").length,
    paused: rows.filter((row) => row.recommended_state === "paused").length
  };
  return `${counts.active} kereskedik, ${counts.watch} figyel, ${counts.standby} várakozik, ${counts.paused} leállítva.`;
}


function asNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function usd(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} USD`;
}

function compactUsd(value: number) {
  return `${value.toFixed(2)} USD`;
}


function toneClass(value: number) {
  if (value > 0) return "text-emerald-200";
  if (value < 0) return "text-rose-200";
  return "text-brand-100";
}

function toneSurfaceClass(value: number) {
  if (value > 0) return "border-emerald-300/20 bg-emerald-500/10";
  if (value < 0) return "border-rose-300/20 bg-rose-500/10";
  return "border-brand-300/10 bg-brand-900/35";
}

function pnlCardClass(value: number) {
  return `rounded-2xl border p-4 ${toneSurfaceClass(value)}`;
}

function pnlValueClass(value: number, size: "md" | "lg" = "lg") {
  const base = size === "lg" ? "text-4xl font-semibold tracking-tight" : "text-xl font-semibold";
  return `${base} ${toneClass(value)}`;
}


function formatTs(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("hu-HU");
}

function formatCompactTs(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return new Intl.DateTimeFormat("hu-HU", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatAgeMinutes(value: string | null) {
  if (!value) return "-";
  const ms = Date.now() - new Date(value).getTime();
  const mins = ms / 60000;
  if (!Number.isFinite(mins)) return "-";
  if (mins < 1) return "<1 perc";
  if (mins < 60) return `${mins.toFixed(1)} perc`;
  return `${(mins / 60).toFixed(1)} óra`;
}


function metaBool(meta: Record<string, unknown> | null, key: string) {
  return meta?.[key] === true;
}

function formatExchange(meta: Record<string, unknown> | null) {
  if (!meta) return "-";
  const exchange = typeof meta.exchange === "string" ? meta.exchange : null;
  const buyExchange = typeof meta.buy_exchange === "string" ? meta.buy_exchange : null;
  const sellExchange = typeof meta.sell_exchange === "string" ? meta.sell_exchange : null;
  if (exchange) return exchange;
  if (buyExchange && sellExchange) return `${buyExchange} -> ${sellExchange}`;
  return buyExchange ?? sellExchange ?? "-";
}

function bucketHourIso(value: string) {
  return new Date(Math.floor(new Date(value).getTime() / 3600000) * 3600000).toISOString();
}

function sparklinePath(values: number[], width: number, height: number) {
  if (values.length === 0) return "";
  if (values.length === 1) return `M 0 ${height / 2} L ${width} ${height / 2}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}


export default async function DashboardPage() {
  async function signOutAction() {
    "use server";

    const supabase = createServerSupabase();
    await supabase?.auth.signOut();
    redirect("/login");
  }

  const supabase = createServerSupabase();

  if (!supabase) {
    return (
      <div className="min-h-screen px-4 py-10 sm:px-6 sm:py-14">
        <div className="card mx-auto max-w-3xl space-y-2">
          <h1 className="text-2xl font-semibold">Arbiter cockpit</h1>
          <p className="text-sm text-brand-100/70">Hiányzó környezeti változók.</p>
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

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    paperAccountResult,
    positions30dResult,
    openPositionsResult,
    recentClosedResult,
    btcSnapshotsResult,
    strategySettingsResult,
    lanePolicyReviewResult,
    candidatePoliciesResult
  ] = await Promise.all([
    supabase
      .from("paper_accounts")
      .select("balance_usd, reserved_usd, min_notional_usd, max_notional_usd")
      .maybeSingle(),
    supabase
      .from("positions")
      .select("id, entry_ts, exit_ts, symbol, status, realized_pnl_usd, spot_qty, entry_spot_price, meta")
      .eq("user_id", user.id)
      .gte("entry_ts", since30d)
      .order("entry_ts", { ascending: false })
      .limit(1500),
    supabase
      .from("positions")
      .select("id, entry_ts, exit_ts, symbol, status, realized_pnl_usd, spot_qty, entry_spot_price, meta")
      .eq("user_id", user.id)
      .eq("status", "open")
      .order("entry_ts", { ascending: false })
      .limit(20),
    supabase
      .from("positions")
      .select("id, entry_ts, exit_ts, symbol, status, realized_pnl_usd, spot_qty, entry_spot_price, meta")
      .eq("user_id", user.id)
      .eq("status", "closed")
      .order("exit_ts", { ascending: false })
      .limit(12),
    supabase
      .from("market_snapshots")
      .select("ts, symbol, spot_bid, spot_ask")
      .eq("exchange", "coinbase")
      .eq("symbol", "BTCUSD")
      .gte("ts", new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString())
      .order("ts", { ascending: true })
      .limit(1000),
    supabase
      .from("strategy_settings")
      .select("strategy_key, enabled, config")
      .in("strategy_key", Object.values(LANE_LABEL_TO_KEY)),
    supabase
      .from("lane_policy_reviews")
      .select("id, created_at, current_btc_regime, current_btc_momentum_6h_bps, model, used_ai, summary, recommendations")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("candidate_lane_policies")
      .select("id, label, regime, status")
      .order("updated_at", { ascending: false })
      .limit(100)
  ]);

  const balanceUsd = asNumber(paperAccountResult.data?.balance_usd ?? 10000);
  const reservedUsd = asNumber(paperAccountResult.data?.reserved_usd ?? 0);
  const availableUsd = Math.max(0, balanceUsd - reservedUsd);
  const reserveRatio = balanceUsd > 0 ? (reservedUsd / balanceUsd) * 100 : 0;
  const absoluteProfitUsd = balanceUsd - 10000;

  const positions30d = (positions30dResult.data ?? []) as PositionRow[];
  const openPositions = (openPositionsResult.data ?? []) as PositionRow[];
  const recentClosed = (recentClosedResult.data ?? []) as PositionRow[];
  const capitalDial = Math.round(reserveRatio * 3.6);

  const closed24h = positions30d.filter((row) => row.status === "closed" && row.exit_ts && row.exit_ts >= since24h);
  const closed7d = positions30d.filter((row) => row.status === "closed" && row.exit_ts && row.exit_ts >= since7d);
  const closed30d = positions30d.filter((row) => row.status === "closed");
  const opened24h = positions30d.filter((row) => row.entry_ts >= since24h);
  const opened7d = positions30d.filter((row) => row.entry_ts >= since7d);

  const pnl24h = closed24h.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const pnl7d = closed7d.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const pnl30d = closed30d.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);

  const shadowRows = positions30d.filter((row) => metaBool(row.meta, "relative_strength_open"));
  const shadowWithBtcMeta = shadowRows.filter((row) => row.meta?.btc_momentum_6h_bps !== null && row.meta?.btc_momentum_6h_bps !== undefined);
  const shadowClosed = shadowWithBtcMeta.filter((row) => row.status === "closed");
  const shadowOpen = shadowWithBtcMeta.filter((row) => row.status === "open");
  const shadowXrpCoreClosed = shadowClosed.filter((row) => String(row.meta?.strategy_variant ?? "") === "xrp_shadow_short_core");
  const shadowXrpBullFadeClosed = shadowClosed.filter((row) => String(row.meta?.strategy_variant ?? "") === "xrp_shadow_short_bull_fade_canary");
  const shadowAvaxClosed = shadowClosed.filter((row) => String(row.meta?.strategy_variant ?? "") === "avax_shadow_short_canary");
  const shadowSolSoftBearClosed = shadowClosed.filter((row) => String(row.meta?.strategy_variant ?? "") === "sol_shadow_short_soft_bear_laggard");
  const shadowSolDeepBearClosed = shadowClosed.filter((row) => String(row.meta?.strategy_variant ?? "") === "sol_shadow_short_deep_bear_continuation");
  const shadowXrpCoreOpen = shadowOpen.filter((row) => String(row.meta?.strategy_variant ?? "") === "xrp_shadow_short_core");
  const shadowXrpBullFadeOpen = shadowOpen.filter((row) => String(row.meta?.strategy_variant ?? "") === "xrp_shadow_short_bull_fade_canary");
  const shadowAvaxOpen = shadowOpen.filter((row) => String(row.meta?.strategy_variant ?? "") === "avax_shadow_short_canary");
  const shadowSolSoftBearOpen = shadowOpen.filter((row) => String(row.meta?.strategy_variant ?? "") === "sol_shadow_short_soft_bear_laggard");
  const shadowSolDeepBearOpen = shadowOpen.filter((row) => String(row.meta?.strategy_variant ?? "") === "sol_shadow_short_deep_bear_continuation");
  const shadowXrpCorePnl = shadowXrpCoreClosed.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const shadowXrpBullFadePnl = shadowXrpBullFadeClosed.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const shadowAvaxPnl = shadowAvaxClosed.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const shadowSolSoftBearPnl = shadowSolSoftBearClosed.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const shadowSolDeepBearPnl = shadowSolDeepBearClosed.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const btcSnapshots = (btcSnapshotsResult.data ?? []) as SnapshotRow[];
  const btcHourly = new Map<string, number>();
  for (const row of btcSnapshots) {
    const bid = asNumber(row.spot_bid);
    const ask = asNumber(row.spot_ask);
    if (!(ask > bid) || bid <= 0) continue;
    btcHourly.set(bucketHourIso(row.ts), (bid + ask) / 2);
  }
  const btcHours = Array.from(btcHourly.keys()).sort();
  const latestBtcHour = btcHours[btcHours.length - 1] ?? null;
  const lookbackBtcHour = btcHours.length >= 7 ? btcHours[btcHours.length - 7] : null;
  const latestBtcMid = latestBtcHour ? btcHourly.get(latestBtcHour) ?? 0 : 0;
  const lookbackBtcMid = lookbackBtcHour ? btcHourly.get(lookbackBtcHour) ?? 0 : 0;
  const latestBtcMomentum =
    latestBtcMid > 0 && lookbackBtcMid > 0 ? ((latestBtcMid - lookbackBtcMid) / lookbackBtcMid) * 10000 : 0;
  const latestBtcRegime =
    latestBtcMomentum <= -100
      ? "btc_neg_strong"
      : latestBtcMomentum < 0
        ? "btc_neg"
        : latestBtcMomentum >= 150
          ? "btc_pos_strong"
          : latestBtcMomentum > 0
            ? "btc_pos"
          : "flat/unknown";
  const latestBtcRegimeLabel =
    latestBtcMomentum <= -100
      ? "Bear"
      : latestBtcMomentum < 0
        ? "Soft Bear"
        : latestBtcMomentum >= 150
          ? "Bull"
          : latestBtcMomentum > 0
            ? "Soft Bull"
            : "Flat";
  const regimeTone =
    latestBtcMomentum < 0
      ? "border-emerald-300/20 bg-emerald-500/10 text-emerald-100"
      : latestBtcMomentum > 0
        ? "border-amber-300/20 bg-amber-500/10 text-amber-100"
        : "border-brand-300/15 text-brand-100/70";
  const btcRegimeDial = Math.max(-180, Math.min(180, latestBtcMomentum / 2.5));
  const lanePolicyMap = new Map(
    ((strategySettingsResult.data ?? []) as StrategySettingRow[]).map((row) => [row.strategy_key, row])
  );
  const latestLanePolicyReview = (lanePolicyReviewResult.data ?? null) as LanePolicyReviewRow | null;
  const candidatePolicyRows = (candidatePoliciesResult.data ?? []) as CandidatePolicyRow[];
  const candidatePolicyMap = new Map(
    candidatePolicyRows.map((row) => [`${row.label}::${row.regime}`, row])
  );
  const btcSparklineValues = btcHours.map((hour) => btcHourly.get(hour) ?? 0).filter((value) => value > 0);
  const btcSparklinePath = sparklinePath(btcSparklineValues, 560, 120);
  const lanePanels = [
    {
      key: "xrp_shadow_short_core",
      label: "XRP core short",
      pnl: shadowXrpCorePnl,
      closed: shadowXrpCoreClosed.length,
      open: shadowXrpCoreOpen.length,
      actualState: lanePolicyStateFromRow(lanePolicyMap.get("xrp_shadow_short_core"))
    },
    {
      key: "xrp_shadow_short_bull_fade_canary",
      label: "XRP bull fade canary",
      pnl: shadowXrpBullFadePnl,
      closed: shadowXrpBullFadeClosed.length,
      open: shadowXrpBullFadeOpen.length,
      actualState: lanePolicyStateFromRow(lanePolicyMap.get("xrp_shadow_short_bull_fade_canary"))
    },
    {
      key: "avax_shadow_short_canary",
      label: "AVAX canary short",
      pnl: shadowAvaxPnl,
      closed: shadowAvaxClosed.length,
      open: shadowAvaxOpen.length,
      actualState: lanePolicyStateFromRow(lanePolicyMap.get("avax_shadow_short_canary"))
    },
    {
      key: "sol_shadow_short_soft_bear_laggard",
      label: "SOL soft-bear laggard",
      pnl: shadowSolSoftBearPnl,
      closed: shadowSolSoftBearClosed.length,
      open: shadowSolSoftBearOpen.length,
      actualState: lanePolicyStateFromRow(lanePolicyMap.get("sol_shadow_short_soft_bear_laggard"))
    },
    {
      key: "sol_shadow_short_deep_bear_continuation",
      label: "SOL deep-bear continuation",
      pnl: shadowSolDeepBearPnl,
      closed: shadowSolDeepBearClosed.length,
      open: shadowSolDeepBearOpen.length,
      actualState: lanePolicyStateFromRow(lanePolicyMap.get("sol_shadow_short_deep_bear_continuation"))
    }
  ];

  const byExchange = new Map<string, ExchangeStats>();
  for (const row of positions30d) {
    const exchange = formatExchange(row.meta);
    const current = byExchange.get(exchange) ?? {
      exchange,
      closedCount: 0,
      openCount: 0,
      pnl24h: 0,
      pnl7d: 0
    };
    if (row.status === "open") current.openCount += 1;
    if (row.status === "closed") {
      const pnl = asNumber(row.realized_pnl_usd);
      current.closedCount += 1;
      if (row.exit_ts && row.exit_ts >= since24h) current.pnl24h += pnl;
      if (row.exit_ts && row.exit_ts >= since7d) current.pnl7d += pnl;
    }
    byExchange.set(exchange, current);
  }
  const exchangeStats = Array.from(byExchange.values())
    .sort((a, b) => b.pnl7d - a.pnl7d)
    .slice(0, 6);


  const lanePnlScale = Math.max(1, ...lanePanels.map((lane) => Math.abs(lane.pnl)));
  const displayRecommendations = (latestLanePolicyReview?.recommendations ?? [])
    .map((row) => {
      const liveState = lanePolicyStateFromRow(lanePolicyMap.get(row.strategy_key));
      return { ...row, current_state: liveState };
    })
    .filter((row) => row.current_state !== row.recommended_state);

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header>
          <section className="cockpit-shell overflow-hidden rounded-[28px] border border-brand-300/15 bg-brand-700/60 p-5 shadow-2xl shadow-black/20 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.38em] text-brand-300/80">Arbiter cockpit</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Sarokszámok és folyamatok</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <form action={signOutAction}>
                  <button className="btn btn-ghost" type="submit">
                    Kilépés
                  </button>
                </form>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className={pnlCardClass(pnl24h)}>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">24h PnL</p>
                  <p className={`mt-2 ${pnlValueClass(pnl24h)}`}>{usd(pnl24h)}</p>
                  <p className="mt-2 text-sm text-brand-100/70">{closed24h.length} zárás, {opened24h.length} nyitás</p>
                </div>
              </div>
              <div className={pnlCardClass(pnl7d)}>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">7d PnL</p>
                  <p className={`mt-2 ${pnlValueClass(pnl7d)}`}>{usd(pnl7d)}</p>
                  <p className="mt-2 text-sm text-brand-100/70">{closed7d.length} zárás, {opened7d.length} nyitás</p>
                </div>
              </div>
              <div className={pnlCardClass(pnl30d)}>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">30d PnL</p>
                  <p className={`mt-2 ${pnlValueClass(pnl30d)}`}>{usd(pnl30d)}</p>
                  <p className="mt-2 text-sm text-brand-100/70">Összes zárt trade a 30 napos ablakban</p>
                </div>
                <div className="mt-4 flex items-end justify-between text-sm text-brand-100/70">
                  <span>Nyitott: {openPositions.length}</span>
                  <span>Zárt: {closed30d.length}</span>
                </div>
              </div>
              <div className={pnlCardClass(absoluteProfitUsd)}>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">Összesített eredmény</p>
                  <p className={`mt-2 ${pnlValueClass(absoluteProfitUsd)}`}>{usd(absoluteProfitUsd)}</p>
                  <p className="mt-2 text-sm text-brand-100/70">Paper egyenleg a 10,000 USD induló tőkéhez képest</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[24px] border border-brand-300/10 bg-brand-900/35 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">Exchange profit panel</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {exchangeStats.length > 0 ? exchangeStats.map((row) => (
                    <div key={row.exchange} className={`rounded-2xl border px-3 py-3 ${toneSurfaceClass(row.pnl7d)}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{row.exchange}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.22em] text-brand-100/45">
                            {row.closedCount} zárt · {row.openCount} nyitott
                          </p>
                        </div>
                        <p className={`text-sm font-semibold ${toneClass(row.pnl7d)}`}>{usd(row.pnl7d)}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-brand-100/65">
                        <div>
                          <p>24h</p>
                          <p className={`mt-1 font-semibold ${toneClass(row.pnl24h)}`}>{usd(row.pnl24h)}</p>
                        </div>
                        <div>
                          <p>7d</p>
                          <p className={`mt-1 font-semibold ${toneClass(row.pnl7d)}`}>{usd(row.pnl7d)}</p>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <p className="text-sm text-brand-100/60">Nincs exchange szintű PnL minta.</p>
                  )}
                </div>
              </div>

              <div className="capital-dial-card">
                <div className="capital-dial" style={{ ["--dial-deg" as string]: `${capitalDial}deg` }}>
                  <div className="capital-dial__inner">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-brand-100/55">Lekötött</p>
                    <p className="mt-2 text-3xl font-semibold text-white">{reserveRatio.toFixed(1)}%</p>
                    <p className="mt-1 text-sm text-brand-100/65">{compactUsd(reservedUsd)}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 px-3 py-3">
                    <p className="text-brand-100/55">Szabad tőke</p>
                    <p className="mt-1 font-semibold text-emerald-200">{compactUsd(availableUsd)}</p>
                  </div>
                  <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 px-3 py-3">
                    <p className="text-brand-100/55">Futó pozik</p>
                    <p className="mt-1 font-semibold text-white">{openPositions.length}</p>
                  </div>
                  <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 px-3 py-3">
                    <p className="text-brand-100/55">Min kötés</p>
                    <p className="mt-1 font-semibold text-white">{compactUsd(asNumber(paperAccountResult.data?.min_notional_usd ?? 100))}</p>
                  </div>
                  <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 px-3 py-3">
                    <p className="text-brand-100/55">Max kötés</p>
                    <p className="mt-1 font-semibold text-white">{compactUsd(asNumber(paperAccountResult.data?.max_notional_usd ?? 500))}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </header>

        <section className="space-y-4">
          <div className="card space-y-4">
            <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.24em] text-brand-100/55">Shadow flight panel</p>
                  <p className="mt-1 text-lg font-semibold text-white">BTC regime: {latestBtcRegimeLabel}</p>
                </div>
                <div className={`shrink-0 rounded-full border px-3 py-1 text-sm ${regimeTone}`}>
                  {latestBtcHour ? `${latestBtcMomentum.toFixed(1)} bps` : "nincs BTC minta"}
                </div>
              </div>
              <div className="mt-4 overflow-hidden rounded-[24px] border border-brand-300/10 bg-brand-950/40 p-3 sm:p-4">
                <div className="grid min-w-0 gap-4 xl:grid-cols-[1.35fr_0.65fr]">
                  <div className="min-w-0 rounded-[20px] border border-brand-300/10 bg-brand-900/45 p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.24em] text-brand-100/55">BTC motion</p>
                        <p className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{latestBtcRegimeLabel}</p>
                        <p className="mt-2 text-sm text-brand-100/65">
                          Aktuális 6h BTC mozgás: <span className={toneClass(latestBtcMomentum)}>{latestBtcMomentum.toFixed(1)} bps</span>
                        </p>
                      </div>
                      <div className={`shrink-0 rounded-2xl border px-3 py-2 text-right sm:px-4 sm:py-3 ${regimeTone}`}>
                        <p className="text-[11px] uppercase tracking-[0.24em]">regime bias</p>
                        <p className="mt-1 text-xl font-semibold sm:text-2xl">{latestBtcMomentum > 0 ? "Bull" : latestBtcMomentum < 0 ? "Bear" : "Flat"}</p>
                      </div>
                    </div>
                    <div className="mt-4 overflow-hidden rounded-2xl border border-brand-300/10 bg-brand-950/50 p-2 sm:p-3">
                      <svg viewBox="0 0 560 140" className="block h-28 w-full sm:h-36" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="btcFlightStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor={latestBtcMomentum < 0 ? "#6ee7b7" : "#fbbf24"} />
                            <stop offset="50%" stopColor={latestBtcMomentum < 0 ? "#67e8f9" : "#fb923c"} />
                            <stop offset="100%" stopColor={latestBtcMomentum < 0 ? "#93c5fd" : "#f87171"} />
                          </linearGradient>
                        </defs>
                        <path d="M 0 28 H 560" stroke="rgba(148,163,184,0.08)" strokeWidth="1" fill="none" />
                        <path d="M 0 74 H 560" stroke="rgba(148,163,184,0.12)" strokeWidth="1" fill="none" />
                        <path d="M 0 120 H 560" stroke="rgba(148,163,184,0.2)" strokeWidth="1" fill="none" />
                        <path d="M 140 0 V 140" stroke="rgba(148,163,184,0.08)" strokeWidth="1" fill="none" />
                        <path d="M 280 0 V 140" stroke="rgba(148,163,184,0.08)" strokeWidth="1" fill="none" />
                        <path d="M 420 0 V 140" stroke="rgba(148,163,184,0.08)" strokeWidth="1" fill="none" />
                        {btcSparklinePath ? (
                          <path
                            d={btcSparklinePath}
                            fill="none"
                            stroke="url(#btcFlightStroke)"
                            strokeWidth="5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ) : null}
                        {btcSparklineValues.length > 0 ? (
                          <>
                            <circle
                              cx="0"
                              cy={(140 - ((btcSparklineValues[0] - Math.min(...btcSparklineValues)) / ((Math.max(...btcSparklineValues) - Math.min(...btcSparklineValues)) || 1)) * 120).toFixed(2)}
                              r="4"
                              fill="rgba(255,255,255,0.7)"
                            />
                            <circle
                              cx="560"
                              cy={(140 - ((btcSparklineValues[btcSparklineValues.length - 1] - Math.min(...btcSparklineValues)) / ((Math.max(...btcSparklineValues) - Math.min(...btcSparklineValues)) || 1)) * 120).toFixed(2)}
                              r="5"
                              fill={latestBtcMomentum < 0 ? "#6ee7b7" : "#fbbf24"}
                            />
                          </>
                        ) : null}
                      </svg>
                      <div className="mt-2 flex items-center justify-between text-xs uppercase tracking-[0.22em] text-brand-100/45">
                        <span>6h ago</span>
                        <span>midpoint</span>
                        <span>now</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid min-w-0 gap-3">
                    {lanePanels.map((lane) => (
                      <div key={lane.label} className={`rounded-[20px] border p-4 ${toneSurfaceClass(lane.pnl)}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.24em] text-brand-100/55">{lane.label}</p>
                            <p className={`mt-2 text-2xl font-semibold ${toneClass(lane.pnl)}`}>{usd(lane.pnl)}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <div className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.22em] ${policyToneClass(lane.actualState)}`}>
                              {stateLabel(lane.actualState)}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm text-brand-100/65">
                          <span>{lane.closed} zárt</span>
                          <span>{lane.open} nyitott</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-brand-300/10 bg-brand-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-brand-100/45">Lane performance</p>
                <div className="mt-4 space-y-3">
                {lanePanels.map((lane) => (
                  <div key={`perf-${lane.key}`} className="rounded-xl border border-brand-300/10 bg-brand-900/30 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.22em] text-brand-100/45">{lane.label}</p>
                        <div className="mt-1 flex items-center gap-3">
                          <p className={`text-lg font-semibold ${toneClass(lane.pnl)}`}>{usd(lane.pnl)}</p>
                          <p className="text-xs text-brand-100/55">{lane.closed} zárt · {lane.open} nyitott</p>
                        </div>
                      </div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs uppercase tracking-[0.22em] ${policyToneClass(lane.actualState)}`}>
                        {stateLabel(lane.actualState)}
                      </span>
                    </div>
                    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-brand-100/10">
                      <div
                        className={`h-full rounded-full ${lane.pnl >= 0 ? "bg-emerald-300" : "bg-rose-300"}`}
                        style={{ width: `${Math.max(8, (Math.abs(lane.pnl) / lanePnlScale) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                </div>
              </div>
              <div className="mt-3 rounded-2xl border border-brand-300/10 bg-brand-900/45 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-brand-100/55">AI lane policy review</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="rounded-full border border-brand-300/10 bg-brand-900/50 px-3 py-1 text-xs uppercase tracking-[0.22em] text-brand-100/60">
                      {latestLanePolicyReview
                        ? latestLanePolicyReview.used_ai
                          ? "AI javaslat"
                          : "Szabály alapú javaslat"
                        : "nincs review"}
                    </div>
                    <ApplyLanePolicyButton disabled={!latestLanePolicyReview || displayRecommendations.length === 0} />
                  </div>
                </div>
                {latestLanePolicyReview ? (
                  <>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-brand-300/10 bg-brand-950/40 px-3 py-3">
                        <p className="text-brand-100/55">Utolsó elemzés</p>
                        <p className="mt-1 text-sm font-semibold text-white">{formatTs(latestLanePolicyReview.created_at)}</p>
                      </div>
                      <div className="rounded-2xl border border-brand-300/10 bg-brand-950/40 px-3 py-3">
                        <p className="text-brand-100/55">Mostani piaci helyzet</p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {regimeHumanLabel(latestLanePolicyReview.current_btc_regime)}
                        </p>
                        <p className="mt-1 text-xs text-brand-100/55">
                          BTC 6 órás mozgás: {asNumber(latestLanePolicyReview.current_btc_momentum_6h_bps).toFixed(1)} bps
                        </p>
                      </div>
                      <div className="rounded-2xl border border-brand-300/10 bg-brand-950/40 px-3 py-3">
                        <p className="text-brand-100/55">Összes alkalmazás hatása</p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {applyImpactSummary(displayRecommendations)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 xl:grid-cols-2">
                      {displayRecommendations.map((row) => (
                        <div key={row.strategy_key} className="rounded-2xl border border-brand-300/10 bg-brand-950/40 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{row.label}</p>
                              <p className="mt-1 text-sm text-brand-100/65">
                                Most: {stateLabel(row.current_state)}. Javaslat: {stateLabel(row.recommended_state)}.
                              </p>
                            </div>
                            <div className="text-right">
                              <div className={`inline-flex rounded-full border px-2.5 py-1 text-xs uppercase tracking-[0.22em] ${policyToneClass(row.current_state)}`}>
                                most: {stateLabel(row.current_state)}
                              </div>
                              <div className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs uppercase tracking-[0.22em] ${policyToneClass(row.recommended_state)}`}>
                                javaslat: {stateLabel(row.recommended_state)}
                              </div>
                            </div>
                          </div>
                          <p className="mt-3 text-sm text-brand-100/75">
                            {humanRecommendationReason(row.reason, row.recommended_state)}
                          </p>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div>
                              {row.recommended_state === "active" ? (
                                <>
                                  <p className="text-xs uppercase tracking-[0.18em] text-brand-100/50">Aktiválás ereje</p>
                                  <div className="mt-2 flex items-center gap-1.5">
                                    {Array.from({ length: 5 }).map((_, index) => {
                                      const active = index < recommendationStrength(row.confidence).bars;
                                      return (
                                        <span
                                          key={`${row.strategy_key}-bar-${index}`}
                                          className={`h-2.5 w-6 rounded-full ${active ? recommendationStrengthColor(row.confidence) : "bg-brand-100/10"}`}
                                        />
                                      );
                                    })}
                                  </div>
                                  <p className="mt-1 text-xs text-brand-100/55">{recommendationStrength(row.confidence).label}</p>
                                </>
                              ) : (
                                <p className="text-xs text-brand-100/55">Ehhez a javaslathoz nem kell erősségjelző, mert nem aktivál kereskedést.</p>
                              )}
                            </div>
                            <ApplyLanePolicyButton
                              compact
                              strategyKey={row.strategy_key}
                              disabled={row.current_state === row.recommended_state}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    {displayRecommendations.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-brand-300/10 bg-brand-950/40 px-4 py-4 text-sm text-brand-100/65">
                        Nincs függő AI ajánlás. Ami változatlan vagy már alkalmazva lett, azt a felület nem mutatja.
                      </div>
                    ) : null}
                    {(latestLanePolicyReview.summary?.candidate_policies?.length ?? 0) > 0 ? (
                      <div className="mt-4 rounded-2xl border border-brand-300/10 bg-brand-950/40 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-brand-100/45">Következő policy-jelöltek</p>
                            <p className="mt-1 text-sm text-brand-100/65">Ha a meglévő lane-ek nem elég jók ebben a rezsimben, innen érdemes továbbfejleszteni.</p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 xl:grid-cols-3">
                          {latestLanePolicyReview.summary?.candidate_policies?.map((candidate) => (
                            <div key={`${candidate.symbol}-${candidate.label}`} className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-4">
                              {(() => {
                                const saved = candidatePolicyMap.get(`${candidate.label}::${candidate.regime}`);
                                return (
                                  <>
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-white">{candidate.label}</p>
                                  <div className="mt-2 flex items-center gap-2">
                                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs uppercase tracking-[0.22em] ${candidate.priority === "high" ? "border-amber-300/20 bg-amber-500/10 text-amber-100" : "border-sky-300/20 bg-sky-500/10 text-sky-100"}`}>
                                      {candidate.priority === "high" ? "fontos" : "figyelni"}
                                    </span>
                                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs uppercase tracking-[0.22em] ${candidateStatusTone(saved?.status)}`}>
                                      {candidateStatusLabel(saved?.status)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <p className="mt-2 text-sm text-brand-100/75">{candidate.why}</p>
                              <div className="mt-3 flex items-center gap-3 text-xs text-brand-100/60">
                                <span>{candidate.trade_count} minta</span>
                                <span className={toneClass(candidate.pnl_30d_usd)}>{usd(candidate.pnl_30d_usd)}</span>
                                <span className={toneClass(candidate.expectancy_30d_usd)}>
                                  átlag {usd(candidate.expectancy_30d_usd)}
                                </span>
                              </div>
                              <div className="mt-3 rounded-xl border border-brand-300/10 bg-brand-950/50 px-3 py-2 text-xs text-brand-100/60">
                                {candidate.rule_hint}
                              </div>
                              {saved?.id ? (
                                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                                  {saved.status !== "validated" ? (
                                    <CandidatePolicyStatusButton id={saved.id} nextStatus="validated" label="Validált" compact />
                                  ) : null}
                                  {saved.status !== "canary" ? (
                                    <CandidatePolicyStatusButton id={saved.id} nextStatus="canary" label="Canary" compact />
                                  ) : null}
                                  {saved.status !== "rejected" ? (
                                    <CandidatePolicyStatusButton id={saved.id} nextStatus="rejected" label="Elvetem" compact />
                                  ) : null}
                                </div>
                              ) : null}
                                  </>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-brand-100/60">Még nincs lane policy review futás.</p>
                )}
              </div>
            </div>
          </div>

        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-brand-300/80">Nyitott pozíciók</p>
                <h2 className="mt-1 text-2xl font-semibold">Élő lekötések</h2>
              </div>
              <div className="rounded-full border border-brand-300/15 px-3 py-1 text-sm text-brand-100/70">{openPositions.length} open</div>
            </div>
            <div className="mt-5 space-y-3">
              {openPositions.length > 0 ? openPositions.map((row) => {
                const direction = String(row.meta?.direction ?? (asNumber(row.spot_qty) >= 0 ? "long" : "short"));
                const notional = asNumber(row.meta?.notional_usd ?? Math.abs(asNumber(row.spot_qty) * asNumber(row.entry_spot_price)));
                return (
                  <div key={row.id} className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-white">{row.symbol}</p>
                        <p className="text-xs uppercase tracking-[0.22em] text-brand-100/50">{direction} · {formatExchange(row.meta)}</p>
                      </div>
                      <div className="text-right text-sm text-brand-100/70">
                        <p>{compactUsd(notional)}</p>
                        <p>{formatAgeMinutes(row.entry_ts)}</p>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-5 text-sm text-brand-100/65">
                  Jelenleg nincs nyitott pozi. Ezt főleg a lekötött vs elérhető tőkéből is látod, de itt külön is tisztán megvan.
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-brand-300/80">Friss zárások</p>
                <h2 className="mt-1 text-2xl font-semibold">Legutóbbi lezárt trade-ek</h2>
              </div>
              <p className="text-xs text-brand-100/60">Legutolsó 10 zárás</p>
            </div>
            <div className="mt-4 space-y-2.5">
              {recentClosed.slice(0, 10).length > 0 ? recentClosed.slice(0, 10).map((row) => {
                const direction = String(row.meta?.direction ?? (asNumber(row.spot_qty) >= 0 ? "long" : "short"));
                const pnl = asNumber(row.realized_pnl_usd);
                return (
                  <div key={row.id} className={`rounded-xl border px-4 py-3 ${toneSurfaceClass(pnl)}`}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <p className="text-base font-semibold text-white">{row.symbol}</p>
                          <p className="truncate text-xs uppercase tracking-[0.18em] text-brand-100/50">
                            {direction} · {formatExchange(row.meta)}
                          </p>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-100/60">
                          <span>Be: {formatCompactTs(row.entry_ts)}</span>
                          <span>Ki: {formatCompactTs(row.exit_ts)}</span>
                          <span>Spread: {asNumber(row.meta?.spread_bps).toFixed(1)} bps</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-xl font-semibold ${toneClass(pnl)}`}>{usd(pnl)}</p>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-5 text-sm text-brand-100/65">
                  Még nincs friss lezárás.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
