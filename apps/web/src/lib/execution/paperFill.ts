export type PaperFillInput = {
  side: "buy" | "sell";
  price: number;
  notional_usd: number;
  slippage_bps: number;
  fee_bps: number;
};

export type PaperFillResult = {
  qty: number;
  fill_price: number;
  fee_usd: number;
  notional_usd: number;
};

export function paperFill({
  side,
  price,
  notional_usd,
  slippage_bps,
  fee_bps
}: PaperFillInput): PaperFillResult {
  const slip = slippage_bps / 10000;
  const feeRate = fee_bps / 10000;
  const fill_price =
    side === "buy" ? price * (1 + slip) : price * (1 - slip);
  const qty = notional_usd / fill_price;
  const fee_usd = notional_usd * feeRate;

  return {
    qty: Number(qty.toFixed(8)),
    fill_price: Number(fill_price.toFixed(4)),
    fee_usd: Number(fee_usd.toFixed(4)),
    notional_usd: Number(notional_usd.toFixed(4))
  };
}
