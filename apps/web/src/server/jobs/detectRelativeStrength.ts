import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

const LOOKBACK_HOURS = 24;
const IDEMPOTENT_MINUTES = 10;
const EXCHANGE = "coinbase";
const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD", "LINKUSD", "AVAXUSD", "LTCUSD", "DOTUSD", "BCHUSD"];
const RELATIVE_STRENGTH_ALLOWLIST = new Set(["BCHUSD", "ETHUSD", "XRPUSD"]);
const RELATIVE_STRENGTH_DENYLIST = new Set(["LTCUSD", "DOTUSD"]);
const RELATIVE_STRENGTH_DIRECTION_RULES: Record<string, "long" | "short"> = {
  ETHUSD: "long",
  BCHUSD: "short",
  XRPUSD: "short"
};
const ENTRY_LOOKBACK_HOURS = 6;
const EXIT_LOOKBACK_HOURS = 2;
const MIN_ENTRY_SPREAD_BPS = 50;
const MAX_EXIT_SPREAD_BPS = 25;
const MIN_CONFIDENCE = 0.58;
const MAX_SIGNALS = 2;

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
    .sort((a, b) => b.spreadBps - a.spreadBps);

  let inserted = 0;
  let skipped = 0;
  const skip_reasons: Record<string, number> = {};
  const near_miss_samples: DetectRelativeStrengthResult["near_miss_samples"] = [];

  const candidates = [...ranked.slice(0, 1), ...ranked.slice(-1)].slice(0, MAX_SIGNALS);
  for (const row of candidates) {
    const absSpread = Math.abs(row.spreadBps);
    const direction = row.spreadBps > 0 ? "short" : "long";
    const requiredDirection = RELATIVE_STRENGTH_DIRECTION_RULES[row.symbol];
    const meanRevertingNow = Math.abs(row.momentum2hBps) <= MAX_EXIT_SPREAD_BPS;
    if (requiredDirection && direction !== requiredDirection) {
      skipped += 1;
      skip_reasons.direction_blocked = (skip_reasons.direction_blocked ?? 0) + 1;
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

    const { data: existing, error: existingError } = await adminSupabase
      .from("opportunities")
      .select("id")
      .eq("exchange", EXCHANGE)
      .eq("symbol", row.symbol)
      .eq("type", "relative_strength")
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
        basket_mean_bps: Number(basketMean.toFixed(4)),
        spread_bps: Number(row.spreadBps.toFixed(4)),
        entry_threshold_bps: MIN_ENTRY_SPREAD_BPS,
        exit_threshold_bps: MAX_EXIT_SPREAD_BPS,
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
