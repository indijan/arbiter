import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

const LOOKBACK_HOURS = 24;
const IDEMPOTENT_MINUTES = 10;
const EXCHANGE = "coinbase";
const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD", "LINKUSD", "AVAXUSD", "LTCUSD", "DOTUSD", "BCHUSD"];
const RELATIVE_STRENGTH_ALLOWLIST = new Set(["XRPUSD", "AVAXUSD", "SOLUSD"]);
const RELATIVE_STRENGTH_DENYLIST = new Set(["LTCUSD", "DOTUSD", "BCHUSD"]);
const XRP_SHORT_MIN_BTC_MOMENTUM_6H_BPS = 0;
const AVAX_SHORT_MIN_BTC_MOMENTUM_6H_BPS = 0;
const AVAX_SHORT_MIN_SPREAD_BPS = 50;
const SOL_SHORT_MAX_ALT_MOMENTUM_6H_BPS = -75;
const SOL_SHORT_MIN_SPREAD_BPS = -25;
const ENTRY_LOOKBACK_HOURS = 6;
const EXIT_LOOKBACK_HOURS = 2;
const MIN_ENTRY_SPREAD_BPS = 50;
const MAX_EXIT_SPREAD_BPS = 25;
const MIN_CONFIDENCE = 0.58;
const MAX_SIGNALS = 4;

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
  details: (args: { spreadBps: number; momentum6hBps: number; btcMomentum6hBps: number | null }) => Record<string, number | null>;
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
    evaluate: ({ btcMomentum6hBps, spreadBps }) => {
      if (!(btcMomentum6hBps !== null && btcMomentum6hBps < 0)) return "btc_filter_blocked";
      if (!(btcMomentum6hBps < XRP_SHORT_MIN_BTC_MOMENTUM_6H_BPS)) return "xrp_short_filter_blocked";
      if (!(spreadBps >= 0)) return "direction_blocked";
      return null;
    },
    details: ({ btcMomentum6hBps }) => ({
      xrp_short_min_btc_momentum_6h_bps: XRP_SHORT_MIN_BTC_MOMENTUM_6H_BPS,
      btc_momentum_6h_bps: btcMomentum6hBps
    })
  },
  {
    key: "avax_short",
    symbol: "AVAXUSD",
    direction: "short",
    variant: "avax_shadow_short_canary",
    holdSeconds: 4 * 60 * 60,
    evaluate: ({ btcMomentum6hBps, spreadBps }) => {
      if (!(btcMomentum6hBps !== null && btcMomentum6hBps >= 0)) return "btc_filter_blocked";
      if (!(btcMomentum6hBps >= AVAX_SHORT_MIN_BTC_MOMENTUM_6H_BPS) || !(spreadBps >= AVAX_SHORT_MIN_SPREAD_BPS)) {
        return "avax_short_filter_blocked";
      }
      if (!(spreadBps >= 0)) return "direction_blocked";
      return null;
    },
    details: ({ btcMomentum6hBps }) => ({
      avax_short_min_btc_momentum_6h_bps: AVAX_SHORT_MIN_BTC_MOMENTUM_6H_BPS,
      avax_short_min_spread_bps: AVAX_SHORT_MIN_SPREAD_BPS,
      btc_momentum_6h_bps: btcMomentum6hBps
    })
  },
  {
    key: "sol_short",
    symbol: "SOLUSD",
    direction: "short",
    variant: "sol_shadow_short_canary",
    holdSeconds: 4 * 60 * 60,
    evaluate: ({ btcMomentum6hBps, spreadBps, momentum6hBps }) => {
      if (
        !(momentum6hBps <= SOL_SHORT_MAX_ALT_MOMENTUM_6H_BPS) ||
        !(spreadBps >= SOL_SHORT_MIN_SPREAD_BPS)
      ) {
        return "sol_short_filter_blocked";
      }
      if (!(spreadBps >= 0)) return "direction_blocked";
      return null;
    },
    details: ({ btcMomentum6hBps }) => ({
      sol_short_max_btc_momentum_6h_bps: null,
      sol_short_max_alt_momentum_6h_bps: SOL_SHORT_MAX_ALT_MOMENTUM_6H_BPS,
      sol_short_min_spread_bps: SOL_SHORT_MIN_SPREAD_BPS,
      btc_momentum_6h_bps: btcMomentum6hBps
    })
  }
];

export async function detectRelativeStrength(): Promise<DetectRelativeStrengthResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) throw new Error("Missing service role key.");

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const idempotentSince = new Date(Date.now() - IDEMPOTENT_MINUTES * 60 * 1000).toISOString();

  const data = await fetchSnapshots(adminSupabase, since);

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
    return { inserted: 0, skipped: SYMBOLS.length, skip_reasons: { insufficient_history: SYMBOLS.length }, near_miss_samples: [] };
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
      skip_reasons: { no_allowed_symbols: 1 },
      near_miss_samples: []
    };
  }
  const ranked = tradableRows
    .map((row) => ({ ...row, spreadBps: row.momentum6hBps - basketMean }))
    .sort((a, b) => Math.abs(b.spreadBps) - Math.abs(a.spreadBps));

  let inserted = 0;
  let skipped = 0;
  const skip_reasons: Record<string, number> = {};
  const near_miss_samples: DetectRelativeStrengthResult["near_miss_samples"] = [];

  const candidates = ranked.flatMap((row) =>
    RELATIVE_STRENGTH_LANES.filter((lane) => lane.symbol === row.symbol).map((lane) => ({ row, lane }))
  );
  for (const candidate of candidates) {
    const { row, lane } = candidate;
    const absSpread = Math.abs(row.spreadBps);
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
    if (absSpread < MIN_ENTRY_SPREAD_BPS) {
      skipped += 1;
      skip_reasons.below_threshold = (skip_reasons.below_threshold ?? 0) + 1;
      near_miss_samples.push({
        symbol: row.symbol,
        spread_bps: Number(row.spreadBps.toFixed(4)),
        momentum_6h_bps: Number(row.momentum6hBps.toFixed(4)),
        basket_mean_bps: Number(basketMean.toFixed(4)),
        reason: "below_threshold"
      });
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
      net_edge_bps: Number(absSpread.toFixed(4)),
      expected_daily_bps: null,
      confidence: Math.max(MIN_CONFIDENCE, Math.min(0.72, 0.58 + absSpread / 1000)),
      status: "new",
      details: {
        exchange: EXCHANGE,
        direction,
        momentum_6h_bps: Number(row.momentum6hBps.toFixed(4)),
        momentum_2h_bps: Number(row.momentum2hBps.toFixed(4)),
        btc_momentum_6h_bps: btcRow ? Number(btcRow.momentum6hBps.toFixed(4)) : null,
        basket_mean_bps: Number(basketMean.toFixed(4)),
        spread_bps: Number(row.spreadBps.toFixed(4)),
        entry_threshold_bps: MIN_ENTRY_SPREAD_BPS,
        exit_threshold_bps: MAX_EXIT_SPREAD_BPS,
        hold_seconds: lane.holdSeconds,
        strategy_variant: lane.variant,
        ...lane.details({
          spreadBps: row.spreadBps,
          momentum6hBps: row.momentum6hBps,
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

  return { inserted, skipped, skip_reasons, near_miss_samples: near_miss_samples.slice(0, 5) };
}
