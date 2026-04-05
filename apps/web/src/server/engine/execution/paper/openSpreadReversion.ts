import "server-only";

import { paperFill } from "@/lib/execution/paperFill";

export type OpenSpreadReversionParams = {
  userId: string;
  accountId: number;
  opportunityId: number;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buySymbol: string;
  sellSymbol: string;
  buyQuote: { bid: number; ask: number };
  sellQuote: { bid: number; ask: number };
  notionalUsd: number;
  feeBps: number;
  slippageBps: number;
  roundtripCostsBps: number;
  targetExitGrossBps: number;
  stopLossGrossBps: number;
  liveGrossSpreadBps: number;
  liveExpectedNetBps: number;
  notionalReason: string;
};

export type OpenSpreadReversionResult = {
  positionId: string;
  reservedUsd: number;
  availableUsd: number;
};

export async function openSpreadReversionPaperPosition(
  adminSupabase: any,
  reservedCurrent: number,
  availableCurrent: number,
  params: OpenSpreadReversionParams
): Promise<OpenSpreadReversionResult> {
  const buyFill = paperFill({
    side: "buy",
    price: params.buyQuote.ask,
    notional_usd: params.notionalUsd,
    slippage_bps: params.slippageBps,
    fee_bps: params.feeBps
  });

  const sellFill = paperFill({
    side: "sell",
    price: params.sellQuote.bid,
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
      entry_spot_price: buyFill.fill_price,
      entry_perp_price: sellFill.fill_price,
      spot_qty: buyFill.qty,
      perp_qty: -sellFill.qty,
      meta: {
        opportunity_id: params.opportunityId,
        type: "spread_reversion",
        buy_exchange: params.buyExchange,
        sell_exchange: params.sellExchange,
        buy_symbol: params.buySymbol,
        sell_symbol: params.sellSymbol,
        buy_entry_price: buyFill.fill_price,
        sell_entry_price: sellFill.fill_price,
        buy_qty: buyFill.qty,
        sell_qty: sellFill.qty,
        fee_bps: params.feeBps,
        slippage_bps: params.slippageBps,
        roundtrip_costs_bps: params.roundtripCostsBps,
        target_exit_gross_bps: Number(params.targetExitGrossBps.toFixed(4)),
        stop_loss_gross_bps: Number(params.stopLossGrossBps.toFixed(4)),
        entry_gross_spread_bps: Number(params.liveGrossSpreadBps.toFixed(4)),
        entry_expected_net_bps: Number(params.liveExpectedNetBps.toFixed(4)),
        notional_usd: params.notionalUsd,
        notional_reason: params.notionalReason,
        auto_execute: true,
        spread_reversion_open: true
      }
    })
    .select("id")
    .single();

  if (positionError || !position?.id) {
    throw new Error(positionError?.message ?? "Failed to create paper position");
  }

  const executionsPayload = [
    {
      position_id: position.id,
      leg: "spot_buy",
      requested_qty: buyFill.qty,
      filled_qty: buyFill.qty,
      avg_price: buyFill.fill_price,
      fee: buyFill.fee_usd,
      raw: {
        side: "buy",
        price: params.buyQuote.ask,
        fill_price: buyFill.fill_price,
        slippage_bps: params.slippageBps,
        fee_bps: params.feeBps,
        notional_usd: params.notionalUsd
      }
    },
    {
      position_id: position.id,
      leg: "spot_sell",
      requested_qty: sellFill.qty,
      filled_qty: sellFill.qty,
      avg_price: sellFill.fill_price,
      fee: sellFill.fee_usd,
      raw: {
        side: "sell",
        price: params.sellQuote.bid,
        fill_price: sellFill.fill_price,
        slippage_bps: params.slippageBps,
        fee_bps: params.feeBps,
        notional_usd: params.notionalUsd
      }
    }
  ];

  const { error: executionError } = await adminSupabase.from("executions").insert(executionsPayload);
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

