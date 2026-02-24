import "server-only";

export type StrategyPolicyConfig = {
  max_execute_per_tick: number;
  max_attempts_per_tick: number;
  live_xarb_entry_floor_bps: number;
  live_xarb_total_costs_bps: number;
  live_xarb_buffer_bps: number;
  pilot_min_live_gross_edge_bps: number;
  pilot_min_live_net_edge_bps: number;
  pilot_notional_multiplier: number;
  calibration_min_live_gross_edge_bps: number;
  calibration_min_live_net_edge_bps: number;
  calibration_notional_multiplier: number;
  recovery_min_live_gross_edge_bps: number;
  recovery_min_live_net_edge_bps: number;
  recovery_notional_multiplier: number;
  reentry_min_live_gross_edge_bps: number;
  reentry_min_live_net_edge_bps: number;
  reentry_notional_multiplier: number;
  inactivity_min_live_gross_edge_bps: number;
  inactivity_min_live_net_edge_bps: number;
  inactivity_notional_multiplier: number;
  starvation_min_live_gross_edge_bps: number;
  starvation_min_live_net_edge_bps: number;
  starvation_notional_multiplier: number;
  controller_lookback_hours: number;
  controller_min_openings: number;
  controller_long_lookback_days: number;
  controller_short_weight: number;
  controller_long_weight: number;
  controller_min_closed_short: number;
  controller_min_closed_long: number;
  controller_emergency_min_live_gross_edge_bps: number;
  controller_emergency_min_live_net_edge_bps: number;
  controller_emergency_notional_multiplier: number;
};

export const DEFAULT_POLICY_CONFIG: StrategyPolicyConfig = {
  max_execute_per_tick: 2,
  max_attempts_per_tick: 5,
  live_xarb_entry_floor_bps: 1.0,
  live_xarb_total_costs_bps: 10,
  live_xarb_buffer_bps: 1,
  pilot_min_live_gross_edge_bps: -0.5,
  pilot_min_live_net_edge_bps: 0.8,
  pilot_notional_multiplier: 0.25,
  calibration_min_live_gross_edge_bps: 2.0,
  calibration_min_live_net_edge_bps: 0.8,
  calibration_notional_multiplier: 0.08,
  recovery_min_live_gross_edge_bps: 1.2,
  recovery_min_live_net_edge_bps: 0.8,
  recovery_notional_multiplier: 0.1,
  reentry_min_live_gross_edge_bps: 0.9,
  reentry_min_live_net_edge_bps: 0.4,
  reentry_notional_multiplier: 0.08,
  inactivity_min_live_gross_edge_bps: 0.8,
  inactivity_min_live_net_edge_bps: 0.4,
  inactivity_notional_multiplier: 0.06,
  starvation_min_live_gross_edge_bps: 0.2,
  starvation_min_live_net_edge_bps: 0.0,
  starvation_notional_multiplier: 0.04,
  controller_lookback_hours: 3,
  controller_min_openings: 2,
  controller_long_lookback_days: 30,
  controller_short_weight: 0.65,
  controller_long_weight: 0.35,
  controller_min_closed_short: 2,
  controller_min_closed_long: 5,
  controller_emergency_min_live_gross_edge_bps: 0.0,
  controller_emergency_min_live_net_edge_bps: 0.05,
  controller_emergency_notional_multiplier: 0.02
};

const BOUNDS: Record<keyof StrategyPolicyConfig, [number, number]> = {
  max_execute_per_tick: [1, 5],
  max_attempts_per_tick: [1, 10],
  live_xarb_entry_floor_bps: [0, 4],
  live_xarb_total_costs_bps: [6, 16],
  live_xarb_buffer_bps: [0, 3],
  pilot_min_live_gross_edge_bps: [-2, 4],
  pilot_min_live_net_edge_bps: [0.2, 2],
  pilot_notional_multiplier: [0.02, 0.6],
  calibration_min_live_gross_edge_bps: [0.5, 4],
  calibration_min_live_net_edge_bps: [0.2, 2],
  calibration_notional_multiplier: [0.01, 0.3],
  recovery_min_live_gross_edge_bps: [0.2, 3],
  recovery_min_live_net_edge_bps: [0.2, 2],
  recovery_notional_multiplier: [0.01, 0.3],
  reentry_min_live_gross_edge_bps: [0.2, 3],
  reentry_min_live_net_edge_bps: [0.1, 1.5],
  reentry_notional_multiplier: [0.01, 0.3],
  inactivity_min_live_gross_edge_bps: [0.2, 3],
  inactivity_min_live_net_edge_bps: [0.1, 1.5],
  inactivity_notional_multiplier: [0.01, 0.25],
  starvation_min_live_gross_edge_bps: [0, 2],
  starvation_min_live_net_edge_bps: [-0.2, 1],
  starvation_notional_multiplier: [0.01, 0.2],
  controller_lookback_hours: [1, 24],
  controller_min_openings: [1, 6],
  controller_long_lookback_days: [7, 90],
  controller_short_weight: [0.1, 0.9],
  controller_long_weight: [0.1, 0.9],
  controller_min_closed_short: [1, 10],
  controller_min_closed_long: [2, 50],
  controller_emergency_min_live_gross_edge_bps: [-0.2, 1],
  controller_emergency_min_live_net_edge_bps: [-0.1, 0.8],
  controller_emergency_notional_multiplier: [0.005, 0.12]
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function normalizePolicyConfig(input: Partial<StrategyPolicyConfig>): StrategyPolicyConfig {
  const merged = { ...DEFAULT_POLICY_CONFIG, ...input } as StrategyPolicyConfig;
  const out = {} as StrategyPolicyConfig;
  for (const key of Object.keys(DEFAULT_POLICY_CONFIG) as Array<keyof StrategyPolicyConfig>) {
    const [min, max] = BOUNDS[key];
    const raw = Number(merged[key]);
    out[key] = clamp(Number.isFinite(raw) ? raw : DEFAULT_POLICY_CONFIG[key], min, max) as StrategyPolicyConfig[typeof key];
  }

  const weightSum = out.controller_short_weight + out.controller_long_weight;
  if (weightSum > 0) {
    out.controller_short_weight = Number((out.controller_short_weight / weightSum).toFixed(4));
    out.controller_long_weight = Number((out.controller_long_weight / weightSum).toFixed(4));
  }

  out.max_execute_per_tick = Math.round(out.max_execute_per_tick);
  out.max_attempts_per_tick = Math.round(out.max_attempts_per_tick);
  out.controller_lookback_hours = Math.round(out.controller_lookback_hours);
  out.controller_min_openings = Math.round(out.controller_min_openings);
  out.controller_long_lookback_days = Math.round(out.controller_long_lookback_days);
  out.controller_min_closed_short = Math.round(out.controller_min_closed_short);
  out.controller_min_closed_long = Math.round(out.controller_min_closed_long);

  return out;
}

export function boundedStep(
  current: StrategyPolicyConfig,
  next: StrategyPolicyConfig,
  maxPctStep = 0.2
): StrategyPolicyConfig {
  const out = { ...next };
  for (const key of Object.keys(current) as Array<keyof StrategyPolicyConfig>) {
    const c = Number(current[key]);
    const n = Number(next[key]);
    if (!Number.isFinite(c) || !Number.isFinite(n) || c === 0) continue;
    const maxDelta = Math.abs(c) * maxPctStep;
    const delta = n - c;
    if (Math.abs(delta) > maxDelta) {
      out[key] = (c + Math.sign(delta) * maxDelta) as StrategyPolicyConfig[typeof key];
    }
  }
  return normalizePolicyConfig(out);
}
