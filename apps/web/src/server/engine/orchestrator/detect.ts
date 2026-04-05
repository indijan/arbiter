import "server-only";

import { STRATEGY_PLUGINS } from "@/server/engine/strategies/plugins";
import type { DetectJobSummary, EnginePluginResult, StrategyKey } from "@/server/engine/types";

export type DetectOrchestratorResult = {
  ts: string;
  partial_failures: boolean;
  detect: Record<StrategyKey, DetectJobSummary>;
};

function normalizeFailure(error: string): DetectJobSummary {
  return { inserted: 0, skipped: 0, error };
}

export async function runDetectOrchestrator(params: Record<string, unknown>): Promise<DetectOrchestratorResult> {
  const results = new Map<StrategyKey, EnginePluginResult<DetectJobSummary>>();

  for (const plugin of STRATEGY_PLUGINS) {
    results.set(plugin.key, await plugin.runDetect(params));
  }

  const detect: Record<StrategyKey, DetectJobSummary> = {
    carry_spot_perp: { inserted: 0, skipped: 0 },
    xarb_spot: { inserted: 0, skipped: 0 },
    spread_reversion: { inserted: 0, skipped: 0 },
    relative_strength: { inserted: 0, skipped: 0, near_miss_samples: [] },
    tri_arb: { inserted: 0, skipped: 0 }
  };

  let partial_failures = false;
  for (const [key, res] of results.entries()) {
    if (!res.ok) {
      partial_failures = true;
      detect[key] = normalizeFailure(res.error);
      continue;
    }
    detect[key] = res.data;
  }

  return { ts: new Date().toISOString(), partial_failures, detect };
}

