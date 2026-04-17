import "server-only";
import type { EvaluatedOpportunity } from "@/server/engine/pipeline/model";

export function runWatchlistStep(rows: EvaluatedOpportunity[]) {
  const sorted = rows.slice().sort((a, b) => b.score - a.score);
  const top = sorted
    .filter((r) => r.maker_net_edge_bps >= 1.5)
    .filter((r) => r.confidence_score >= 6)
    .filter((r) => r.persistence_ticks >= 3 || r.lifetime_minutes >= 20)
    .filter((r) => r.consumed_risk_score < 50)
    .filter((r) => r.decision !== "ignore")
    .slice(0, 5);
  const nearMisses = sorted.filter((r) => r.decision === "watch" || r.decision === "strong_watch").slice(0, 8);

  return {
    top,
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
