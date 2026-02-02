import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";
import { spotPerpCarry, CARRY_CONFIG } from "@/lib/strategy/spotPerpCarry";

const LOOKBACK_MINUTES = 15;
const IDEMPOTENT_MINUTES = 5;

const DEFAULT_HOLDING_HOURS = 24;
const MAX_HOLDING_HOURS = 168;

const ENTRY_COSTS_BPS = 8;
const EXIT_COSTS_BPS = 8;
const TOTAL_COSTS_BPS = ENTRY_COSTS_BPS + EXIT_COSTS_BPS;

export type EvaluatedRow = {
  exchange: string;
  symbol: string;
  entry_basis_bps: number;
  expected_holding_bps: number;
  funding_daily_bps: number;
  total_costs_bps: number;
  gross_edge_bps: number;
  net_edge_bps: number;
  break_even_hours: number | null;
  decision: "inserted" | "skipped" | "watchlist";
  reason?: string;
  spot_bid: number | null;
  spot_ask: number | null;
  perp_bid: number | null;
  perp_ask: number | null;
  spot_mid: number | null;
  perp_mid: number | null;
};

export type DetectCarryResult = {
  inserted: number;
  watchlist: number;
  skipped: number;
  holding_hours: number;
  evaluated: EvaluatedRow[];
};

export type DetectParams = {
  holding_hours?: number;
};

function safeMid(bid: number | null, ask: number | null) {
  if (bid === null || ask === null) {
    return null;
  }
  return (bid + ask) / 2;
}

