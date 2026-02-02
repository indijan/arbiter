import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

const TIMEOUT_MS = 9000;

const PAIR_MAP: Record<string, string> = {
  BTCUSD: "XXBTZUSD",
  ETHUSD: "XETHZUSD"
};

type KrakenTicker = {
  a: [string, string, string];
  b: [string, string, string];
};

type KrakenResponse = {
  error: string[];
  result: Record<string, KrakenTicker>;
};

function toNumber(value: string | undefined | null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

export type IngestKrakenResult = {
  inserted: number;
  skipped: number;
  errors: IngestError[];
};

export async function ingestKraken(): Promise<IngestKrakenResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const errors: IngestError[] = [];
  const payload: Array<Record<string, unknown>> = [];

  const pairs = Object.entries(PAIR_MAP);

  await Promise.all(
    pairs.map(async ([canonical, krakenPair]) => {
      try {
        const url = `https://api.kraken.com/0/public/Ticker?pair=${krakenPair}`;
        const data = await fetchJson<KrakenResponse>(url);

        if (data.error && data.error.length > 0) {
          throw new Error(data.error.join(", "));
        }

        const ticker = data.result?.[krakenPair];
        if (!ticker) {
          throw new Error("Missing ticker data");
        }

        const ask = toNumber(ticker.a?.[0]);
        const bid = toNumber(ticker.b?.[0]);

        if (ask === null || bid === null || ask <= 0 || bid <= 0 || ask <= bid) {
          throw new Error("Invalid bid/ask data");
        }

        payload.push({
          exchange: "kraken",
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
  }

  return {
    inserted: payload.length,
    skipped: pairs.length - payload.length,
    errors
  };
}
