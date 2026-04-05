import "server-only";

import { paperFill } from "@/lib/execution/paperFill";

export type OpenRelativeStrengthParams = {
  userId: string;
  accountId: number;
  opportunityId: number;
  symbol: string;
  direction: "long" | "short";
  quote: { bid: number; ask: number };
  notionalUsd: number;
  feeBps: number;
  slippageBps: number;
  strategyVariant: string;
  holdSeconds: number;
  details: Record<string, unknown>;
  metaExtra: Record<string, unknown>;
};

export type OpenRelativeStrengthResult = {
  positionId: string;
  reservedUsd: number;
  availableUsd: number;
};

export async function openRelativeStrengthPaperPosition(
  adminSupabase: any,
  reservedCurrent: number,
  availableCurrent: number,
  params: OpenRelativeStrengthParams
): Promise<OpenRelativeStrengthResult> {
  const side = params.direction === "long" ? "buy" : "sell";
  const fill = paperFill({
    side,
    price: params.direction === "long" ? params.quote.ask : params.quote.bid,
    notional_usd: params.notionalUsd,
    slippage_bps: params.slippageBps,
    fee_bps: params.feeBps
  });

  const { data: position, error: positionError } = await adminSupabase
    .from("positions")
    .insert({
      user_id: params.userId,
      opportunity_id: params.opportunityId,
      symbol: params.symbol,
      mode: "paper",
      status: "open",
      entry_spot_price: fill.fill_price,
      entry_perp_price: null,
      spot_qty: params.direction === "long" ? fill.qty : -fill.qty,
      perp_qty: 0,
      meta: {
        opportunity_id: params.opportunityId,
        type: "relative_strength",
        exchange: "coinbase",
        symbol: params.symbol,
        direction: params.direction,
        entry_price: fill.fill_price,
        qty: fill.qty,
        fee_bps: params.feeBps,
        slippage_bps: params.slippageBps,
        notional_usd: params.notionalUsd,
        auto_execute: true,
        relative_strength_open: true,
        strategy_variant: params.strategyVariant,
        hold_seconds: params.holdSeconds,
        momentum_6h_bps: params.details.momentum_6h_bps,
        momentum_2h_bps: params.details.momentum_2h_bps,
        btc_momentum_6h_bps: params.details.btc_momentum_6h_bps,
        spread_bps: params.details.spread_bps,
        entry_threshold_bps: params.details.entry_threshold_bps,
        exit_threshold_bps: params.details.exit_threshold_bps,
        ...params.metaExtra
      }
    })
    .select("id")
    .single();

  if (positionError || !position?.id) {
    throw new Error(positionError?.message ?? "Failed to create relative strength position");
  }

  const { error: executionError } = await adminSupabase.from("executions").insert({
    position_id: position.id,
    leg: params.direction === "long" ? "spot_buy" : "spot_sell",
    requested_qty: fill.qty,
    filled_qty: fill.qty,
    avg_price: fill.fill_price,
    fee: fill.fee_usd,
    raw: {
      side,
      price: params.direction === "long" ? params.quote.ask : params.quote.bid,
      fill_price: fill.fill_price,
      slippage_bps: params.slippageBps,
      fee_bps: params.feeBps,
      notional_usd: params.notionalUsd
    }
  });
  if (executionError) throw new Error(executionError.message);

  const reservedUsd = Number((reservedCurrent + params.notionalUsd).toFixed(2));
  const { error: reserveError } = await adminSupabase
    .from("paper_accounts")
    .update({ reserved_usd: reservedUsd, updated_at: new Date().toISOString() })
    .eq("id", params.accountId);
  if (reserveError) throw new Error(reserveError.message);

  const availableUsd = Number((availableCurrent - params.notionalUsd).toFixed(2));

  return { positionId: String(position.id), reservedUsd, availableUsd };
}

