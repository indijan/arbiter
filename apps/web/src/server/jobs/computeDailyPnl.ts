import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

type PnlRow = {
  strategy_key: string;
  exchange_key: string;
  pnl_usd: number;
};

const STRATEGY_MAP: Record<string, string> = {
  spot_perp_carry: "carry_spot_perp",
  xarb_spot: "xarb_spot",
  tri_arb: "tri_arb"
};

function toNumber(value: number | null) {
  return typeof value === "number" ? value : null;
}

export async function computeDailyPnl(): Promise<PnlRow[]> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const { data: positions, error: positionsError } = await adminSupabase
    .from("positions")
    .select("id, user_id, opportunity_id, symbol, status, spot_qty, perp_qty, entry_spot_price, entry_perp_price")
    .eq("status", "open");

  if (positionsError) {
    throw new Error(positionsError.message);
  }

  const opportunityIds = (positions ?? [])
    .map((p) => p.opportunity_id)
    .filter((id): id is number => typeof id === "number");

  const { data: opportunities, error: oppError } = await adminSupabase
    .from("opportunities")
    .select("id, exchange, symbol, type")
    .in("id", opportunityIds.length > 0 ? opportunityIds : [0]);

  if (oppError) {
    throw new Error(oppError.message);
  }

  const oppMap = new Map(
    (opportunities ?? []).map((o) => [o.id, o])
  );

  const positionIds = (positions ?? []).map((p) => p.id);
  const { data: executions, error: execError } = await adminSupabase
    .from("executions")
    .select("position_id, fee")
    .in("position_id", positionIds.length > 0 ? positionIds : ["00000000-0000-0000-0000-000000000000"]);

  if (execError) {
    throw new Error(execError.message);
  }

  const feeMap = new Map<string, number>();
  for (const exec of executions ?? []) {
    const positionId = exec.position_id as string;
    const fee = Number(exec.fee ?? 0);
    feeMap.set(positionId, (feeMap.get(positionId) ?? 0) + fee);
  }

  const uniquePairs = new Map<string, { exchange: string; symbol: string }>();
  for (const opp of opportunities ?? []) {
    uniquePairs.set(`${opp.exchange}:${opp.symbol}`, {
      exchange: opp.exchange,
      symbol: opp.symbol
    });
  }

  const snapshotsMap = new Map<string, { spot_mid: number | null; perp_mid: number | null }>();

  for (const pair of uniquePairs.values()) {
    const { data: snap } = await adminSupabase
      .from("market_snapshots")
      .select("spot_bid, spot_ask, perp_bid, perp_ask")
      .eq("exchange", pair.exchange)
      .eq("symbol", pair.symbol)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    const spot_bid = toNumber(snap?.spot_bid ?? null);
    const spot_ask = toNumber(snap?.spot_ask ?? null);
    const perp_bid = toNumber(snap?.perp_bid ?? null);
    const perp_ask = toNumber(snap?.perp_ask ?? null);

    const spot_mid = spot_bid !== null && spot_ask !== null ? (spot_bid + spot_ask) / 2 : null;
    const perp_mid = perp_bid !== null && perp_ask !== null ? (perp_bid + perp_ask) / 2 : null;

    snapshotsMap.set(`${pair.exchange}:${pair.symbol}`, { spot_mid, perp_mid });
  }

  const pnlAgg = new Map<string, number>();

  for (const position of positions ?? []) {
    const opp = position.opportunity_id ? oppMap.get(position.opportunity_id) : null;
    if (!opp) {
      continue;
    }

    const strategy_key = STRATEGY_MAP[opp.type] ?? opp.type;
    const exchange_key = opp.exchange ?? "unknown";

    const snapshotKey = `${opp.exchange}:${opp.symbol}`;
    const prices = snapshotsMap.get(snapshotKey);
    if (!prices) {
      continue;
    }

    const spot_mid = prices.spot_mid;
    const perp_mid = prices.perp_mid;

    const spot_qty = Number(position.spot_qty ?? 0);
    const perp_qty = Number(position.perp_qty ?? 0);

    const entry_spot_price = Number(position.entry_spot_price ?? 0);
    const entry_perp_price = Number(position.entry_perp_price ?? 0);

    if (!spot_mid || !perp_mid) {
      continue;
    }

    const spot_pnl = spot_qty * (spot_mid - entry_spot_price);
    const perp_pnl = perp_qty * (perp_mid - entry_perp_price);
    const fee_total = feeMap.get(position.id) ?? 0;
    const total_pnl = spot_pnl + perp_pnl - fee_total;

    const key = `${strategy_key}:${exchange_key}`;
    pnlAgg.set(key, (pnlAgg.get(key) ?? 0) + total_pnl);
  }

  const day = new Date().toISOString().slice(0, 10);
  const rows: PnlRow[] = [];

  for (const [key, pnl] of pnlAgg.entries()) {
    const [strategy_key, exchange_key] = key.split(":");
    rows.push({
      strategy_key,
      exchange_key,
      pnl_usd: Number(pnl.toFixed(2))
    });

    await adminSupabase
      .from("daily_strategy_pnl")
      .upsert(
        {
          day,
          strategy_key,
          exchange_key,
          pnl_usd: Number(pnl.toFixed(2))
        },
        { onConflict: "day,strategy_key,exchange_key" }
      );
  }

  return rows;
}
