import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

const LOOKBACK_HOURS = 24;
const IDEMPOTENT_MINUTES = 10;
const TIME_BUCKET_MINUTES = 10;
const MAX_SNAPSHOT_AGE_SECONDS = 40 * 60;
const MAX_SNAPSHOT_SKEW_SECONDS = 20;
const MIN_HISTORY_POINTS = 8;
const MIN_CURRENT_GROSS_BPS = 6;
const MIN_Z_SCORE = 1.5;
const MIN_EXPECTED_NET_BPS = 0.1;
const ROUNDTRIP_COSTS_BPS = 11;
const MAX_NEAR_MISS_SAMPLES = 5;
const SPREAD_REVERSION_DISABLED_SYMBOLS = new Set(["AVAXUSD"]);

const CANONICAL_MAP: Array<{
  canonical: string;
  binance?: string;
  bybit: string;
  okx: string;
  coinbase?: string;
  kraken?: string;
}> = [
  { canonical: "BTCUSD", binance: "BTCUSDT", bybit: "BTCUSDT", okx: "BTCUSDT", coinbase: "BTCUSD", kraken: "BTCUSD" },
  { canonical: "ETHUSD", binance: "ETHUSDT", bybit: "ETHUSDT", okx: "ETHUSDT", coinbase: "ETHUSD", kraken: "ETHUSD" },
  { canonical: "SOLUSD", binance: "SOLUSDT", bybit: "SOLUSDT", okx: "SOLUSDT", coinbase: "SOLUSD", kraken: "SOLUSD" },
  { canonical: "XRPUSD", binance: "XRPUSDT", bybit: "XRPUSDT", okx: "XRPUSDT", coinbase: "XRPUSD", kraken: "XRPUSD" },
  { canonical: "BNBUSD", binance: "BNBUSDT", bybit: "BNBUSDT", okx: "BNBUSDT", kraken: "BNBUSD" },
  { canonical: "ADAUSD", binance: "ADAUSDT", bybit: "ADAUSDT", okx: "ADAUSDT", coinbase: "ADAUSD", kraken: "ADAUSD" },
  { canonical: "DOGEUSD", binance: "DOGEUSDT", bybit: "DOGEUSDT", okx: "DOGEUSDT" },
  { canonical: "AVAXUSD", binance: "AVAXUSDT", bybit: "AVAXUSDT", okx: "AVAXUSDT", coinbase: "AVAXUSD", kraken: "AVAXUSD" },
  { canonical: "LINKUSD", binance: "LINKUSDT", bybit: "LINKUSDT", okx: "LINKUSDT", coinbase: "LINKUSD", kraken: "LINKUSD" },
  { canonical: "LTCUSD", binance: "LTCUSDT", bybit: "LTCUSDT", okx: "LTCUSDT", coinbase: "LTCUSD", kraken: "LTCUSD" },
  { canonical: "DOTUSD", binance: "DOTUSDT", bybit: "DOTUSDT", okx: "DOTUSDT", coinbase: "DOTUSD", kraken: "DOTUSD" },
  { canonical: "BCHUSD", binance: "BCHUSDT", bybit: "BCHUSDT", okx: "BCHUSDT", coinbase: "BCHUSD", kraken: "BCHUSD" },
  { canonical: "TRXUSD", binance: "TRXUSDT", bybit: "TRXUSDT", okx: "TRXUSDT", kraken: "TRXUSD" }
];

type SnapshotRow = {
  ts: string;
  exchange: string;
  symbol: string;
  spot_bid: number | null;
  spot_ask: number | null;
};

type Quote = {
  exchange: string;
  raw_symbol: string;
  bid: number;
  ask: number;
  ts: string;
};

export type SpreadReversionEvaluatedRow = {
  canonical_symbol: string;
  exchange: string;
  buy_exchange: string;
  sell_exchange: string;
  current_gross_bps: number;
  rolling_mean_bps: number;
  rolling_std_bps: number;
  z_score: number;
  expected_net_bps: number;
  decision: "inserted" | "skipped";
  reason?: string;
};

export type DetectSpreadReversionResult = {
  inserted: number;
  skipped: number;
  evaluated: SpreadReversionEvaluatedRow[];
  skip_reasons: Record<string, number>;
  near_miss_samples: Array<{
    symbol: string;
    exchange: string;
    current_gross_bps: number;
    expected_net_bps: number;
    rolling_mean_bps: number;
    rolling_std_bps: number;
    z_score: number;
    reason: string;
  }>;
};

