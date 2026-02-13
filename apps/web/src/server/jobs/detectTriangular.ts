import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

const TIMEOUT_MS = 9000;

const COSTS_BPS = 4;
const MIN_NET_EDGE_BPS = -1;
const IDEMPOTENT_MINUTES = 5;

type OkxTicker = {
  bidPx: string;
  askPx: string;
};

type OkxResponse = {
  code: string;
  msg: string;
  data: OkxTicker[];
};

type PathStep = {
  symbol: string;
  side: "buy" | "sell";
};

type Path = {
  name: string;
  steps: PathStep[];
};

const PATHS: Path[] = [
  {
    name: "USDT->BTC->ETH->USDT",
    steps: [
      { symbol: "BTC-USDT", side: "buy" },
      { symbol: "ETH-BTC", side: "buy" },
      { symbol: "ETH-USDT", side: "sell" }
    ]
  },
  {
    name: "USDT->BTC->SOL->USDT",
    steps: [
      { symbol: "BTC-USDT", side: "buy" },
      { symbol: "SOL-BTC", side: "buy" },
      { symbol: "SOL-USDT", side: "sell" }
    ]
  },
  {
    name: "USDT->BTC->XRP->USDT",
    steps: [
      { symbol: "BTC-USDT", side: "buy" },
      { symbol: "XRP-BTC", side: "buy" },
      { symbol: "XRP-USDT", side: "sell" }
    ]
  },
  {
    name: "USDT->BTC->ADA->USDT",
    steps: [
      { symbol: "BTC-USDT", side: "buy" },
      { symbol: "ADA-BTC", side: "buy" },
      { symbol: "ADA-USDT", side: "sell" }
    ]
  }
];

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

function toNumber(value: string | undefined | null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type TriangularEvaluated = {
  path: string;
  gross_edge_bps: number;
  net_edge_bps: number;
  decision: "inserted" | "skipped";
  reason?: string;
};

export type DetectTriangularResult = {
  inserted: number;
  skipped: number;
  evaluated: TriangularEvaluated[];
};

function confidenceForTri(netEdgeBps: number) {
  if (netEdgeBps >= 20) {
    return 0.64;
  }
  if (netEdgeBps >= 12) {
    return 0.6;
  }
  return 0.56;
}

export async function detectTriangular(): Promise<DetectTriangularResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const idempotentSince = new Date(
    Date.now() - IDEMPOTENT_MINUTES * 60 * 1000
  ).toISOString();

  let inserted = 0;
  let skipped = 0;
  const evaluated: TriangularEvaluated[] = [];

  for (const path of PATHS) {
    try {
      const tickers = await Promise.all(
        path.steps.map((step) =>
          fetchJson<OkxResponse>(
            `https://www.okx.com/api/v5/market/ticker?instId=${step.symbol}`
          )
        )
      );

      let amount = 1;
      const steps: Array<Record<string, unknown>> = [];

      for (let i = 0; i < path.steps.length; i += 1) {
        const step = path.steps[i];
        const ticker = tickers[i];
        if (ticker.code !== "0" || !ticker.data[0]) {
          throw new Error("invalid prices");
        }
        const ask = toNumber(ticker.data[0].askPx);
        const bid = toNumber(ticker.data[0].bidPx);

        if (!ask || !bid || ask <= 0 || bid <= 0 || ask <= bid) {
          throw new Error("invalid prices");
        }

        if (step.side === "buy") {
          amount = amount / ask;
        } else {
          amount = amount * bid;
        }

        steps.push({
          symbol: step.symbol,
          side: step.side,
          bid,
          ask
        });
      }

      const gross_edge_bps = (amount - 1) * 10000;
      const net_edge_bps = gross_edge_bps - COSTS_BPS;

      if (net_edge_bps < MIN_NET_EDGE_BPS) {
        skipped += 1;
        evaluated.push({
          path: path.name,
          gross_edge_bps: Number(gross_edge_bps.toFixed(4)),
          net_edge_bps: Number(net_edge_bps.toFixed(4)),
          decision: "skipped",
          reason: "below threshold"
        });
        continue;
      }

      const { data: existing, error: existingError } = await adminSupabase
        .from("opportunities")
        .select("id")
        .eq("exchange", "okx")
        .eq("symbol", path.name)
        .eq("type", "tri_arb")
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
          path: path.name,
          gross_edge_bps: Number(gross_edge_bps.toFixed(4)),
          net_edge_bps: Number(net_edge_bps.toFixed(4)),
          decision: "skipped",
          reason: "recent opportunity exists"
        });
        continue;
      }

      const { error: insertError } = await adminSupabase.from("opportunities").insert({
        ts: new Date().toISOString(),
        exchange: "okx",
        symbol: path.name,
        type: "tri_arb",
        net_edge_bps: Number(net_edge_bps.toFixed(4)),
        expected_daily_bps: null,
        confidence: confidenceForTri(net_edge_bps),
        status: "new",
        details: {
          path: path.name,
          steps,
          gross_edge_bps: Number(gross_edge_bps.toFixed(4)),
          costs_bps: COSTS_BPS
        }
      });

      if (insertError) {
        throw new Error(insertError.message);
      }

      inserted += 1;
      evaluated.push({
        path: path.name,
        gross_edge_bps: Number(gross_edge_bps.toFixed(4)),
        net_edge_bps: Number(net_edge_bps.toFixed(4)),
        decision: "inserted"
      });
    } catch (err) {
      skipped += 1;
      evaluated.push({
        path: path.name,
        gross_edge_bps: 0,
        net_edge_bps: 0,
        decision: "skipped",
        reason: err instanceof Error ? err.message : "error"
      });
    }
  }

  return { inserted, skipped, evaluated };
}
