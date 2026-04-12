import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";
import {
  buildStrategySettingsMap,
  lanePolicyStateFromSettingsMap,
  laneStateAllowsDetection
} from "@/server/lanes/policy";
import { laneAllowsDetectionByRegime, regimeFromBtcMomentum6hBps, type BtcRegime } from "@/server/lanes/regimePolicy";

// We only need enough history to compute the 6h/2h momentum windows plus a small safety margin.
const LOOKBACK_HOURS = 8;
const IDEMPOTENT_MINUTES = 10;
const EXCHANGE = "coinbase";
const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD", "LINKUSD", "AVAXUSD", "LTCUSD", "DOTUSD", "BCHUSD"];
const RELATIVE_STRENGTH_ALLOWLIST = new Set(["XRPUSD", "AVAXUSD", "SOLUSD"]);
const RELATIVE_STRENGTH_DENYLIST = new Set(["LTCUSD", "DOTUSD", "BCHUSD"]);
const XRP_SHORT_MIN_BTC_MOMENTUM_6H_BPS = -75;
const XRP_SHORT_MAX_BTC_MOMENTUM_6H_BPS = 0;
const XRP_SHORT_MAX_ALT_MOMENTUM_2H_BPS = 25;
const XRP_SHORT_MIN_SPREAD_BPS = 0;
const XRP_SHORT_MAX_SPREAD_BPS = 40;
const XRP_BULL_FADE_MIN_BTC_MOMENTUM_6H_BPS = 100;
const XRP_BULL_FADE_MAX_SPREAD_BPS = -50;
const XRP_BULL_FADE_MIN_ALT_MOMENTUM_2H_BPS = 25;
// Restrict AVAX short lane to bear regimes only (btc < 0).
const AVAX_SHORT_MIN_BTC_MOMENTUM_6H_BPS = -250;
const AVAX_SHORT_MIN_SPREAD_BPS = 50;
const AVAX_SHORT_MAX_BTC_MOMENTUM_6H_BPS = 0;
const AVAX_SHORT_LOSSY_MAX_SPREAD_BPS = 80;
const SOL_SOFT_BEAR_MIN_BTC_MOMENTUM_6H_BPS = -50;
const SOL_SOFT_BEAR_MAX_BTC_MOMENTUM_6H_BPS = 0;
const SOL_SOFT_BEAR_MIN_ALT_MOMENTUM_6H_BPS = -100;
const SOL_SOFT_BEAR_MAX_ALT_MOMENTUM_2H_BPS = 25;
const SOL_SOFT_BEAR_MAX_SPREAD_BPS = -25;
const SOL_DEEP_BEAR_MIN_BTC_MOMENTUM_6H_BPS = -200;
const SOL_DEEP_BEAR_MAX_BTC_MOMENTUM_6H_BPS = -100;
const SOL_DEEP_BEAR_MAX_ALT_MOMENTUM_6H_BPS = -100;
const SOL_DEEP_BEAR_MAX_ALT_MOMENTUM_2H_BPS = -25;
const SOL_DEEP_BEAR_MIN_SPREAD_BPS = -25;
// New base lane: "SOL soft-bull reversal probe" (was a candidate lane, now promoted to a basic lane).
const SOL_SOFT_BULL_MIN_BTC_MOMENTUM_6H_BPS = 0;
const SOL_SOFT_BULL_MAX_BTC_MOMENTUM_6H_BPS = 150;
const SOL_SOFT_BULL_MIN_ALT_MOMENTUM_6H_BPS = -30;
const SOL_SOFT_BULL_MAX_ALT_MOMENTUM_6H_BPS = 100;
const SOL_SOFT_BULL_MIN_ALT_MOMENTUM_2H_BPS = 25;
const SOL_SOFT_BULL_MIN_SPREAD_BPS = -10;
const SOL_SOFT_BULL_MAX_SPREAD_BPS = 20;
const ENTRY_LOOKBACK_HOURS = 6;
const EXIT_LOOKBACK_HOURS = 2;
const MAX_EXIT_SPREAD_BPS = 25;
const MIN_CONFIDENCE = 0.58;
const MAX_SIGNALS = 4;
const RELATIVE_STRENGTH_PARENT_KEY = "relative_strength";

