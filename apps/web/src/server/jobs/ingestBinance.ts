import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

type BybitTicker = {
  symbol: string;
  bid1Price: string;
  ask1Price: string;
  fundingRate?: string;
};

type BybitResponse = {
  retCode: number;
  retMsg: string;
  result: {
    list: BybitTicker[];
  };
};

type OkxTicker = {
  instId: string;
  bidPx: string;
  askPx: string;
  ts: string;
};

type OkxResponse = {
  code: string;
  msg: string;
  data: OkxTicker[];
};

type OkxFunding = {
  instId: string;
  fundingRate: string;
  fundingTime: string;
};

type OkxFundingResponse = {
  code: string;
  msg: string;
  data: OkxFunding[];
};

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
  "MATICUSDT",
  "LTCUSDT",
  "DOTUSDT",
  "BCHUSDT",
  "TRXUSDT"
] as const;

const TIMEOUT_MS = 9000;

function toNumber(value: string | undefined | null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isPositiveNumber(value: number | null): value is number {
  return value !== null && value > 0;
}

function okxSpotInstId(symbol: string) {
  const base = symbol.replace("USDT", "");
  return `${base}-USDT`;
}

function okxSwapInstId(symbol: string) {
  return `${okxSpotInstId(symbol)}-SWAP`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; ArbiterBot/1.0; +https://example.com)"
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

export type IngestBinanceResult = {
  inserted: number;
  skipped: number;
  errors: IngestError[];
};

async function fetchBybitSnapshot(symbol: string) {
  const spot = await fetchJson<BybitResponse>(
    `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`
  );
  const perp = await fetchJson<BybitResponse>(
    `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`
  );

  if (spot.retCode !== 0 || perp.retCode !== 0) {
    throw new Error(`Bybit error: ${spot.retMsg || perp.retMsg}`);
  }

  const spotTicker = spot.result.list[0];
  const perpTicker = perp.result.list[0];

  if (!spotTicker || !perpTicker) {
    throw new Error("Bybit empty response");
  }

  const spot_bid = toNumber(spotTicker.bid1Price);
  const spot_ask = toNumber(spotTicker.ask1Price);
  const perp_bid = toNumber(perpTicker.bid1Price);
  const perp_ask = toNumber(perpTicker.ask1Price);

  if (!isPositiveNumber(spot_bid) || !isPositiveNumber(spot_ask) || !isPositiveNumber(perp_bid) || !isPositiveNumber(perp_ask)) {
    throw new Error("Invalid bid/ask data");
  }

  const mark_price = (perp_bid + perp_ask) / 2;
  const index_price = (spot_bid + spot_ask) / 2;

  return {
    exchange: "bybit",
    symbol,
    spot_bid,
    spot_ask,
    perp_bid,
    perp_ask,
    funding_rate: toNumber(perpTicker.fundingRate),
    mark_price,
    index_price,
    ts: new Date().toISOString()
  };
}

async function fetchOkxSnapshot(symbol: string) {
  const spotInstId = okxSpotInstId(symbol);
  const swapInstId = okxSwapInstId(symbol);

  const spot = await fetchJson<OkxResponse>(
    `https://www.okx.com/api/v5/market/ticker?instId=${spotInstId}`
  );
  const swap = await fetchJson<OkxResponse>(
    `https://www.okx.com/api/v5/market/ticker?instId=${swapInstId}`
  );
  const funding = await fetchJson<OkxFundingResponse>(
    `https://www.okx.com/api/v5/public/funding-rate?instId=${swapInstId}`
  );

  if (spot.code !== "0" || swap.code !== "0") {
    throw new Error(`OKX error: ${spot.msg || swap.msg}`);
  }

  const spotTicker = spot.data[0];
  const swapTicker = swap.data[0];

  if (!spotTicker || !swapTicker) {
    throw new Error("OKX empty response");
  }

  const spot_bid = toNumber(spotTicker.bidPx);
  const spot_ask = toNumber(spotTicker.askPx);
  const perp_bid = toNumber(swapTicker.bidPx);
  const perp_ask = toNumber(swapTicker.askPx);

  if (!isPositiveNumber(spot_bid) || !isPositiveNumber(spot_ask) || !isPositiveNumber(perp_bid) || !isPositiveNumber(perp_ask)) {
    throw new Error("Invalid bid/ask data");
  }

  const fundingRate = funding.code === "0" ? toNumber(funding.data[0]?.fundingRate) : null;
  const mark_price = (perp_bid + perp_ask) / 2;
  const index_price = (spot_bid + spot_ask) / 2;

  return {
    exchange: "okx",
    symbol,
    spot_bid,
    spot_ask,
    perp_bid,
    perp_ask,
    funding_rate: fundingRate,
    mark_price,
    index_price,
    ts: swapTicker.ts ? new Date(Number(swapTicker.ts)).toISOString() : new Date().toISOString()
  };
}

export async function ingestBinance(): Promise<IngestBinanceResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const errors: IngestError[] = [];
  const payload: Array<Record<string, unknown>> = [];

  for (const symbol of SYMBOLS) {
      try {
        const snapshot = await fetchBybitSnapshot(symbol);
        payload.push(snapshot);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({ symbol: `BYBIT:${symbol}`, error: message });
      }

      await new Promise((resolve) => setTimeout(resolve, 180));

      try {
        const snapshot = await fetchOkxSnapshot(symbol);
        payload.push(snapshot);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({ symbol: `OKX:${symbol}`, error: message });
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
  }

  if (payload.length > 0) {
    const { error } = await adminSupabase.from("market_snapshots").insert(payload);
    if (error) {
      throw new Error(error.message);
    }
  }

  const attempts = SYMBOLS.length * 2;

  return {
    inserted: payload.length,
    skipped: attempts - payload.length,
    errors
  };
}
