import "server-only";

export type EngineLayer = "data" | "strategy" | "evaluation" | "execution";

export type StrategyKey =
  | "carry_spot_perp"
  | "xarb_spot"
  | "spread_reversion"
  | "relative_strength"
  | "tri_arb";

export type EnginePluginResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type DetectJobSummary = {
  inserted: number;
  skipped?: number;
  watchlist?: number;
  near_miss_samples?: unknown[];
  error?: string;
};