export async function detectCarry(
  params: DetectParams = {}
): Promise<DetectCarryResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const rawHolding = Number(params.holding_hours ?? DEFAULT_HOLDING_HOURS);
  const holding_hours = Number.isFinite(rawHolding)
    ? Math.min(Math.max(rawHolding, 1), MAX_HOLDING_HOURS)
    : DEFAULT_HOLDING_HOURS;

  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const idempotentSince = new Date(
    Date.now() - IDEMPOTENT_MINUTES * 60 * 1000
  ).toISOString();

  const { data: allSnapshots, error: allError } = await adminSupabase
    .from("market_snapshots")
    .select(
      "id, ts, exchange, symbol, spot_bid, spot_ask, perp_bid, perp_ask, funding_rate"
    )
    .gte("ts", since)
    .order("ts", { ascending: false });

  if (allError) {
    throw new Error(allError.message);
  }

  const symbolsInWindow = new Set<string>();
  for (const snapshot of allSnapshots ?? []) {
    symbolsInWindow.add(snapshot.symbol);
  }

  const validSnapshots = (allSnapshots ?? []).filter((snapshot) => {
    const { spot_bid, spot_ask, perp_bid, perp_ask } = snapshot;
    return (
      spot_bid !== null &&
      spot_ask !== null &&
      perp_bid !== null &&
      perp_ask !== null &&
      spot_bid > 0 &&
      spot_ask > 0 &&
      perp_bid > 0 &&
      perp_ask > 0 &&
      spot_ask > spot_bid &&
      perp_ask > perp_bid
    );
  });

  const latestBySymbol = new Map<string, (typeof validSnapshots)[number]>();
  for (const snapshot of validSnapshots) {
    if (!latestBySymbol.has(snapshot.symbol)) {
      latestBySymbol.set(snapshot.symbol, snapshot);
    }
  }

  let inserted = 0;
  let watchlist = 0;
  let skipped = 0;
  const evaluated: EvaluatedRow[] = [];

  for (const symbol of symbolsInWindow.values()) {
    const snapshot = latestBySymbol.get(symbol);

    if (!snapshot) {
      skipped += 1;
      evaluated.push({
        exchange: "binance",
        symbol,
        entry_basis_bps: 0,
        expected_holding_bps: 0,
        funding_daily_bps: 0,
        total_costs_bps: TOTAL_COSTS_BPS,
        gross_edge_bps: 0,
        net_edge_bps: 0,
        break_even_hours: null,
        decision: "skipped",
        reason: "no valid snapshot",
        spot_bid: null,
        spot_ask: null,
        perp_bid: null,
        perp_ask: null,
        spot_mid: null,
        perp_mid: null
      });
      continue;
    }

    const spot_bid = snapshot.spot_bid ?? null;
    const spot_ask = snapshot.spot_ask ?? null;
    const perp_bid = snapshot.perp_bid ?? null;
    const perp_ask = snapshot.perp_ask ?? null;

    const spot_mid = safeMid(spot_bid, spot_ask);
    const perp_mid = safeMid(perp_bid, perp_ask);

    const entry_basis_bps =
      spot_mid && perp_mid ? ((perp_mid - spot_mid) / spot_mid) * 10000 : 0;

    const funding_daily_bps = snapshot.funding_rate
      ? snapshot.funding_rate * 3 * 10000
      : 0;

    const expected_holding_bps = funding_daily_bps * (holding_hours / 24);
    const gross_edge_bps = entry_basis_bps + expected_holding_bps;
    const total_costs_bps = TOTAL_COSTS_BPS;
    const net_edge_bps = gross_edge_bps - total_costs_bps;

    let break_even_hours: number | null = null;
    if (funding_daily_bps > 0) {
      const raw =
        (24 * (total_costs_bps - entry_basis_bps)) / funding_daily_bps;
      break_even_hours = Math.max(0, Number(raw.toFixed(2)));
    }

    let decision: "inserted" | "skipped" | "watchlist" = "skipped";
    let reason: string | undefined;

    if (funding_daily_bps <= 0) {
      skipped += 1;
      reason = "non-positive funding";
    } else if (
      break_even_hours !== null &&
      break_even_hours <= 48 &&
      net_edge_bps >= CARRY_CONFIG.min_net_edge_bps
    ) {
      const result = spotPerpCarry(snapshot, { holding_hours });

      if (!result) {
        skipped += 1;
        reason = "missing data";
      } else {
        const { data: existing, error: existingError } = await adminSupabase
          .from("opportunities")
          .select("id")
          .eq("exchange", snapshot.exchange)
          .eq("symbol", snapshot.symbol)
          .eq("type", result.type)
          .gte("ts", idempotentSince)
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingError) {
          throw new Error(existingError.message);
        }

        if (existing) {
          skipped += 1;
          reason = "recent opportunity exists";
        } else {
          const { error: insertError } = await adminSupabase
            .from("opportunities")
            .insert({
              ts: snapshot.ts,
              exchange: snapshot.exchange,
              symbol: snapshot.symbol,
              type: result.type,
              net_edge_bps: result.net_edge_bps,
              expected_daily_bps: result.expected_daily_bps,
              confidence: result.confidence,
              status: "new",
              details: {
                ...result.details,
                break_even_hours,
                entry_basis_bps: Number(entry_basis_bps.toFixed(4)),
                expected_holding_bps: Number(expected_holding_bps.toFixed(4)),
                total_costs_bps: Number(total_costs_bps.toFixed(4))
              }
            });

          if (insertError) {
            throw new Error(insertError.message);
          }

          inserted += 1;
          decision = "inserted";
        }
      }
    } else if (break_even_hours !== null && break_even_hours <= 72) {
      watchlist += 1;
      decision = "watchlist";
    } else {
      skipped += 1;
      reason = "below threshold";
    }

    evaluated.push({
      exchange: snapshot.exchange,
      symbol: snapshot.symbol,
      entry_basis_bps: Number(entry_basis_bps.toFixed(4)),
      expected_holding_bps: Number(expected_holding_bps.toFixed(4)),
      funding_daily_bps: Number(funding_daily_bps.toFixed(4)),
      total_costs_bps: Number(total_costs_bps.toFixed(4)),
      gross_edge_bps: Number(gross_edge_bps.toFixed(4)),
      net_edge_bps: Number(net_edge_bps.toFixed(4)),
      break_even_hours,
      decision,
      reason,
      spot_bid,
      spot_ask,
      perp_bid,
      perp_ask,
      spot_mid: spot_mid === null ? null : Number(spot_mid.toFixed(6)),
      perp_mid: perp_mid === null ? null : Number(perp_mid.toFixed(6))
    });
  }

  return { inserted, watchlist, skipped, holding_hours, evaluated };
}
