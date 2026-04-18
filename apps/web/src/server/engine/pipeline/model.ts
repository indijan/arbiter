import "server-only";
import type { WatchDecision } from "@/server/engine/types";

export type NormalizedSnapshot = {
  exchange: string;
  symbol: string;
  spot: { bid: number; ask: number };
  perp?: { bid: number; ask: number; funding_rate: number | null };
  timestamp: string;
};

export type StrategyOpportunity = {
  opportunity_id: number;
  strategy: string;
  exchange: string;
  symbol: string;
  entry_basis_bps: number;
  funding_daily_bps?: number;
  expected_holding_bps: number;
  total_costs_bps: number;
  gross_edge_bps: number;
  net_edge_bps: number;
  break_even_hours: number | null;
  risk_score: number;
  time_horizon_hours: number;
  metadata: Record<string, unknown>;
};

export type EvaluatedOpportunity = StrategyOpportunity & {
  score: number;
  decision: WatchDecision;
  reason: string;
  execution_ready: true;
  auto_trade_candidate: boolean;
  confidence_score: number;
  maker_net_edge_bps: number;
  taker_net_edge_bps: number | null;
  persistence_ticks: number;
  first_seen_ts: string | null;
  last_seen_ts: string | null;
  lifetime_minutes: number;
  execution_fragile: boolean;
  consumed_risk_score: number;
  auto_trade_exclusion_reasons: string[];
  decision_trace: string[];
  decision_support_state: "ignored" | "watch" | "near_decision_capable" | "decision_capable";
  qualified_for_top_list: boolean;
  qualified_for_decision_capable: boolean;
  failed_checks: string[];
  primary_failure_reason: string | null;
  score_components: {
    edge: number;
    persistence: number;
    confidence: number;
    consumed_risk_penalty: number;
    execution_fragility_penalty: number;
    strategy_penalty: number;
  };
};
