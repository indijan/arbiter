import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

const IDEMPOTENT_MINUTES = 5;

const COSTS_BPS = {
  fee_bps_total: 6,
  slippage_bps_total: 2,
  transfer_buffer_bps: 3
};

const MIN_NET_EDGE_BPS = 0;
// Snapshot ingestion runs roughly every 10 minutes, so freshness must tolerate one full cycle.
const MAX_SNAPSHOT_AGE_SECONDS = 15 * 60;
const MAX_SNAPSHOT_SKEW_SECONDS = 20;

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

export type EvaluatedRow = {
  canonical_symbol: string;
  buy_exchange: string;
  sell_exchange: string;
  buy_ask: number;
  sell_bid: number;
  gross_edge_bps: number;
  net_edge_bps: number;
  decision: "inserted" | "skipped";
  reason?: string;
};

export type DetectCrossExchangeResult = {
  inserted: number;
  skipped: number;
  evaluated: EvaluatedRow[];
};

function confidenceForXarb(netEdgeBps: number) {
  if (netEdgeBps >= 20) {
    return 0.72;
  }
  if (netEdgeBps >= 14) {
    return 0.68;
  }
  if (netEdgeBps >= 9) {
    return 0.64;
  }
  if (netEdgeBps >= 5) {
    return 0.61;
  }
  return 0.54;
}

