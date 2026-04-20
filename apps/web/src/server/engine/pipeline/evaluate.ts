import "server-only";
import type { EvaluatedOpportunity, StrategyOpportunity } from "@/server/engine/pipeline/model";
import { evaluateOpportunity, opportunityKey } from "@/lib/decision/evaluator";

function buildPersistence(opportunities: StrategyOpportunity[]) {
  const map = new Map<string, { count: number; first: string | null; last: string | null }>();
  for (const item of opportunities) {
    const key = opportunityKey(item);
    const ts = typeof item.metadata.ts === "string" ? item.metadata.ts : null;
    const existing = map.get(key) ?? { count: 0, first: null, last: null };
    existing.count += 1;
    if (ts && (!existing.first || ts < existing.first)) existing.first = ts;
    if (ts && (!existing.last || ts > existing.last)) existing.last = ts;
    map.set(key, existing);
  }
  return map;
}

export function runEvaluateStep(opportunities: StrategyOpportunity[]): EvaluatedOpportunity[] {
  const persistence = buildPersistence(opportunities);
  return opportunities.map((item) => {
    const seen = persistence.get(opportunityKey(item));
    const first = seen?.first ?? null;
    const last = seen?.last ?? null;
    const lifetime = first && last ? (new Date(last).getTime() - new Date(first).getTime()) / 60000 : 0;
    const evaluation = evaluateOpportunity({
      strategy: item.strategy,
      exchange: item.exchange,
      symbol: item.symbol,
      net_edge_bps: item.net_edge_bps,
      metadata: item.metadata,
      persistence_ticks: seen?.count ?? 1,
      first_seen_ts: first,
      last_seen_ts: last,
      lifetime_minutes: lifetime,
      consumed_risk_score: 0
    });

    return {
      ...item,
      risk_score: Number((100 - evaluation.score).toFixed(1)),
      score: evaluation.score,
      decision: evaluation.decision,
      reason: evaluation.reason,
      execution_ready: true,
      auto_trade_candidate: evaluation.auto_trade_candidate,
      confidence_score: evaluation.confidence_score,
      maker_net_edge_bps: evaluation.maker_net_edge_bps,
      taker_net_edge_bps: evaluation.taker_net_edge_bps,
      persistence_ticks: evaluation.persistence_ticks,
      first_seen_ts: evaluation.first_seen_ts,
      last_seen_ts: evaluation.last_seen_ts,
      lifetime_minutes: evaluation.lifetime_minutes,
      execution_fragile: evaluation.execution_fragile,
      consumed_risk_score: evaluation.consumed_risk_score,
      auto_trade_exclusion_reasons: evaluation.auto_trade_exclusion_reasons,
      decision_trace: evaluation.decision_trace,
      decision_support_state: evaluation.decision_support_state,
      strategy_signal_family: evaluation.strategy_signal_family,
      decision_capable_market_signal: evaluation.decision_capable_market_signal,
      decision_capable_execution_signal: evaluation.decision_capable_execution_signal,
      strategy_local_decision_capable: evaluation.strategy_local_decision_capable,
      execution_quality: evaluation.execution_quality,
      execution_recommendation_state: evaluation.execution_recommendation_state,
      execution_viability_score: evaluation.execution_viability_score,
      regime_key: evaluation.regime_key,
      qualified_for_top_list: evaluation.qualified_for_top_list,
      qualified_for_decision_capable: evaluation.qualified_for_decision_capable,
      failed_checks: evaluation.failed_checks,
      primary_failure_reason: evaluation.primary_failure_reason,
      score_components: evaluation.score_components
    };
  });
}
