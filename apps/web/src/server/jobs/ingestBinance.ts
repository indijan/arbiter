import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

type BookTicker = {
  bidPrice: string;
  askPrice: string;
};

type PremiumIndex = {
  lastFundingRate?: string;
  time?: number;
};

const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "MATICUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "TRXUSDT",
  "TONUSDT",
  "ATOMUSDT",
  "NEARUSDT",
  "OPUSDT",
  "ARBUSDT",
  "SUIUSDT"
] as const;

const TIMEOUT_MS = 9000;

function toNumber(value: string | undefined | null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isPositiveNumber(value: number | null) {
  return value !== null && value > 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export type IngestError = {
  symbol: string;
  error: string;
};

export type IngestBinanceResult = {
  inserted: number;
  skipped: number;
  errors: IngestError[];
};

export async function ingestBinance(): Promise<IngestBinanceResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const errors: IngestError[] = [];
  const payload: Array<Record<string, unknown>> = [];

  const results = await Promise.all(
    SYMBOLS.map(async (symbol) => {
      try {
        const spot = await fetchJson<BookTicker>(
          `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`
        );
        const perp = await fetchJson<BookTicker>(
          `https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${symbol}`
        );
        const premium = await fetchJson<PremiumIndex>(
          `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`
        );

        const spot_bid = toNumber(spot.bidPrice);
        const spot_ask = toNumber(spot.askPrice);
        const perp_bid = toNumber(perp.bidPrice);
        const perp_ask = toNumber(perp.askPrice);

        if (
          !isPositiveNumber(spot_bid) ||
          !isPositiveNumber(spot_ask) ||
          !isPositiveNumber(perp_bid) ||
          !isPositiveNumber(perp_ask)
        ) {
          throw new Error("Invalid bid/ask data");
        }

        const spotBid = spot_bid as number;
        const spotAsk = spot_ask as number;
        const perpBid = perp_bid as number;
        const perpAsk = perp_ask as number;

        const mark_price = (perpBid + perpAsk) / 2;
        const index_price = (spotBid + spotAsk) / 2;

        payload.push({
          exchange: "binance",
          symbol,
          spot_bid: spotBid,
          spot_ask: spotAsk,
          perp_bid: perpBid,
          perp_ask: perpAsk,
          funding_rate: toNumber(premium.lastFundingRate),
          mark_price,
          index_price,
          ts: premium.time ? new Date(premium.time).toISOString() : new Date().toISOString()
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({ symbol, error: message });
      }
    })
  );

  void results;

  if (payload.length > 0) {
    const { error } = await adminSupabase.from("market_snapshots").insert(payload);
    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    inserted: payload.length,
    skipped: SYMBOLS.length - payload.length,
    errors
  };
}