export async function detectCrossExchangeSpot(): Promise<DetectCrossExchangeResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const idempotentSince = new Date(
    Date.now() - IDEMPOTENT_MINUTES * 60 * 1000
  ).toISOString();

  let inserted = 0;
  let skipped = 0;
  const evaluated: EvaluatedRow[] = [];

  for (const mapping of CANONICAL_MAP) {
    let binanceSnap: { ts: string; spot_bid: number | null; spot_ask: number | null } | null = null;
    if (mapping.binance) {
      const { data, error } = await adminSupabase
        .from("market_snapshots")
        .select("ts, spot_bid, spot_ask")
        .eq("exchange", "binance")
        .eq("symbol", mapping.binance)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      binanceSnap = data;
    }

    const { data: bybitSnap, error: bybitError } = await adminSupabase
      .from("market_snapshots")
      .select("ts, spot_bid, spot_ask")
      .eq("exchange", "bybit")
      .eq("symbol", mapping.bybit)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (bybitError) {
      throw new Error(bybitError.message);
    }

    const { data: okxSnap, error: okxError } = await adminSupabase
      .from("market_snapshots")
      .select("ts, spot_bid, spot_ask")
      .eq("exchange", "okx")
      .eq("symbol", mapping.okx)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (okxError) {
      throw new Error(okxError.message);
    }

    let coinbaseSnap: { ts: string; spot_bid: number | null; spot_ask: number | null } | null = null;
    if (mapping.coinbase) {
      const { data, error } = await adminSupabase
        .from("market_snapshots")
        .select("ts, spot_bid, spot_ask")
        .eq("exchange", "coinbase")
        .eq("symbol", mapping.coinbase)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      coinbaseSnap = data;
    }

    let krakenSnap: { ts: string; spot_bid: number | null; spot_ask: number | null } | null = null;
    if (mapping.kraken) {
      const { data, error } = await adminSupabase
        .from("market_snapshots")
        .select("ts, spot_bid, spot_ask")
        .eq("exchange", "kraken")
        .eq("symbol", mapping.kraken)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      krakenSnap = data;
    }

    if (!binanceSnap && !bybitSnap && !okxSnap && !coinbaseSnap && !krakenSnap) {
      skipped += 1;
      evaluated.push({
        canonical_symbol: mapping.canonical,
        buy_exchange: "-",
        sell_exchange: "-",
        buy_ask: 0,
        sell_bid: 0,
        gross_edge_bps: 0,
        net_edge_bps: 0,
        decision: "skipped",
        reason: "missing snapshots"
      });
      continue;
    }

    const quotes = [
      binanceSnap
        ? {
            exchange: "binance",
            ask: binanceSnap.spot_ask,
            bid: binanceSnap.spot_bid,
            note: "USDT proxy"
          }
        : null,
      bybitSnap
        ? {
            exchange: "bybit",
            ask: bybitSnap.spot_ask,
            bid: bybitSnap.spot_bid,
            note: "USDT proxy"
          }
        : null,
      okxSnap
        ? {
            exchange: "okx",
            ask: okxSnap.spot_ask,
            bid: okxSnap.spot_bid,
            note: "USDT proxy"
          }
        : null,
      coinbaseSnap
        ? {
            exchange: "coinbase",
            ask: coinbaseSnap.spot_ask,
            bid: coinbaseSnap.spot_bid,
            note: "USD"
          }
        : null,
      krakenSnap
        ? {
            exchange: "kraken",
            ask: krakenSnap.spot_ask,
            bid: krakenSnap.spot_bid,
            note: "USD"
          }
        : null
    ].filter(Boolean) as Array<{ exchange: string; ask: number | null; bid: number | null; note: string }>;

    const validQuotes = quotes.filter(
      (q): q is { exchange: string; ask: number; bid: number; note: string } =>
        q.ask !== null && q.bid !== null && q.ask > 0 && q.bid > 0 && q.ask > q.bid
    );

    const quoteAgesSeconds = validQuotes
      .map((q) => {
        const snap =
          q.exchange === "binance"
            ? binanceSnap
            : q.exchange === "bybit"
            ? bybitSnap
            : q.exchange === "okx"
              ? okxSnap
              : q.exchange === "coinbase"
                ? coinbaseSnap
                : krakenSnap;
        const ageMs = snap?.ts ? Date.now() - Date.parse(String(snap.ts)) : Number.NaN;
        return Number.isFinite(ageMs) ? ageMs / 1000 : Number.NaN;
      })
      .filter((age): age is number => Number.isFinite(age));

    if (validQuotes.length < 2) {
      skipped += 1;
      evaluated.push({
        canonical_symbol: mapping.canonical,
        buy_exchange: "-",
        sell_exchange: "-",
        buy_ask: 0,
        sell_bid: 0,
        gross_edge_bps: 0,
        net_edge_bps: 0,
        decision: "skipped",
        reason: "invalid quotes"
      });
      continue;
    }

    if (
      quoteAgesSeconds.length < 2 ||
      Math.max(...quoteAgesSeconds) > MAX_SNAPSHOT_AGE_SECONDS
    ) {
      skipped += 1;
      evaluated.push({
        canonical_symbol: mapping.canonical,
        buy_exchange: "-",
        sell_exchange: "-",
        buy_ask: 0,
        sell_bid: 0,
        gross_edge_bps: 0,
        net_edge_bps: 0,
        decision: "skipped",
        reason: "stale snapshots"
      });
      continue;
    }

    if (Math.max(...quoteAgesSeconds) - Math.min(...quoteAgesSeconds) > MAX_SNAPSHOT_SKEW_SECONDS) {
      skipped += 1;
      evaluated.push({
        canonical_symbol: mapping.canonical,
        buy_exchange: "-",
        sell_exchange: "-",
        buy_ask: 0,
        sell_bid: 0,
        gross_edge_bps: 0,
        net_edge_bps: 0,
        decision: "skipped",
        reason: "snapshot skew"
      });
      continue;
    }

    const buy = validQuotes.reduce((min, q) => (q.ask < min.ask ? q : min));
    const sell = validQuotes.reduce((max, q) => (q.bid > max.bid ? q : max));

    if (buy.exchange === sell.exchange) {
      skipped += 1;
      evaluated.push({
        canonical_symbol: mapping.canonical,
        buy_exchange: buy.exchange,
        sell_exchange: sell.exchange,
        buy_ask: buy.ask as number,
        sell_bid: sell.bid as number,
        gross_edge_bps: 0,
        net_edge_bps: 0,
        decision: "skipped",
        reason: "no cross-exchange edge"
      });
      continue;
    }

    const gross_edge_bps = ((sell.bid! - buy.ask!) / buy.ask!) * 10000;
    const costs_bps =
      COSTS_BPS.fee_bps_total +
      COSTS_BPS.slippage_bps_total +
      COSTS_BPS.transfer_buffer_bps;
    const net_edge_bps = gross_edge_bps - costs_bps;

    if (net_edge_bps < MIN_NET_EDGE_BPS) {
      skipped += 1;
      evaluated.push({
        canonical_symbol: mapping.canonical,
        buy_exchange: buy.exchange,
        sell_exchange: sell.exchange,
        buy_ask: buy.ask as number,
        sell_bid: sell.bid as number,
        gross_edge_bps: Number(gross_edge_bps.toFixed(4)),
        net_edge_bps: Number(net_edge_bps.toFixed(4)),
        decision: "skipped",
        reason: "below threshold"
      });
      continue;
    }

    const exchangeKey = [buy.exchange, sell.exchange].sort().join("_");
    const { data: existing, error: existingError } = await adminSupabase
      .from("opportunities")
      .select("id")
      .eq("exchange", exchangeKey)
      .eq("symbol", mapping.canonical)
      .eq("type", "xarb_spot")
      .gte("ts", idempotentSince)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      skipped += 1;
      evaluated.push({
        canonical_symbol: mapping.canonical,
        buy_exchange: buy.exchange,
        sell_exchange: sell.exchange,
        buy_ask: buy.ask as number,
        sell_bid: sell.bid as number,
        gross_edge_bps: Number(gross_edge_bps.toFixed(4)),
        net_edge_bps: Number(net_edge_bps.toFixed(4)),
        decision: "skipped",
        reason: "recent opportunity exists"
      });
      continue;
    }

    const { error: insertError } = await adminSupabase.from("opportunities").insert({
      ts: new Date().toISOString(),
      exchange: exchangeKey,
      symbol: mapping.canonical,
      type: "xarb_spot",
      net_edge_bps: Number(net_edge_bps.toFixed(4)),
      expected_daily_bps: null,
      confidence: confidenceForXarb(net_edge_bps),
      status: "new",
      details: {
        buy_exchange: buy.exchange,
        sell_exchange: sell.exchange,
        buy_ask: buy.ask,
        sell_bid: sell.bid,
        gross_edge_bps: Number(gross_edge_bps.toFixed(4)),
        costs_bps_breakdown: COSTS_BPS,
        canonical_symbol: mapping.canonical,
        usdt_proxy: buy.exchange !== "kraken" || sell.exchange !== "kraken"
      }
    });

    if (insertError) {
      throw new Error(insertError.message);
    }

    inserted += 1;
    evaluated.push({
      canonical_symbol: mapping.canonical,
      buy_exchange: buy.exchange,
      sell_exchange: sell.exchange,
      buy_ask: buy.ask as number,
      sell_bid: sell.bid as number,
      gross_edge_bps: Number(gross_edge_bps.toFixed(4)),
      net_edge_bps: Number(net_edge_bps.toFixed(4)),
      decision: "inserted"
    });
  }

  return { inserted, skipped, evaluated };
}
