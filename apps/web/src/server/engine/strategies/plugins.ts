import "server-only";

import type { DetectJobSummary, EnginePluginResult, StrategyKey } from "@/server/engine/types";
import { detectCarry } from "@/server/jobs/detectCarry";
import { detectCrossExchangeSpot } from "@/server/jobs/detectCrossExchangeSpot";
import { detectSpreadReversion } from "@/server/jobs/detectSpreadReversion";
import { detectRelativeStrength } from "@/server/jobs/detectRelativeStrength";
import { detectTriangular } from "@/server/jobs/detectTriangular";

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
    key: "carry_spot_perp",
    label: "Spot-perp carry",
    layer: "strategy",
    runDetect: async (params) => {
      const holding_hours =
        typeof params?.holding_hours === "number"
          ? params.holding_hours
          : typeof params?.holding_hours === "string"
            ? Number(params.holding_hours)
            : undefined;
      return wrap(async () => (await detectCarry({ holding_hours })) as unknown as DetectJobSummary);
    }
  },
  {
    key: "xarb_spot",
    label: "Cross-exchange spot arb",
    layer: "strategy",
    runDetect: async () => wrap(async () => (await detectCrossExchangeSpot()) as unknown as DetectJobSummary)
  },
  {
    key: "spread_reversion",
    label: "Spread reversion",
    layer: "strategy",
    runDetect: async () => wrap(async () => (await detectSpreadReversion()) as unknown as DetectJobSummary)
  },
  {
    key: "relative_strength",
    label: "Relative strength lanes",
    layer: "strategy",
    runDetect: async () => wrap(async () => (await detectRelativeStrength()) as unknown as DetectJobSummary)
  },
  {
    key: "tri_arb",
    label: "Triangular arb",
    layer: "strategy",
    runDetect: async () => wrap(async () => (await detectTriangular()) as unknown as DetectJobSummary)
  }
];
