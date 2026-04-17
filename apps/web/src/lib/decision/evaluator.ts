export type WatchDecision =
  | "ignore"
  | "watch"
  | "strong_watch"
  | "paper_candidate"
  | "future_auto_candidate";

export type EvaluationInput = {
  strategy: string;
  exchange: string;
  symbol: string;
  net_edge_bps: number;
  metadata?: Record<string, unknown> | null;
  persistence_ticks?: number;
  first_seen_ts?: string | null;
  last_seen_ts?: string | null;
  lifetime_minutes?: number;
  consumed_risk_score?: number;
};

export type EvaluationResult = {
  score: number;
  decision: WatchDecision;
  reason: string;
  confidence_score: number;
  maker_net_edge_bps: number;
  taker_net_edge_bps: number | null;
  persistence_ticks: number;
  first_seen_ts: string | null;
  last_seen_ts: string | null;
  lifetime_minutes: number;
  execution_fragile: boolean;
  consumed_risk_score: number;
  auto_trade_candidate: boolean;
  auto_trade_exclusion_reasons: string[];
  decision_trace: string[];
};

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function opportunityKey(input: Pick<EvaluationInput, "strategy" | "exchange" | "symbol">) {
  return `${input.strategy}:${input.exchange}:${input.symbol}`;
}

export function evaluateOpportunity(input: EvaluationInput): EvaluationResult {
  const metadata = input.metadata ?? {};
  const makerNet = asNumber(metadata.maker_assisted_net_edge_bps, input.net_edge_bps);
  const takerNet = metadata.taker_net_edge_bps === undefined ? null : asNumber(metadata.taker_net_edge_bps);
  const persistenceTicks = Math.max(1, Math.floor(input.persistence_ticks ?? 1));
  const lifetimeMinutes = Math.max(0, asNumber(input.lifetime_minutes));
  const consumedRisk = clamp(asNumber(input.consumed_risk_score), 0, 100);
  const executionFragile = makerNet > 0 && takerNet !== null && takerNet < 0;
  const persistent = persistenceTicks >= 3 || lifetimeMinutes >= 20;
  const relativeStrength = input.strategy === "relative_strength";

  const confidence = clamp(
    makerNet * 3 + Math.min(persistenceTicks, 5) * 0.9 + Math.min(lifetimeMinutes, 60) / 20 - consumedRisk / 25,
    0,
    10
  );

  const exclusions: string[] = [];
  if (makerNet < 2) exclusions.push("insufficient_net_edge");
  if (!persistent) exclusions.push("insufficient_persistence");
  if (takerNet !== null && takerNet < 0) exclusions.push("negative_taker_edge");
  if (consumedRisk >= 50) exclusions.push("high_consumption_risk");
  if (executionFragile) exclusions.push("execution_fragile");
  if (confidence < 6) exclusions.push("insufficient_confidence");

  const trace = [
    `maker_net=${makerNet.toFixed(4)}bps`,
    `taker_net=${takerNet === null ? "n/a" : `${takerNet.toFixed(4)}bps`}`,
    `persistence_ticks=${persistenceTicks}`,
    `lifetime_minutes=${lifetimeMinutes.toFixed(1)}`,
    `consumed_risk=${consumedRisk.toFixed(1)}`,
    `execution_fragile=${executionFragile}`,
    `confidence=${confidence.toFixed(1)}`
  ];

  let decision: WatchDecision = "ignore";
  if (makerNet >= 1 && makerNet < 1.5) decision = "watch";
  if (makerNet >= 1.5) decision = persistent && confidence >= 6 && consumedRisk < 50 ? "strong_watch" : "watch";
  if (makerNet >= 2 && persistent && confidence >= 6 && consumedRisk < 35 && !executionFragile) {
    decision = "paper_candidate";
  }
  if (relativeStrength && (!persistent || confidence < 8)) {
    decision = decision === "ignore" ? "ignore" : "watch";
    trace.push("relative_strength_capped=true");
  }

  const penalty = (executionFragile ? 15 : 0) + consumedRisk * 0.25 + (persistent ? 0 : 18) + (relativeStrength ? 8 : 0);
  const score = clamp(makerNet * 18 + confidence * 6 + Math.min(persistenceTicks, 5) * 4 - penalty, 0, 100);
  const autoTradeCandidate = decision === "paper_candidate" && exclusions.length === 0;

  return {
    score: Number(score.toFixed(1)),
    decision,
    reason: `maker=${makerNet.toFixed(2)}bps, persistence=${persistenceTicks} ticks, fragile=${executionFragile}`,
    confidence_score: Number(confidence.toFixed(1)),
    maker_net_edge_bps: Number(makerNet.toFixed(4)),
    taker_net_edge_bps: takerNet === null ? null : Number(takerNet.toFixed(4)),
    persistence_ticks: persistenceTicks,
    first_seen_ts: input.first_seen_ts ?? null,
    last_seen_ts: input.last_seen_ts ?? null,
    lifetime_minutes: Number(lifetimeMinutes.toFixed(1)),
    execution_fragile: executionFragile,
    consumed_risk_score: Number(consumedRisk.toFixed(1)),
    auto_trade_candidate: autoTradeCandidate,
    auto_trade_exclusion_reasons: exclusions,
    decision_trace: trace
  };
}

