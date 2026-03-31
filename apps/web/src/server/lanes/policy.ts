export const LANE_POLICY_STATES = ["active", "watch", "standby", "paused"] as const;

export type LanePolicyState = (typeof LANE_POLICY_STATES)[number];

type StrategySettingsRow = {
  strategy_key: string | null;
  enabled: boolean | null;
  config?: Record<string, unknown> | null;
};

function normalizeLanePolicyState(value: unknown): LanePolicyState | null {
  if (typeof value !== "string") return null;
  return (LANE_POLICY_STATES as readonly string[]).includes(value)
    ? (value as LanePolicyState)
    : null;
}

export function lanePolicyStateFromRow(row: StrategySettingsRow | null | undefined): LanePolicyState {
  const explicit = normalizeLanePolicyState(row?.config?.state);
  if (explicit) return explicit;
  return row?.enabled === false ? "paused" : "active";
}

export function lanePolicyStateFromSettingsMap(
  settingsMap: Map<string, StrategySettingsRow>,
  strategyKey: string
): LanePolicyState {
  return lanePolicyStateFromRow(settingsMap.get(strategyKey));
}

export function laneStateAllowsDetection(state: LanePolicyState) {
  return state === "active" || state === "watch";
}

export function laneStateAllowsExecution(state: LanePolicyState) {
  return state === "active";
}

export function buildStrategySettingsMap(rows: StrategySettingsRow[] | null | undefined) {
  return new Map(
    (rows ?? []).map((row) => [
      String(row.strategy_key),
      {
        strategy_key: String(row.strategy_key),
        enabled: Boolean(row.enabled),
        config: row.config ?? {}
      }
    ])
  );
}
