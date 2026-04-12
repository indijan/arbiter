import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";
import { writeHotSnapshots } from "@/server/hotdb/sqlite";

const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "BNBUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "LTCUSDT",
  "DOTUSDT",
  "BCHUSDT",
  "TRXUSDT"
] as const;

const BASE_URLS = [
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api-gcp.binance.com"
];

const TIMEOUT_MS = 9000;

type BinanceBookTicker = {
  symbol: string;
  bidPrice: string;
  askPrice: string;
};

type IngestError = {
  symbol: string;
  error: string;
};

export type IngestBinanceSpotResult = {
  inserted: number;
  skipped: number;
  errors: IngestError[];
};

function toNumber(value: string | undefined | null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (compatible; ArbiterBot/1.0)"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBinanceTicker(symbol: string): Promise<BinanceBookTicker> {
  let lastError: Error | null = null;

  for (const baseUrl of BASE_URLS) {
    try {
      return await fetchJson<BinanceBookTicker>(
        `${baseUrl}/api/v3/ticker/bookTicker?symbol=${symbol}`
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown Binance error");
    }
  }

  throw lastError ?? new Error("Unable to reach Binance");
}

export async function ingestBinanceSpot(): Promise<IngestBinanceSpotResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const payload: Array<Record<string, unknown>> = [];
  const errors: IngestError[] = [];

  await Promise.all(
    SYMBOLS.map(async (symbol) => {
      try {
        const ticker = await fetchBinanceTicker(symbol);
        const bid = toNumber(ticker.bidPrice);
        const ask = toNumber(ticker.askPrice);

        if (bid === null || ask === null || bid <= 0 || ask <= 0 || ask <= bid) {
          throw new Error("Invalid bid/ask data");
        }

        payload.push({
          exchange: "binance",
          symbol,
          spot_bid: bid,
          spot_ask: ask,
          perp_bid: null,
          perp_ask: null,
          funding_rate: null,
          mark_price: null,
          index_price: (bid + ask) / 2,
          ts: new Date().toISOString()
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        errors.push({ symbol, error: message });
      }
    })
  );

  if (payload.length > 0) {
    const { error } = await adminSupabase.from("market_snapshots").insert(payload);
    if (error) {
      throw new Error(error.message);
    }
    writeHotSnapshots(payload as Array<Record<string, unknown>> as Array<{
      ts: string;
      exchange: string;
      symbol: string;
      spot_bid: number | null;
      spot_ask: number | null;
      perp_bid?: number | null;
      perp_ask?: number | null;
      funding_rate?: number | null;
      mark_price?: number | null;
      index_price?: number | null;
    }>);
  }

  return {
    inserted: payload.length,
    skipped: SYMBOLS.length - payload.length,
    errors
  };
}