function bucketIso(ts: string) {
  const bucketMs =
    Math.floor(Date.parse(ts) / (TIME_BUCKET_MINUTES * 60 * 1000)) *
    TIME_BUCKET_MINUTES *
    60 *
    1000;
  return new Date(bucketMs).toISOString();
}

function stddev(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function confidenceForSignal(zScore: number, expectedNetBps: number) {
  const zComponent = Math.max(0, Math.min(0.18, (zScore - 1) * 0.08));
  const edgeComponent = Math.max(0, Math.min(0.12, expectedNetBps / 40));
  return Number((0.56 + zComponent + edgeComponent).toFixed(4));
}

export async function detectSpreadReversion(): Promise<DetectSpreadReversionResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const idempotentSince = new Date(
    Date.now() - IDEMPOTENT_MINUTES * 60 * 1000
  ).toISOString();

  const exchangeUniverse = ["binance", "bybit", "okx", "coinbase", "kraken"];
  const rawToCanonical = new Map<string, string>();
  for (const mapping of CANONICAL_MAP) {
    if (mapping.binance) rawToCanonical.set(`binance:${mapping.binance}`, mapping.canonical);
    rawToCanonical.set(`bybit:${mapping.bybit}`, mapping.canonical);
    rawToCanonical.set(`okx:${mapping.okx}`, mapping.canonical);
    if (mapping.coinbase) rawToCanonical.set(`coinbase:${mapping.coinbase}`, mapping.canonical);
    if (mapping.kraken) rawToCanonical.set(`kraken:${mapping.kraken}`, mapping.canonical);
  }

  const data: SnapshotRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data: page, error } = await adminSupabase
      .from("market_snapshots")
      .select("ts, exchange, symbol, spot_bid, spot_ask")
      .gte("ts", since)
      .in("exchange", exchangeUniverse)
      .order("ts", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (page ?? []) as SnapshotRow[];
    data.push(...rows);

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  const bucketsBySymbol = new Map<string, Map<string, Map<string, Quote>>>();
  for (const row of data) {
    const canonical = rawToCanonical.get(`${row.exchange}:${row.symbol}`);
    if (!canonical) continue;
    if (
      row.spot_bid === null ||
      row.spot_ask === null ||
      row.spot_bid <= 0 ||
      row.spot_ask <= 0 ||
      row.spot_ask <= row.spot_bid
    ) {
      continue;
    }
    const bucket = bucketIso(row.ts);
    const symbolBuckets = bucketsBySymbol.get(canonical) ?? new Map<string, Map<string, Quote>>();
    const quotes = symbolBuckets.get(bucket) ?? new Map<string, Quote>();
    const current = quotes.get(row.exchange);
    if (!current || Date.parse(row.ts) > Date.parse(current.ts)) {
      quotes.set(row.exchange, {
        exchange: row.exchange,
        raw_symbol: row.symbol,
        bid: row.spot_bid,
        ask: row.spot_ask,
        ts: row.ts
      });
    }
    symbolBuckets.set(bucket, quotes);
    bucketsBySymbol.set(canonical, symbolBuckets);
  }

  let inserted = 0;
  let skipped = 0;
  const evaluated: SpreadReversionEvaluatedRow[] = [];
  const skip_reasons: Record<string, number> = {};
  const nearMisses: DetectSpreadReversionResult["near_miss_samples"] = [];

  function markSkip(row: SpreadReversionEvaluatedRow, reason: string) {
    skipped += 1;
    skip_reasons[reason] = (skip_reasons[reason] ?? 0) + 1;
    evaluated.push({ ...row, decision: "skipped", reason });
  }

  function pushNearMiss(sample: DetectSpreadReversionResult["near_miss_samples"][number]) {
    nearMisses.push(sample);
    nearMisses.sort((a, b) => b.expected_net_bps - a.expected_net_bps);
    if (nearMisses.length > MAX_NEAR_MISS_SAMPLES) {
      nearMisses.length = MAX_NEAR_MISS_SAMPLES;
    }
  }

  for (const mapping of CANONICAL_MAP) {
    if (SPREAD_REVERSION_DISABLED_SYMBOLS.has(mapping.canonical)) {
      markSkip({
        canonical_symbol: mapping.canonical,
        exchange: "-",
        buy_exchange: "-",
        sell_exchange: "-",
        current_gross_bps: 0,
        rolling_mean_bps: 0,
        rolling_std_bps: 0,
        z_score: 0,
        expected_net_bps: 0,
        decision: "skipped"
      }, "symbol_disabled");
      continue;
    }

    const symbolBuckets = bucketsBySymbol.get(mapping.canonical);
    if (!symbolBuckets || symbolBuckets.size === 0) {
      markSkip({
        canonical_symbol: mapping.canonical,
        exchange: "-",
        buy_exchange: "-",
        sell_exchange: "-",
        current_gross_bps: 0,
        rolling_mean_bps: 0,
        rolling_std_bps: 0,
        z_score: 0,
        expected_net_bps: 0,
        decision: "skipped"
      }, "missing_history");
      continue;
    }

    const bucketEntries = Array.from(symbolBuckets.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    const [latestBucketIso, latestQuotesMap] = bucketEntries[bucketEntries.length - 1];
    const latestQuotes = Array.from(latestQuotesMap.values());
    const freshLatestQuotes = latestQuotes.filter((quote) => {
      const ageSeconds = (Date.now() - Date.parse(quote.ts)) / 1000;
      return Number.isFinite(ageSeconds) && ageSeconds <= MAX_SNAPSHOT_AGE_SECONDS;
    });

    if (freshLatestQuotes.length < 2) {
      markSkip({
        canonical_symbol: mapping.canonical,
        exchange: "-",
        buy_exchange: "-",
        sell_exchange: "-",
        current_gross_bps: 0,
        rolling_mean_bps: 0,
        rolling_std_bps: 0,
        z_score: 0,
        expected_net_bps: 0,
        decision: "skipped"
      }, "stale_snapshots");
      continue;
    }

    let insertedForSymbol = false;

    for (const buy of freshLatestQuotes) {
      for (const sell of freshLatestQuotes) {
        if (buy.exchange === sell.exchange) continue;

        const pairTimes = [Date.parse(buy.ts) / 1000, Date.parse(sell.ts) / 1000];
        if (Math.max(...pairTimes) - Math.min(...pairTimes) > MAX_SNAPSHOT_SKEW_SECONDS) {
          markSkip({
            canonical_symbol: mapping.canonical,
            exchange: `${buy.exchange}_${sell.exchange}`,
            buy_exchange: buy.exchange,
            sell_exchange: sell.exchange,
            current_gross_bps: 0,
            rolling_mean_bps: 0,
            rolling_std_bps: 0,
            z_score: 0,
            expected_net_bps: 0,
            decision: "skipped"
          }, "snapshot_skew");
          continue;
        }

        const currentGrossBps = ((sell.bid - buy.ask) / buy.ask) * 10000;
        const exchangeKey = `${buy.exchange}_${sell.exchange}`;
        const baseRow: SpreadReversionEvaluatedRow = {
          canonical_symbol: mapping.canonical,
          exchange: exchangeKey,
          buy_exchange: buy.exchange,
          sell_exchange: sell.exchange,
          current_gross_bps: Number(currentGrossBps.toFixed(4)),
          rolling_mean_bps: 0,
          rolling_std_bps: 0,
          z_score: 0,
          expected_net_bps: 0,
          decision: "skipped"
        };

        if (currentGrossBps < MIN_CURRENT_GROSS_BPS) {
          markSkip(baseRow, "gross_below_floor");
          continue;
        }

        const history = bucketEntries
          .slice(0, -1)
          .map(([, quotes]) => {
            const buyQuote = quotes.get(buy.exchange);
            const sellQuote = quotes.get(sell.exchange);
            if (!buyQuote || !sellQuote) return null;
            return ((sellQuote.bid - buyQuote.ask) / buyQuote.ask) * 10000;
          })
          .filter((value): value is number => value !== null && Number.isFinite(value));

        if (history.length < MIN_HISTORY_POINTS) {
          markSkip(baseRow, "insufficient_history");
          continue;
        }

        const rollingMean = history.reduce((sum, value) => sum + value, 0) / history.length;
        const rollingStd = stddev(history);
        const safeStd = rollingStd > 0.01 ? rollingStd : 0.01;
        const zScore = (currentGrossBps - rollingMean) / safeStd;
        const targetExitGrossBps = rollingMean + Math.max(0.5, rollingStd * 0.25);
        const stopLossGrossBps = currentGrossBps + Math.max(2, rollingStd * 0.75);
        const expectedNetBps = currentGrossBps - targetExitGrossBps - ROUNDTRIP_COSTS_BPS;

        const filledRow: SpreadReversionEvaluatedRow = {
          ...baseRow,
          rolling_mean_bps: Number(rollingMean.toFixed(4)),
          rolling_std_bps: Number(rollingStd.toFixed(4)),
          z_score: Number(zScore.toFixed(4)),
          expected_net_bps: Number(expectedNetBps.toFixed(4))
        };

        if (zScore < MIN_Z_SCORE) {
          markSkip(filledRow, "zscore_below_threshold");
          continue;
        }

        if (expectedNetBps < MIN_EXPECTED_NET_BPS) {
          markSkip(filledRow, "below_threshold");
          pushNearMiss({
            symbol: mapping.canonical,
            exchange: exchangeKey,
            current_gross_bps: Number(currentGrossBps.toFixed(4)),
            expected_net_bps: Number(expectedNetBps.toFixed(4)),
            rolling_mean_bps: Number(rollingMean.toFixed(4)),
            rolling_std_bps: Number(rollingStd.toFixed(4)),
            z_score: Number(zScore.toFixed(4)),
            reason: "below_threshold"
          });
          continue;
        }

        const { data: existing, error: existingError } = await adminSupabase
          .from("opportunities")
          .select("id")
          .eq("exchange", exchangeKey)
          .eq("symbol", mapping.canonical)
          .eq("type", "spread_reversion")
          .gte("ts", idempotentSince)
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingError) {
          throw new Error(existingError.message);
        }

        if (existing) {
          markSkip(filledRow, "recent_opportunity_exists");
          continue;
        }

        const { error: insertError } = await adminSupabase.from("opportunities").insert({
          ts: latestBucketIso,
          exchange: exchangeKey,
          symbol: mapping.canonical,
          type: "spread_reversion",
          net_edge_bps: Number(expectedNetBps.toFixed(4)),
          expected_daily_bps: null,
          confidence: confidenceForSignal(zScore, expectedNetBps),
          status: "new",
          details: {
            canonical_symbol: mapping.canonical,
            buy_exchange: buy.exchange,
            sell_exchange: sell.exchange,
            buy_symbol: buy.raw_symbol,
            sell_symbol: sell.raw_symbol,
            buy_ask: buy.ask,
            sell_bid: sell.bid,
            current_gross_bps: Number(currentGrossBps.toFixed(4)),
            rolling_mean_bps: Number(rollingMean.toFixed(4)),
            rolling_std_bps: Number(rollingStd.toFixed(4)),
            z_score: Number(zScore.toFixed(4)),
            target_exit_gross_bps: Number(targetExitGrossBps.toFixed(4)),
            stop_loss_gross_bps: Number(stopLossGrossBps.toFixed(4)),
            expected_net_bps: Number(expectedNetBps.toFixed(4)),
            entry_net_threshold_bps: MIN_EXPECTED_NET_BPS,
            roundtrip_costs_bps: ROUNDTRIP_COSTS_BPS,
            history_points: history.length,
            strategy_family: "snapshot_mean_reversion"
          }
        });

        if (insertError) {
          throw new Error(insertError.message);
        }

        inserted += 1;
        insertedForSymbol = true;
        evaluated.push({ ...filledRow, decision: "inserted" });
        break;
      }

      if (insertedForSymbol) {
        break;
      }
    }

    if (!insertedForSymbol && !evaluated.some((row) => row.canonical_symbol === mapping.canonical)) {
      markSkip({
        canonical_symbol: mapping.canonical,
        exchange: "-",
        buy_exchange: "-",
        sell_exchange: "-",
        current_gross_bps: 0,
        rolling_mean_bps: 0,
        rolling_std_bps: 0,
        z_score: 0,
        expected_net_bps: 0,
        decision: "skipped"
      }, "no_pair_candidate");
    }
  }

  return {
    inserted,
    skipped,
    evaluated,
    skip_reasons,
    near_miss_samples: nearMisses
  };
}
