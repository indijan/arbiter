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

export type StrategySignalFamily = "market_signal" | "execution_signal" | "generic_signal";
export type ExecutionQuality =
  | "not_applicable"
  | "not_viable"
  | "execution_fragile"
  | "execution_conditionally_viable"
  | "execution_ready";
export type ExecutionRecommendationState =
  | "market_signal_only"
  | "not_viable"
  | "watch_only"
  | "conditional_execution"
  | "execution_ready";

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
  decision_support_state: "ignored" | "watch" | "near_decision_capable" | "decision_capable";
  strategy_signal_family: StrategySignalFamily;
  decision_capable_market_signal: boolean;
  decision_capable_execution_signal: boolean;
  strategy_local_decision_capable: boolean;
  execution_quality: ExecutionQuality;
  execution_recommendation_state: ExecutionRecommendationState;
  execution_viability_score: number | null;
  regime_key: string | null;
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

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function classifyStrategyFamily(strategy: string): StrategySignalFamily {
  if (strategy === "relative_strength") return "market_signal";
  if (
    strategy === "xarb_spot" ||
    strategy === "cross_exchange_spot" ||
    strategy === "tri_arb" ||
    strategy === "triangular_arb" ||
    strategy === "carry_spot_perp"
  ) {
    return "execution_signal";
  }
  return "generic_signal";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildRegimeKey(input: EvaluationInput, metadata: Record<string, unknown>) {
  const family = classifyStrategyFamily(input.strategy);
  if (family !== "market_signal") return null;
  const variant = stringValue(metadata.strategy_variant) ?? input.strategy;
  const direction = stringValue(metadata.direction) ?? "neutral";
  const exchange = stringValue(metadata.exchange) ?? input.exchange;
  return `${input.strategy}:${variant}:${exchange}:${input.symbol}:${direction}`;
}

function executionViability(args: {
  family: StrategySignalFamily;
  makerNet: number;
  takerNet: number | null;
  persistenceTicks: number;
  lifetimeMinutes: number;
  metadata: Record<string, unknown>;
}) {
  if (args.family !== "execution_signal") {
    return {
      score: null,
      quality: "not_applicable" as ExecutionQuality,
      recommendation: "market_signal_only" as ExecutionRecommendationState
    };
  }

  const takerNet = args.takerNet ?? args.makerNet;
  const costBuffer = Math.max(0, args.makerNet - Math.max(0, -takerNet));
  const makerScore = clamp(args.makerNet * 12, 0, 35);
  const takerScore = takerNet >= 0 ? 30 : clamp(30 + takerNet * 12, 0, 30);
  const persistenceScore = clamp(args.persistenceTicks * 4, 0, 20);
  const lifetimeScore = clamp(args.lifetimeMinutes / 12, 0, 10);
  const bufferScore = clamp(costBuffer * 2, 0, 5);
  const score = clamp(makerScore + takerScore + persistenceScore + lifetimeScore + bufferScore, 0, 100);

  const conditionallyViable =
    args.makerNet >= 2.5 &&
    takerNet > -1 &&
    args.persistenceTicks >= 3 &&
    args.lifetimeMinutes >= 60 &&
    score >= 70;
  const ready = takerNet >= 0.5 && args.makerNet >= 2 && args.persistenceTicks >= 3 && score >= 75;

  if (ready) {
    return {
      score: Number(score.toFixed(1)),
      quality: "execution_ready" as ExecutionQuality,
      recommendation: "execution_ready" as ExecutionRecommendationState
    };
  }
  if (conditionallyViable) {
    return {
      score: Number(score.toFixed(1)),
      quality: "execution_conditionally_viable" as ExecutionQuality,
      recommendation: "conditional_execution" as ExecutionRecommendationState
    };
  }
  if (args.makerNet > 0 && takerNet < 0) {
    return {
      score: Number(score.toFixed(1)),
      quality: "execution_fragile" as ExecutionQuality,
      recommendation: score >= 45 ? "watch_only" as ExecutionRecommendationState : "not_viable" as ExecutionRecommendationState
    };
  }
  return {
    score: Number(score.toFixed(1)),
    quality: score >= 45 ? "execution_fragile" as ExecutionQuality : "not_viable" as ExecutionQuality,
    recommendation: score >= 45 ? "watch_only" as ExecutionRecommendationState : "not_viable" as ExecutionRecommendationState
  };
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
  const strategyFamily = classifyStrategyFamily(input.strategy);
  const relativeStrength = strategyFamily === "market_signal";
  const execution = executionViability({
    family: strategyFamily,
    makerNet,
    takerNet,
    persistenceTicks,
    lifetimeMinutes,
    metadata
  });
  const regimeKey = buildRegimeKey(input, metadata);

  const baseConfidence =
    makerNet * (relativeStrength ? 1.1 : 3) +
    Math.min(persistenceTicks, relativeStrength ? 8 : 5) * (relativeStrength ? 0.45 : 0.9) +
    Math.min(lifetimeMinutes, relativeStrength ? 240 : 60) / (relativeStrength ? 120 : 20) -
    consumedRisk / 25;
  const confidence = clamp(baseConfidence, 0, relativeStrength ? 9.2 : 10);
  const marketSignalOutlier = relativeStrength && makerNet >= 4 && confidence >= 8.5 && persistenceTicks >= 3 && lifetimeMinutes >= 60;

  const exclusions: string[] = [];
  if (makerNet < 2) exclusions.push("insufficient_net_edge");
  if (!persistent) exclusions.push("insufficient_persistence");
  if (takerNet !== null && takerNet < 0) exclusions.push("negative_taker_edge");
  if (consumedRisk >= 70) exclusions.push("high_consumption_risk");
  if (executionFragile) exclusions.push("execution_fragile");
  if (confidence < 6) exclusions.push("insufficient_confidence");

  const failedChecks: string[] = [];
  if (makerNet < 1.5) failedChecks.push("insufficient_edge_for_top");
  if (confidence < 6) failedChecks.push("insufficient_confidence");
  if (!persistent) failedChecks.push("insufficient_persistence");
  if (consumedRisk >= 70) failedChecks.push("high_consumption_risk");
  if (executionFragile) failedChecks.push("execution_fragile");
  if (relativeStrength && !marketSignalOutlier) failedChecks.push("strategy_filter_relative_strength");
  if (strategyFamily === "execution_signal" && execution.recommendation === "not_viable") {
    failedChecks.push("execution_not_viable");
  }

  const trace = [
    `maker_net=${makerNet.toFixed(4)}bps`,
    `taker_net=${takerNet === null ? "n/a" : `${takerNet.toFixed(4)}bps`}`,
    `persistence_ticks=${persistenceTicks}`,
    `lifetime_minutes=${lifetimeMinutes.toFixed(1)}`,
    `consumed_risk=${consumedRisk.toFixed(1)}`,
    `execution_fragile=${executionFragile}`,
    `confidence=${confidence.toFixed(1)}`,
    `strategy_signal_family=${strategyFamily}`,
    `execution_viability=${execution.score === null ? "n/a" : execution.score.toFixed(1)}`,
    `execution_recommendation=${execution.recommendation}`
  ];

  let decision: WatchDecision = "ignore";
  if (makerNet >= 1 && makerNet < 1.5) decision = "watch";
  if (makerNet >= 1.5) decision = persistent && confidence >= 6 ? "strong_watch" : "watch";
  if (strategyFamily === "execution_signal" && makerNet >= 2 && persistent && confidence >= 6 && consumedRisk < 70 && !executionFragile) {
    decision = "paper_candidate";
  }
  if (relativeStrength) {
    decision = decision === "ignore" ? "ignore" : "watch";
    if (!marketSignalOutlier) trace.push("relative_strength_capped=true");
  }

  const edgeComponent = relativeStrength ? Math.min(makerNet * 8, 45) : makerNet * 18;
  const confidenceComponent = confidence * 6;
  const persistenceComponent = relativeStrength
    ? Math.min(persistenceTicks, 6) * 2 + Math.min(lifetimeMinutes, 240) / 24
    : Math.min(persistenceTicks, 5) * 4 + Math.min(lifetimeMinutes, 60) / 6;
  const consumedRiskPenalty = consumedRisk * 0.15;
  const executionPenalty = executionFragile ? 15 : 0;
  const strategyPenalty = relativeStrength ? 20 : 0;
  const missingPersistencePenalty = persistent ? 0 : 18;
  const score = clamp(
    edgeComponent + confidenceComponent + persistenceComponent - consumedRiskPenalty - executionPenalty - strategyPenalty - missingPersistencePenalty,
    0,
    100
  );
  const autoTradeCandidate = decision === "paper_candidate" && exclusions.length === 0;
  const decisionCapableMarketSignal = marketSignalOutlier && consumedRisk < 70;
  const decisionCapableExecutionSignal =
    strategyFamily === "execution_signal" &&
    makerNet >= 1.5 &&
    confidence >= 6 &&
    persistent &&
    execution.recommendation === "execution_ready" &&
    !executionFragile &&
    consumedRisk < 70;
  const strategyLocalDecisionCapable = decisionCapableMarketSignal || decisionCapableExecutionSignal;
  const qualifiedForDecisionCapable = decisionCapableExecutionSignal;
  const qualifiedForTopList = strategyLocalDecisionCapable && consumedRisk < 70 && decision !== "ignore";
  const nearDecisionCapable =
    !strategyLocalDecisionCapable &&
    makerNet >= 1.2 &&
    confidence >= 4.5 &&
    failedChecks.length <= 2 &&
    !(relativeStrength && confidence < 6);
  const decisionSupportState = strategyLocalDecisionCapable
    ? "decision_capable"
    : nearDecisionCapable
      ? "near_decision_capable"
      : decision === "watch"
        ? "watch"
        : "ignored";

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
    decision_trace: [
      ...trace,
      `qualified_for_top_list=${qualifiedForTopList}`,
      `qualified_for_decision_capable=${qualifiedForDecisionCapable}`,
      `decision_capable_market_signal=${decisionCapableMarketSignal}`,
      `decision_capable_execution_signal=${decisionCapableExecutionSignal}`,
      `failed_checks=${failedChecks.join("|") || "none"}`
    ],
    decision_support_state: decisionSupportState,
    strategy_signal_family: strategyFamily,
    decision_capable_market_signal: decisionCapableMarketSignal,
    decision_capable_execution_signal: decisionCapableExecutionSignal,
    strategy_local_decision_capable: strategyLocalDecisionCapable,
    execution_quality: execution.quality,
    execution_recommendation_state: execution.recommendation,
    execution_viability_score: execution.score,
    regime_key: regimeKey,
    qualified_for_top_list: qualifiedForTopList,
    qualified_for_decision_capable: qualifiedForDecisionCapable,
    failed_checks: failedChecks,
    primary_failure_reason: failedChecks[0] ?? null,
    score_components: {
      edge: Number(edgeComponent.toFixed(1)),
      persistence: Number(persistenceComponent.toFixed(1)),
      confidence: Number(confidenceComponent.toFixed(1)),
      consumed_risk_penalty: Number(consumedRiskPenalty.toFixed(1)),
      execution_fragility_penalty: Number(executionPenalty.toFixed(1)),
      strategy_penalty: Number(strategyPenalty.toFixed(1))
    }
  };
}
