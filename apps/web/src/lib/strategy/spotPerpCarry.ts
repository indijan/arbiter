export type SnapshotInput = {
  ts: string;
  exchange: string;
  symbol: string;
  spot_bid: number | null;
  spot_ask: number | null;
  perp_bid: number | null;
  perp_ask: number | null;
  funding_rate: number | null;
};

export type OpportunityResult = {
  type: "spot_perp_carry";
  net_edge_bps: number;
  expected_daily_bps: number;
  expected_holding_bps: number;
  confidence: number;
  details: Record<string, unknown>;
};

export const CARRY_CONFIG = {
  fee_bps_total: 6,
  slippage_bps_total: 4,
  latency_buffer_bps: 2,
  min_net_edge_bps: 2
};

export type SpotPerpCarryParams = {
  holding_hours?: number;
};

export function spotPerpCarry(
  snapshot: SnapshotInput,
  params: SpotPerpCarryParams = {}
): OpportunityResult | null {
  const { spot_bid, spot_ask, perp_bid, perp_ask, funding_rate } = snapshot;

  if (
    spot_bid === null ||
    spot_ask === null ||
    perp_bid === null ||
    perp_ask === null ||
    funding_rate === null
  ) {
    return null;
  }

  const spreadsOk = spot_ask > spot_bid && perp_ask > perp_bid;
  const basis_bps = ((perp_bid - spot_ask) / spot_ask) * 10000;
  const funding_daily_bps = funding_rate * 3 * 10000;
  const holding_hours = params.holding_hours ?? 24;
  const expected_holding_bps = funding_daily_bps * (holding_hours / 24);
  const gross_edge_bps = basis_bps + expected_holding_bps;
  const costs_bps =
    CARRY_CONFIG.fee_bps_total +
    CARRY_CONFIG.slippage_bps_total +
    CARRY_CONFIG.latency_buffer_bps;
  const net_edge_bps = gross_edge_bps - costs_bps;

  const confidence = spreadsOk ? 0.7 : 0.3;

  if (net_edge_bps < CARRY_CONFIG.min_net_edge_bps) {
    return null;
  }

  return {
    type: "spot_perp_carry",
    net_edge_bps: Number(net_edge_bps.toFixed(4)),
    expected_daily_bps: Number(funding_daily_bps.toFixed(4)),
    expected_holding_bps: Number(expected_holding_bps.toFixed(4)),
    confidence,
    details: {
      basis_bps: Number(basis_bps.toFixed(4)),
      funding_rate,
      funding_daily_bps: Number(funding_daily_bps.toFixed(4)),
      expected_holding_bps: Number(expected_holding_bps.toFixed(4)),
      costs_bps: {
        fee_bps_total: CARRY_CONFIG.fee_bps_total,
        slippage_bps_total: CARRY_CONFIG.slippage_bps_total,
        latency_buffer_bps: CARRY_CONFIG.latency_buffer_bps,
        total: costs_bps
      },
      prices: {
        spot_bid,
        spot_ask,
        perp_bid,
        perp_ask
      }
    }
  };
}
