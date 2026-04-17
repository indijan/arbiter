import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server-admin";
import { detectCarry } from "@/server/jobs/detectCarry";
import { detectCrossExchangeSpot } from "@/server/jobs/detectCrossExchangeSpot";
import { detectTriangular } from "@/server/jobs/detectTriangular";
import type { StrategyOpportunity } from "@/server/engine/pipeline/model";

const LOOKBACK_MINUTES = 35;

function asNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function runStrategyStep(): Promise<{
  inserted: Record<string, number>;
  opportunities: StrategyOpportunity[];
}> {
  const [carry, xarb, tri] = await Promise.all([
    detectCarry(),
    detectCrossExchangeSpot(),
    detectTriangular()
  ]);

  const admin = createAdminSupabase();
  if (!admin) throw new Error("Missing service role key.");

  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("opportunities")
    .select("id, ts, type, exchange, symbol, net_edge_bps, expected_daily_bps, details")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(150);

  if (error) throw new Error(error.message);

  const opportunities: StrategyOpportunity[] = (data ?? []).map((row) => {
    const details = (row.details ?? {}) as Record<string, unknown>;
    const entryBasis = asNumber(details.entry_basis_bps);
    const fundingDaily = asNumber(details.funding_daily_bps);
    const expectedHolding = asNumber(details.expected_holding_bps, asNumber(row.expected_daily_bps));
    const costs = asNumber(details.total_costs_bps, 12);
    const gross = asNumber(details.gross_edge_bps, asNumber(row.net_edge_bps) + costs);
    const net = asNumber(row.net_edge_bps);
    const breakEven = details.break_even_hours === null || details.break_even_hours === undefined
      ? null
      : asNumber(details.break_even_hours);

    return {
      opportunity_id: row.id,
      strategy: row.type,
      exchange: row.exchange,
      symbol: row.symbol,
      entry_basis_bps: entryBasis,
      funding_daily_bps: fundingDaily,
      expected_holding_bps: expectedHolding,
      total_costs_bps: costs,
      gross_edge_bps: gross,
      net_edge_bps: net,
      break_even_hours: breakEven,
      risk_score: 0,
      time_horizon_hours: 24,
      metadata: { ...details, ts: row.ts }
    };
  });

  return {
    inserted: {
      carry_spot_perp: carry.inserted,
      cross_exchange_spot: xarb.inserted,
      triangular_arb: tri.inserted
    },
    opportunities
  };
}
