import "server-only";
import type { EvaluatedOpportunity, StrategyOpportunity } from "@/server/engine/pipeline/model";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function decisionFromScore(score: number): EvaluatedOpportunity["decision"] {
  if (score < 25) return "ignore";
  if (score < 45) return "watch";
  if (score < 65) return "strong_watch";
  if (score < 80) return "paper_candidate";
  return "future_auto_candidate";
}

export function runEvaluateStep(opportunities: StrategyOpportunity[]): EvaluatedOpportunity[] {
  return opportunities.map((item) => {
    const edgeScore = clamp(item.net_edge_bps * 2.5, -25, 60);
    const fundingScore = clamp((item.funding_daily_bps ?? 0) * 0.4, -10, 20);
    const breakEvenPenalty = item.break_even_hours === null ? 0 : clamp((item.break_even_hours - 24) * 0.4, 0, 25);
    const riskScore = clamp(50 - item.net_edge_bps * 1.3 + breakEvenPenalty, 1, 100);
    const score = clamp(Number((40 + edgeScore + fundingScore - breakEvenPenalty).toFixed(1)), 0, 100);
    const decision = decisionFromScore(score);

    return {
      ...item,
      risk_score: Number(riskScore.toFixed(1)),
      score,
      decision,
      reason: `edge=${item.net_edge_bps.toFixed(2)} bps, risk=${riskScore.toFixed(1)}`,
      execution_ready: true,
      auto_trade_candidate: decision === "future_auto_candidate",
      confidence_score: score
    };
  });
}
