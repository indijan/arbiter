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

function isMissingDailyPnlTableError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) {
    return false;
  }
  const message = String(error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    message.includes("could not find the table 'public.daily_strategy_pnl'") ||
    message.includes("daily_strategy_pnl")
  );
}

export async function computeDailyPnl(): Promise<PnlRow[]> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: positions, error: positionsError } = await adminSupabase
    .from("positions")
    .select(
      "id, user_id, opportunity_id, symbol, status, exit_ts, realized_pnl_usd, spot_qty, perp_qty, entry_spot_price, entry_perp_price, meta"
    )
    .in("status", ["open", "closed"]);

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

  const xarbPairs = new Map<string, { exchange: string; symbol: string }>();
  for (const position of positions ?? []) {
    const meta = (position.meta ?? {}) as Record<string, unknown>;
    if (meta.type === "xarb_spot") {
      const buyExchange = String(meta.buy_exchange ?? "");
      const sellExchange = String(meta.sell_exchange ?? "");
      const buySymbol = String(meta.buy_symbol ?? "");
      const sellSymbol = String(meta.sell_symbol ?? "");
      if (buyExchange && buySymbol) {
        xarbPairs.set(`${buyExchange}:${buySymbol}`, {
          exchange: buyExchange,
          symbol: buySymbol
        });
      }
      if (sellExchange && sellSymbol) {
        xarbPairs.set(`${sellExchange}:${sellSymbol}`, {
          exchange: sellExchange,
          symbol: sellSymbol
        });
      }
    }
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

  for (const pair of xarbPairs.values()) {
    if (snapshotsMap.has(`${pair.exchange}:${pair.symbol}`)) {
      continue;
    }
    const { data: snap } = await adminSupabase
      .from("market_snapshots")
      .select("spot_bid, spot_ask")
      .eq("exchange", pair.exchange)
      .eq("symbol", pair.symbol)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    const spot_bid = toNumber(snap?.spot_bid ?? null);
    const spot_ask = toNumber(snap?.spot_ask ?? null);
    const spot_mid = spot_bid !== null && spot_ask !== null ? (spot_bid + spot_ask) / 2 : null;

    snapshotsMap.set(`${pair.exchange}:${pair.symbol}`, { spot_mid, perp_mid: null });
  }

  const pnlAgg = new Map<string, number>();

  for (const position of positions ?? []) {
    const opp = position.opportunity_id ? oppMap.get(position.opportunity_id) : null;
    if (!opp) {
      continue;
    }

    const strategy_key = STRATEGY_MAP[opp.type] ?? opp.type;
    const exchange_key = opp.exchange ?? "unknown";

    let total_pnl = 0;
    const isClosedToday =
      position.status === "closed" &&
      typeof position.exit_ts === "string" &&
      position.exit_ts.slice(0, 10) === today;

    if (isClosedToday) {
      total_pnl = Number(position.realized_pnl_usd ?? 0);
    } else if (position.status === "open" && opp.type === "spot_perp_carry") {
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
      total_pnl = spot_pnl + perp_pnl - fee_total;
    } else if (position.status === "open" && opp.type === "xarb_spot") {
      const meta = (position.meta ?? {}) as Record<string, unknown>;
      const buyExchange = String(meta.buy_exchange ?? "");
      const sellExchange = String(meta.sell_exchange ?? "");
      const buySymbol = String(meta.buy_symbol ?? "");
      const sellSymbol = String(meta.sell_symbol ?? "");
      const buyEntry = Number(meta.buy_entry_price ?? 0);
      const sellEntry = Number(meta.sell_entry_price ?? 0);
      const buyQty = Number(meta.buy_qty ?? 0);
      const sellQty = Number(meta.sell_qty ?? 0);

      const buyPrices = snapshotsMap.get(`${buyExchange}:${buySymbol}`);
      const sellPrices = snapshotsMap.get(`${sellExchange}:${sellSymbol}`);
      if (!buyPrices?.spot_mid || !sellPrices?.spot_mid) {
        continue;
      }

      const buyPnl = buyQty * (buyPrices.spot_mid - buyEntry);
      const sellPnl = sellQty * (sellEntry - sellPrices.spot_mid);
      const fee_total = feeMap.get(position.id) ?? 0;
      total_pnl = buyPnl + sellPnl - fee_total;
    } else {
      continue;
    }

    const key = `${strategy_key}:${exchange_key}`;
    pnlAgg.set(key, (pnlAgg.get(key) ?? 0) + total_pnl);
  }

  const rows: PnlRow[] = [];

  for (const [key, pnl] of pnlAgg.entries()) {
    const [strategy_key, exchange_key] = key.split(":");
    rows.push({
      strategy_key,
      exchange_key,
      pnl_usd: Number(pnl.toFixed(2))
    });

    const { error: upsertError } = await adminSupabase
      .from("daily_strategy_pnl")
      .upsert(
        {
          day: today,
          strategy_key,
          exchange_key,
          pnl_usd: Number(pnl.toFixed(2))
        },
        { onConflict: "day,strategy_key,exchange_key" }
      );

    // If migration is not applied yet (or schema cache is stale), keep cron alive.
    if (upsertError && !isMissingDailyPnlTableError(upsertError)) {
      throw new Error(upsertError.message);
    }
  }

  return rows;
}
