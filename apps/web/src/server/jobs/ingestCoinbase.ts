import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";
import { writeHotSnapshots } from "@/server/hotdb/sqlite";

const TIMEOUT_MS = 9000;

const PRODUCT_MAP: Record<string, string> = {
  BTCUSD: "BTC-USD",
  ETHUSD: "ETH-USD",
  SOLUSD: "SOL-USD",
  XRPUSD: "XRP-USD",
  ADAUSD: "ADA-USD",
  AVAXUSD: "AVAX-USD",
  LINKUSD: "LINK-USD",
  LTCUSD: "LTC-USD",
  DOTUSD: "DOT-USD",
  BCHUSD: "BCH-USD"
};

type CoinbaseTicker = {
  bid?: string;
  ask?: string;
  price?: string;
  product_id?: string;
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

export type IngestError = {
  symbol: string;
  error: string;
};

export type IngestCoinbaseResult = {
  inserted: number;
  skipped: number;
  errors: IngestError[];
};

export async function ingestCoinbase(): Promise<IngestCoinbaseResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const errors: IngestError[] = [];
  const payload: Array<Record<string, unknown>> = [];

  await Promise.all(
    Object.entries(PRODUCT_MAP).map(async ([canonical, productId]) => {
      try {
        const ticker = await fetchJson<CoinbaseTicker>(
          `https://api.exchange.coinbase.com/products/${productId}/ticker`
        );
        const bid = toNumber(ticker.bid);
        const ask = toNumber(ticker.ask);

        if (bid === null || ask === null || bid <= 0 || ask <= 0 || ask <= bid) {
          throw new Error("Invalid bid/ask data");
        }

        payload.push({
          exchange: "coinbase",
          symbol: canonical,
          spot_bid: bid,
          spot_ask: ask,
          perp_bid: null,
          perp_ask: null,
          funding_rate: null,
          mark_price: null,
          index_price: (bid + ask) / 2,
          ts: new Date().toISOString()
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({ symbol: canonical, error: message });
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
    skipped: Object.keys(PRODUCT_MAP).length - payload.length,
    errors
  };
}
