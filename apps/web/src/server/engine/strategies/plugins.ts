import "server-only";

import type { DetectJobSummary, EnginePluginResult, StrategyKey } from "@/server/engine/types";
import { detectRelativeStrength } from "@/server/jobs/detectRelativeStrength";

export type StrategyPlugin = {
  key: StrategyKey;
  label: string;
  layer: "strategy";
  runDetect: (params: Record<string, unknown>) => Promise<EnginePluginResult<DetectJobSummary>>;
};

async function wrap<T>(fn: () => Promise<T>): Promise<EnginePluginResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown strategy error" };
  }
}

export const STRATEGY_PLUGINS: StrategyPlugin[] = [
  {
    key: "relative_strength",
    label: "Relative strength lanes",
    layer: "strategy",
    runDetect: async () => wrap(async () => (await detectRelativeStrength()) as unknown as DetectJobSummary)
  }
];
