import "server-only";
import type { EvaluatedOpportunity } from "@/server/engine/pipeline/model";

export function runWatchlistStep(rows: EvaluatedOpportunity[]) {
  const sorted = rows.slice().sort((a, b) => b.score - a.score);
  const topMarket = sorted
    .filter((r) => r.decision_capable_market_signal)
    .filter((row, index, list) => !row.regime_key || list.findIndex((item) => item.regime_key === row.regime_key) === index)
    .slice(0, 3);
  const topExecution = sorted
    .filter((r) => r.decision_capable_execution_signal || r.execution_recommendation_state === "conditional_execution")
    .slice(0, 3);
  const top = [...topExecution, ...topMarket]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const nearTop = sorted
    .filter((r) => !r.qualified_for_top_list)
    .filter((r) => r.decision_support_state === "near_decision_capable" || r.qualified_for_decision_capable)
    .slice(0, 5);
  const nearMisses = sorted.filter((r) => r.decision === "watch" || r.decision === "strong_watch").slice(0, 8);

  return {
    top,
    topMarket,
    topExecution,
    nearTop,
    nearMisses,
    counts: rows.reduce(
      (acc, row) => {
        acc[row.decision] += 1;
        return acc;
      },
      {
        ignore: 0,
        watch: 0,
        strong_watch: 0,
        paper_candidate: 0,
        future_auto_candidate: 0
      }
    )
  };
}