type RelativeStrengthLane = {
  key: string;
  symbol: string;
  direction: "long" | "short";
  variant: string;
  holdSeconds: number;
  evaluate: (args: {
    spreadBps: number;
    momentum6hBps: number;
    momentum2hBps: number;
    btcMomentum6hBps: number | null;
  }) => string | null;
  details: (args: {
    spreadBps: number;
    momentum6hBps: number;
    momentum2hBps: number;
    btcMomentum6hBps: number | null;
  }) => Record<string, number | string | null>;
};

type CandidateRuleConfig = {
  symbol?: string;
  direction?: "long" | "short";
  hold_seconds?: number;
  min_btc_6h_bps?: number;
  max_btc_6h_bps?: number;
  min_alt_6h_bps?: number;
  max_alt_6h_bps?: number;
  min_alt_2h_bps?: number;
  max_alt_2h_bps?: number;
  min_spread_bps?: number;
  max_spread_bps?: number;
};

type SnapshotRow = {
  ts: string;
  exchange: string;
  symbol: string;
  spot_bid: number | null;
  spot_ask: number | null;
};

async function fetchSnapshots(
  adminSupabase: NonNullable<ReturnType<typeof createAdminSupabase>>,
  since: string
) {
  const rows: SnapshotRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await adminSupabase
      .from("market_snapshots")
      .select("ts, exchange, symbol, spot_bid, spot_ask")
      .eq("exchange", EXCHANGE)
      .in("symbol", SYMBOLS)
      .gte("ts", since)
      .order("ts", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as SnapshotRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export type DetectRelativeStrengthResult = {
  inserted: number;
  skipped: number;
  snapshot_rows_read?: number;
  skip_reasons: Record<string, number>;
  near_miss_samples: Array<{
    symbol: string;
    spread_bps: number;
    momentum_6h_bps: number;
    basket_mean_bps: number;
    reason: string;
  }>;
};

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function bucketHour(ts: string) {
  return new Date(Math.floor(Date.parse(ts) / (60 * 60 * 1000)) * 60 * 60 * 1000).toISOString();
}

const RELATIVE_STRENGTH_LANES: RelativeStrengthLane[] = [
  {
    key: "xrp_short",
    symbol: "XRPUSD",
    direction: "short",
    variant: "xrp_shadow_short_core",
    holdSeconds: 4 * 60 * 60,
    evaluate: ({ btcMomentum6hBps, spreadBps, momentum2hBps }) => {
      if (!(btcMomentum6hBps !== null && btcMomentum6hBps < XRP_SHORT_MAX_BTC_MOMENTUM_6H_BPS)) return "btc_filter_blocked";
      if (
        !(btcMomentum6hBps >= XRP_SHORT_MIN_BTC_MOMENTUM_6H_BPS) ||
        !(spreadBps >= XRP_SHORT_MIN_SPREAD_BPS) ||
        !(spreadBps < XRP_SHORT_MAX_SPREAD_BPS) ||
        !(momentum2hBps <= XRP_SHORT_MAX_ALT_MOMENTUM_2H_BPS)
      ) return "xrp_short_filter_blocked";
      return null;
    },
    details: ({ btcMomentum6hBps }) => ({
      xrp_short_min_btc_momentum_6h_bps: XRP_SHORT_MIN_BTC_MOMENTUM_6H_BPS,
      xrp_short_max_btc_momentum_6h_bps: XRP_SHORT_MAX_BTC_MOMENTUM_6H_BPS,
      xrp_short_min_spread_bps: XRP_SHORT_MIN_SPREAD_BPS,
      xrp_short_max_spread_bps: XRP_SHORT_MAX_SPREAD_BPS,
      xrp_short_max_alt_momentum_2h_bps: XRP_SHORT_MAX_ALT_MOMENTUM_2H_BPS,
      btc_momentum_6h_bps: btcMomentum6hBps
    })
  },
  {
    key: "xrp_bull_fade_short",
    symbol: "XRPUSD",
    direction: "short",
    variant: "xrp_shadow_short_bull_fade_canary",
    holdSeconds: 4 * 60 * 60,
    evaluate: ({ btcMomentum6hBps, spreadBps, momentum2hBps }) => {
      if (!(btcMomentum6hBps !== null && btcMomentum6hBps >= XRP_BULL_FADE_MIN_BTC_MOMENTUM_6H_BPS)) {
        return "btc_filter_blocked";
      }
      if (!(spreadBps <= XRP_BULL_FADE_MAX_SPREAD_BPS) || !(momentum2hBps > XRP_BULL_FADE_MIN_ALT_MOMENTUM_2H_BPS)) {
        return "xrp_bull_fade_filter_blocked";
      }
      return null;
    },
    details: ({ btcMomentum6hBps }) => ({
      xrp_bull_fade_min_btc_momentum_6h_bps: XRP_BULL_FADE_MIN_BTC_MOMENTUM_6H_BPS,
      xrp_bull_fade_max_spread_bps: XRP_BULL_FADE_MAX_SPREAD_BPS,
      xrp_bull_fade_min_alt_momentum_2h_bps: XRP_BULL_FADE_MIN_ALT_MOMENTUM_2H_BPS,
      btc_momentum_6h_bps: btcMomentum6hBps
    })
  },
  {
    key: "avax_short",
    symbol: "AVAXUSD",
    direction: "short",
    variant: "avax_shadow_short_canary",
    holdSeconds: 4 * 60 * 60,
    evaluate: ({ btcMomentum6hBps, spreadBps, momentum2hBps }) => {
      // Prevent this AVAX short lane from firing in bull regimes (it caused consistent losses in btc_pos).
      if (!(btcMomentum6hBps !== null && btcMomentum6hBps < AVAX_SHORT_MAX_BTC_MOMENTUM_6H_BPS)) return "btc_filter_blocked";
      if (
        !(btcMomentum6hBps >= AVAX_SHORT_MIN_BTC_MOMENTUM_6H_BPS) ||
        !(btcMomentum6hBps < AVAX_SHORT_MAX_BTC_MOMENTUM_6H_BPS) ||
        !(spreadBps >= AVAX_SHORT_MIN_SPREAD_BPS)
      ) {
        return "avax_short_filter_blocked";
      }
      if (momentum2hBps > 0 && spreadBps < AVAX_SHORT_LOSSY_MAX_SPREAD_BPS) return "avax_short_lossy_bucket_blocked";
      if (!(spreadBps >= 0)) return "direction_blocked";
      return null;
    },
    details: ({ btcMomentum6hBps }) => ({
      avax_short_min_btc_momentum_6h_bps: AVAX_SHORT_MIN_BTC_MOMENTUM_6H_BPS,
      avax_short_max_btc_momentum_6h_bps: AVAX_SHORT_MAX_BTC_MOMENTUM_6H_BPS,
      avax_short_min_spread_bps: AVAX_SHORT_MIN_SPREAD_BPS,
      avax_short_lossy_max_spread_bps: AVAX_SHORT_LOSSY_MAX_SPREAD_BPS,
      btc_momentum_6h_bps: btcMomentum6hBps
    })
  },
  {
    key: "sol_soft_bear_short",
    symbol: "SOLUSD",
    direction: "short",
    variant: "sol_shadow_short_soft_bear_laggard",
    holdSeconds: 4 * 60 * 60,
    evaluate: ({ btcMomentum6hBps, spreadBps, momentum6hBps, momentum2hBps }) => {
      if (
        !(btcMomentum6hBps !== null && btcMomentum6hBps >= SOL_SOFT_BEAR_MIN_BTC_MOMENTUM_6H_BPS && btcMomentum6hBps < SOL_SOFT_BEAR_MAX_BTC_MOMENTUM_6H_BPS) ||
        !(momentum6hBps > SOL_SOFT_BEAR_MIN_ALT_MOMENTUM_6H_BPS) ||
        !(momentum2hBps < SOL_SOFT_BEAR_MAX_ALT_MOMENTUM_2H_BPS) ||
        !(spreadBps < SOL_SOFT_BEAR_MAX_SPREAD_BPS)
      ) {
        return "sol_soft_bear_filter_blocked";
      }
      return null;
    },
    details: ({ btcMomentum6hBps }) => ({
      sol_soft_bear_min_btc_momentum_6h_bps: SOL_SOFT_BEAR_MIN_BTC_MOMENTUM_6H_BPS,
      sol_soft_bear_max_btc_momentum_6h_bps: SOL_SOFT_BEAR_MAX_BTC_MOMENTUM_6H_BPS,
      sol_soft_bear_min_alt_momentum_6h_bps: SOL_SOFT_BEAR_MIN_ALT_MOMENTUM_6H_BPS,
      sol_soft_bear_max_alt_momentum_2h_bps: SOL_SOFT_BEAR_MAX_ALT_MOMENTUM_2H_BPS,
      sol_soft_bear_max_spread_bps: SOL_SOFT_BEAR_MAX_SPREAD_BPS,
      btc_momentum_6h_bps: btcMomentum6hBps
    })
  },
  {
    key: "sol_deep_bear_short",
    symbol: "SOLUSD",
    direction: "short",
    variant: "sol_shadow_short_deep_bear_continuation",
    holdSeconds: 4 * 60 * 60,
    evaluate: ({ btcMomentum6hBps, spreadBps, momentum6hBps, momentum2hBps }) => {
      if (
        !(btcMomentum6hBps !== null && btcMomentum6hBps >= SOL_DEEP_BEAR_MIN_BTC_MOMENTUM_6H_BPS && btcMomentum6hBps < SOL_DEEP_BEAR_MAX_BTC_MOMENTUM_6H_BPS) ||
        !(momentum6hBps <= SOL_DEEP_BEAR_MAX_ALT_MOMENTUM_6H_BPS) ||
        !(momentum2hBps <= SOL_DEEP_BEAR_MAX_ALT_MOMENTUM_2H_BPS) ||
        !(spreadBps >= SOL_DEEP_BEAR_MIN_SPREAD_BPS)
      ) {
        return "sol_deep_bear_filter_blocked";
      }
      return null;
    },
    details: ({ btcMomentum6hBps }) => ({
      sol_deep_bear_min_btc_momentum_6h_bps: SOL_DEEP_BEAR_MIN_BTC_MOMENTUM_6H_BPS,
      sol_deep_bear_max_btc_momentum_6h_bps: SOL_DEEP_BEAR_MAX_BTC_MOMENTUM_6H_BPS,
      sol_deep_bear_max_alt_momentum_6h_bps: SOL_DEEP_BEAR_MAX_ALT_MOMENTUM_6H_BPS,
      sol_deep_bear_max_alt_momentum_2h_bps: SOL_DEEP_BEAR_MAX_ALT_MOMENTUM_2H_BPS,
      sol_deep_bear_min_spread_bps: SOL_DEEP_BEAR_MIN_SPREAD_BPS,
      btc_momentum_6h_bps: btcMomentum6hBps
    })
  }
  ,
  {
    key: "sol_soft_bull_reversal_probe",
    symbol: "SOLUSD",
    direction: "short",
    variant: "sol_shadow_short_soft_bull_reversal_probe",
    holdSeconds: 90 * 60,
    evaluate: ({ btcMomentum6hBps, spreadBps, momentum6hBps, momentum2hBps }) => {
      if (
        !(btcMomentum6hBps !== null && btcMomentum6hBps >= SOL_SOFT_BULL_MIN_BTC_MOMENTUM_6H_BPS && btcMomentum6hBps < SOL_SOFT_BULL_MAX_BTC_MOMENTUM_6H_BPS)
      ) {
        return "btc_filter_blocked";
      }
      // Keep this lane in a genuinely mild soft-bull reversal bucket.
      if (!(momentum6hBps >= SOL_SOFT_BULL_MIN_ALT_MOMENTUM_6H_BPS)) return "sol_soft_bull_filter_blocked";
      if (!(momentum6hBps < SOL_SOFT_BULL_MAX_ALT_MOMENTUM_6H_BPS)) return "sol_soft_bull_filter_blocked";
      if (!(momentum2hBps >= SOL_SOFT_BULL_MIN_ALT_MOMENTUM_2H_BPS)) return "sol_soft_bull_filter_blocked";
      if (!(spreadBps >= SOL_SOFT_BULL_MIN_SPREAD_BPS && spreadBps < SOL_SOFT_BULL_MAX_SPREAD_BPS)) return "sol_soft_bull_filter_blocked";
      return null;
    },
    details: ({ btcMomentum6hBps }) => ({
      sol_soft_bull_min_btc_momentum_6h_bps: SOL_SOFT_BULL_MIN_BTC_MOMENTUM_6H_BPS,
      sol_soft_bull_max_btc_momentum_6h_bps: SOL_SOFT_BULL_MAX_BTC_MOMENTUM_6H_BPS,
      sol_soft_bull_min_alt_momentum_6h_bps: SOL_SOFT_BULL_MIN_ALT_MOMENTUM_6H_BPS,
      sol_soft_bull_max_alt_momentum_6h_bps: SOL_SOFT_BULL_MAX_ALT_MOMENTUM_6H_BPS,
      sol_soft_bull_min_alt_momentum_2h_bps: SOL_SOFT_BULL_MIN_ALT_MOMENTUM_2H_BPS,
      sol_soft_bull_min_spread_bps: SOL_SOFT_BULL_MIN_SPREAD_BPS,
      sol_soft_bull_max_spread_bps: SOL_SOFT_BULL_MAX_SPREAD_BPS,
      btc_momentum_6h_bps: btcMomentum6hBps
    })
  }
];

function buildCandidateRelativeStrengthLane(candidate: {
  id: string;
  symbol: string;
  regime: string;
  rule_config: CandidateRuleConfig | null;
}): RelativeStrengthLane | null {
  const cfg = candidate.rule_config ?? {};
  const symbol = String(cfg.symbol ?? candidate.symbol ?? "").trim();
  const direction = cfg.direction === "long" ? "long" : "short";
  if (!symbol) return null;

  // Match the regime bucketing used by lane-policy review, so candidate lanes
  // can't leak outside the BTC regime they were discovered/optimized for.
  const regimeFromBtcMomentum = (bps: number) => {
    if (bps <= -100) return "btc_neg_strong";
    if (bps < 0) return "btc_neg";
    if (bps >= 150) return "btc_pos_strong";
    if (bps > 0) return "btc_pos";
    return "flat";
  };

  return {
    key: `candidate_${candidate.id}`,
    symbol,
    direction,
    variant: `candidate_canary:${candidate.id}`,
    holdSeconds: Number(cfg.hold_seconds ?? 4 * 60 * 60),
    evaluate: ({ spreadBps, momentum6hBps, momentum2hBps, btcMomentum6hBps }) => {
      if (btcMomentum6hBps === null) return "btc_filter_blocked";
      const currentRegime = regimeFromBtcMomentum(btcMomentum6hBps);
      if (candidate.regime && currentRegime !== candidate.regime) return "candidate_regime_blocked";
      if (cfg.min_btc_6h_bps !== undefined && btcMomentum6hBps < cfg.min_btc_6h_bps) return "candidate_filter_blocked";
      if (cfg.max_btc_6h_bps !== undefined && btcMomentum6hBps >= cfg.max_btc_6h_bps) return "candidate_filter_blocked";
      if (cfg.min_alt_6h_bps !== undefined && momentum6hBps < cfg.min_alt_6h_bps) return "candidate_filter_blocked";
      if (cfg.max_alt_6h_bps !== undefined && momentum6hBps > cfg.max_alt_6h_bps) return "candidate_filter_blocked";
      if (cfg.min_alt_2h_bps !== undefined && momentum2hBps < cfg.min_alt_2h_bps) return "candidate_filter_blocked";
      if (cfg.max_alt_2h_bps !== undefined && momentum2hBps > cfg.max_alt_2h_bps) return "candidate_filter_blocked";
      if (cfg.min_spread_bps !== undefined && spreadBps < cfg.min_spread_bps) return "candidate_filter_blocked";
      if (cfg.max_spread_bps !== undefined && spreadBps >= cfg.max_spread_bps) return "candidate_filter_blocked";
      return null;
    },
    details: ({ spreadBps, momentum6hBps, momentum2hBps, btcMomentum6hBps }) => ({
      candidate_regime: candidate.regime,
      btc_momentum_6h_bps: btcMomentum6hBps,
      momentum_6h_bps: momentum6hBps,
      momentum_2h_bps: momentum2hBps,
      spread_bps: spreadBps,
      entry_threshold_bps: cfg.min_spread_bps ?? cfg.max_spread_bps ?? null,
      exit_threshold_bps: MAX_EXIT_SPREAD_BPS
    })
  };
}

export async function detectRelativeStrength(): Promise<DetectRelativeStrengthResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) throw new Error("Missing service role key.");

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const idempotentSince = new Date(Date.now() - IDEMPOTENT_MINUTES * 60 * 1000).toISOString();

  const data = await fetchSnapshots(adminSupabase, since);
  const { data: account } = await adminSupabase
    .from("paper_accounts")
    .select("user_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const strategySettingsMap = new Map<
    string,
    { strategy_key: string; enabled: boolean; config?: Record<string, unknown> | null }
  >();
  if (account?.user_id) {
    const { data: strategySettingsRows, error: strategySettingsError } = await adminSupabase
      .from("strategy_settings")
      .select("strategy_key, enabled, config")
      .eq("user_id", account.user_id);
    if (strategySettingsError) throw new Error(strategySettingsError.message);
    const mapped = buildStrategySettingsMap(
      (strategySettingsRows ?? []) as Array<{
        strategy_key: string | null;
        enabled: boolean | null;
        config?: Record<string, unknown> | null;
      }>
    );
    for (const [key, value] of mapped.entries()) strategySettingsMap.set(key, value);
  }
  // Candidate/AI lane workflow is intentionally disabled: it was too noisy operationally.
  const candidatePolicies: Array<{ id: string; symbol: string; regime: string; rule_config: CandidateRuleConfig | null }> = [];
  let currentRegime: BtcRegime | null = null;
  const isLaneDetectEnabled = (variant: string) => {
    const parentState = lanePolicyStateFromSettingsMap(strategySettingsMap, RELATIVE_STRENGTH_PARENT_KEY);
    if (!laneStateAllowsDetection(parentState)) return false;
    if (currentRegime) {
      if (laneAllowsDetectionByRegime(variant, currentRegime)) return true;
      // If it's a known lane and it's not allowed in this regime, block it.
      if (["xrp_shadow_short_core","xrp_shadow_short_bull_fade_canary","avax_shadow_short_canary","sol_shadow_short_soft_bear_laggard","sol_shadow_short_deep_bear_continuation","sol_shadow_short_soft_bull_reversal_probe"].includes(variant)) {
        return false;
      }
    }
    const laneState = lanePolicyStateFromSettingsMap(strategySettingsMap, variant);
    return laneStateAllowsDetection(laneState);
  };
  const runtimeLanes = [
    ...RELATIVE_STRENGTH_LANES
  ];

  const byHour = new Map<string, Map<string, number>>();
  for (const row of data) {
    if (
      row.spot_bid === null ||
      row.spot_ask === null ||
      row.spot_bid <= 0 ||
      row.spot_ask <= 0 ||
      row.spot_ask <= row.spot_bid
    ) {
      continue;
    }
    const hour = bucketHour(row.ts);
    const entry = byHour.get(hour) ?? new Map<string, number>();
    entry.set(row.symbol, (row.spot_bid + row.spot_ask) / 2);
    byHour.set(hour, entry);
  }

  const hours = Array.from(byHour.keys()).sort();
  if (hours.length < ENTRY_LOOKBACK_HOURS + 1) {
    return {
      inserted: 0,
      skipped: SYMBOLS.length,
      snapshot_rows_read: data.length,
      skip_reasons: { insufficient_history: SYMBOLS.length },
      near_miss_samples: []
    };
  }

  const latestHour = hours[hours.length - 1];
  const entryHour = hours[Math.max(0, hours.length - 1 - ENTRY_LOOKBACK_HOURS)];
  const exitHour = hours[Math.max(0, hours.length - 1 - EXIT_LOOKBACK_HOURS)];
  const latestMap = byHour.get(latestHour) ?? new Map<string, number>();
  const entryMap = byHour.get(entryHour) ?? new Map<string, number>();
  const exitMap = byHour.get(exitHour) ?? new Map<string, number>();

  const momentumRows = SYMBOLS.map((symbol) => {
    const latest = latestMap.get(symbol);
    const entry = entryMap.get(symbol);
    const exitRef = exitMap.get(symbol);
    if (!latest || !entry || !exitRef) return null;
    const momentum6hBps = ((latest - entry) / entry) * 10000;
    const momentum2hBps = ((latest - exitRef) / exitRef) * 10000;
    return { symbol, latest, momentum6hBps, momentum2hBps };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  const tradableRows = momentumRows.filter(
    (row) => RELATIVE_STRENGTH_ALLOWLIST.has(row.symbol) && !RELATIVE_STRENGTH_DENYLIST.has(row.symbol)
  );
  const btcRow = momentumRows.find((row) => row.symbol === "BTCUSD");
  const basketMean = momentumRows.length > 0 ? median(momentumRows.map((row) => row.momentum6hBps)) : 0;
  if (tradableRows.length === 0) {
    return {
      inserted: 0,
      skipped: 0,
      snapshot_rows_read: data.length,
      skip_reasons: { no_allowed_symbols: 1 },
      near_miss_samples: []
    };
  }
  const ranked = tradableRows
    .map((row) => ({ ...row, spreadBps: row.momentum6hBps - basketMean }))
    .sort((a, b) => Math.abs(b.spreadBps) - Math.abs(a.spreadBps));

  if (btcRow && Number.isFinite(btcRow.momentum6hBps)) {
    currentRegime = regimeFromBtcMomentum6hBps(btcRow.momentum6hBps);
  }

  let inserted = 0;
  let skipped = 0;
  const skip_reasons: Record<string, number> = {};
  const near_miss_samples: DetectRelativeStrengthResult["near_miss_samples"] = [];

  const candidates = ranked.flatMap((row) =>
    runtimeLanes
      .filter((lane) => lane.symbol === row.symbol && isLaneDetectEnabled(lane.variant))
      .map((lane) => ({ row, lane }))
  );
  for (const candidate of candidates) {
    const { row, lane } = candidate;
    const direction = lane.direction;
    const meanRevertingNow = Math.abs(row.momentum2hBps) <= MAX_EXIT_SPREAD_BPS;
    const laneReason = lane.evaluate({
      spreadBps: row.spreadBps,
      momentum6hBps: row.momentum6hBps,
      momentum2hBps: row.momentum2hBps,
      btcMomentum6hBps: btcRow ? btcRow.momentum6hBps : null
    });
    if (laneReason) {
      skipped += 1;
      skip_reasons[laneReason] = (skip_reasons[laneReason] ?? 0) + 1;
      continue;
    }
    if (meanRevertingNow) {
      skipped += 1;
      skip_reasons.already_reverted = (skip_reasons.already_reverted ?? 0) + 1;
      continue;
    }
    if (inserted >= MAX_SIGNALS) {
      skipped += 1;
      skip_reasons.max_signals_reached = (skip_reasons.max_signals_reached ?? 0) + 1;
      continue;
    }

    const { data: existing, error: existingError } = await adminSupabase
      .from("opportunities")
      .select("id")
      .eq("exchange", EXCHANGE)
      .eq("symbol", row.symbol)
      .eq("type", "relative_strength")
      .contains("details", { strategy_variant: lane.variant })
      .gte("ts", idempotentSince)
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      skipped += 1;
      skip_reasons.recent_opportunity_exists = (skip_reasons.recent_opportunity_exists ?? 0) + 1;
      continue;
    }

    const { error: insertError } = await adminSupabase.from("opportunities").insert({
      ts: latestHour,
      exchange: EXCHANGE,
      symbol: row.symbol,
      type: "relative_strength",
      net_edge_bps: Number(Math.abs(row.spreadBps).toFixed(4)),
      expected_daily_bps: null,
      confidence: Math.max(MIN_CONFIDENCE, Math.min(0.72, 0.58 + Math.abs(row.spreadBps) / 1000)),
      status: "new",
      details: {
        exchange: EXCHANGE,
        direction,
        momentum_6h_bps: Number(row.momentum6hBps.toFixed(4)),
        momentum_2h_bps: Number(row.momentum2hBps.toFixed(4)),
        btc_momentum_6h_bps: btcRow ? Number(btcRow.momentum6hBps.toFixed(4)) : null,
        basket_mean_bps: Number(basketMean.toFixed(4)),
        spread_bps: Number(row.spreadBps.toFixed(4)),
        entry_threshold_bps:
          lane.variant === "xrp_shadow_short_core"
            ? XRP_SHORT_MAX_SPREAD_BPS
            : lane.variant === "xrp_shadow_short_bull_fade_canary"
              ? XRP_BULL_FADE_MAX_SPREAD_BPS
            : lane.variant === "avax_shadow_short_canary"
              ? AVAX_SHORT_MIN_SPREAD_BPS
              : lane.variant === "sol_shadow_short_soft_bear_laggard"
                ? SOL_SOFT_BEAR_MAX_SPREAD_BPS
                : lane.variant === "sol_shadow_short_deep_bear_continuation"
                  ? SOL_DEEP_BEAR_MIN_SPREAD_BPS
                  : null,
        exit_threshold_bps: MAX_EXIT_SPREAD_BPS,
        hold_seconds: lane.holdSeconds,
        strategy_variant: lane.variant,
        ...lane.details({
          spreadBps: row.spreadBps,
          momentum6hBps: row.momentum6hBps,
          momentum2hBps: row.momentum2hBps,
          btcMomentum6hBps: btcRow ? btcRow.momentum6hBps : null
        }),
        strategy_family: "snapshot_relative_strength"
      }
    });
    if (insertError) throw new Error(insertError.message);
    inserted += 1;
  }

  const accounted = inserted + skipped;
  if (accounted < candidates.length) {
    skip_reasons.unknown = (skip_reasons.unknown ?? 0) + (candidates.length - accounted);
  }

  return {
    inserted,
    skipped,
    snapshot_rows_read: data.length,
    skip_reasons,
    near_miss_samples: near_miss_samples.slice(0, 5)
  };
}
