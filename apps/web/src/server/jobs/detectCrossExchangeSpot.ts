import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

const IDEMPOTENT_MINUTES = 5;

const COSTS_BPS = {
  fee_bps_total: 6,
  slippage_bps_total: 4,
  transfer_buffer_bps: 8
};

const MIN_NET_EDGE_BPS = 3;

const CANONICAL_MAP: Array<{
  canonical: string;
  bybit: string;
  okx: string;
  kraken?: string;
}> = [
  { canonical: "BTCUSD", bybit: "BTCUSDT", okx: "BTCUSDT", kraken: "BTCUSD" },
  { canonical: "ETHUSD", bybit: "ETHUSDT", okx: "ETHUSDT", kraken: "ETHUSD" },
  { canonical: "SOLUSD", bybit: "SOLUSDT", okx: "SOLUSDT" },
  { canonical: "XRPUSD", bybit: "XRPUSDT", okx: "XRPUSDT" },
  { canonical: "BNBUSD", bybit: "BNBUSDT", okx: "BNBUSDT" },
  { canonical: "ADAUSD", bybit: "ADAUSDT", okx: "ADAUSDT" },
  { canonical: "DOGEUSD", bybit: "DOGEUSDT", okx: "DOGEUSDT" },
  { canonical: "AVAXUSD", bybit: "AVAXUSDT", okx: "AVAXUSDT" },
  { canonical: "LINKUSD", bybit: "LINKUSDT", okx: "LINKUSDT" },
  { canonical: "LTCUSD", bybit: "LTCUSDT", okx: "LTCUSDT" },
  { canonical: "DOTUSD", bybit: "DOTUSDT", okx: "DOTUSDT" },
  { canonical: "BCHUSD", bybit: "BCHUSDT", okx: "BCHUSDT" },
  { canonical: "TRXUSD", bybit: "TRXUSDT", okx: "TRXUSDT" }
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

    if (!bybitSnap && !okxSnap && !krakenSnap) {
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
      confidence: 0.6,
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
