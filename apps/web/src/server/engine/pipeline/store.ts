import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server-admin";
import type { EvaluatedOpportunity } from "@/server/engine/pipeline/model";

export async function runStoreStep(params: {
  ingestInserted: number;
  ingestSkipped: number;
  ingestErrors: string[];
  strategyInserted: Record<string, number>;
  evaluated: EvaluatedOpportunity[];
  top: EvaluatedOpportunity[];
  nearMisses: EvaluatedOpportunity[];
}) {
  const admin = createAdminSupabase();
  if (!admin) throw new Error("Missing service role key.");

  const payload = {
    ingest_errors: params.ingestErrors.length,
    ingest_errors_json: params.ingestErrors,
    detect_summary: {
      pipeline: "ingest->validate->strategies->evaluate->watchlist->store",
      ingest: {
        inserted: params.ingestInserted,
        skipped: params.ingestSkipped
      },
      strategies: params.strategyInserted,
      evaluation: {
        evaluated: params.evaluated.length,
        top_count: params.top.length,
        near_miss_count: params.nearMisses.length
      },
      watchlist: params.top.map((x) => ({
        opportunity_id: x.opportunity_id,
        strategy: x.strategy,
        symbol: x.symbol,
        score: x.score,
        decision: x.decision
      })),
      near_misses: params.nearMisses.map((x) => ({
        opportunity_id: x.opportunity_id,
        strategy: x.strategy,
        symbol: x.symbol,
        score: x.score,
        decision: x.decision
      }))
    }
  };

  const { error } = await admin.from("system_ticks").insert(payload);
  if (error) throw new Error(error.message);
}
