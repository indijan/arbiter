import "server-only";

import { laneStateAllowsDetection, laneStateAllowsExecution, type LanePolicyState } from "@/server/lanes/policy";

export type BtcRegime = "btc_neg_strong" | "btc_neg" | "flat" | "btc_pos" | "btc_pos_strong";

export function regimeFromBtcMomentum6hBps(bps: number): BtcRegime {
  if (bps <= -100) return "btc_neg_strong";
  if (bps < 0) return "btc_neg";
  if (bps >= 150) return "btc_pos_strong";
  if (bps > 0) return "btc_pos";
  return "flat";
}

// "Hard" regime policy for basic lanes. This replaces the AI lane policy review/apply loop.
// If you want a lane disabled regardless of regime, use strategy_settings.enabled=false as a kill-switch.
const REGIME_MATRIX: Record<BtcRegime, Record<string, LanePolicyState>> = {
  btc_neg_strong: {
    xrp_shadow_short_core: "standby",
    xrp_shadow_short_bull_fade_canary: "standby",
    avax_shadow_short_canary: "standby",
    sol_shadow_short_soft_bear_laggard: "standby",
    sol_shadow_short_deep_bear_continuation: "active",
    sol_shadow_short_soft_bull_reversal_probe: "standby"
  },
  btc_neg: {
    xrp_shadow_short_core: "active",
    xrp_shadow_short_bull_fade_canary: "standby",
    avax_shadow_short_canary: "standby",
    sol_shadow_short_soft_bear_laggard: "watch",
    sol_shadow_short_deep_bear_continuation: "standby",
    sol_shadow_short_soft_bull_reversal_probe: "standby"
  },
  flat: {
    // In flat regimes we still keep one lane active to avoid "everything is waiting".
    xrp_shadow_short_core: "active",
    xrp_shadow_short_bull_fade_canary: "standby",
    avax_shadow_short_canary: "standby",
    sol_shadow_short_soft_bear_laggard: "standby",
    sol_shadow_short_deep_bear_continuation: "standby",
    sol_shadow_short_soft_bull_reversal_probe: "standby"
  },
  btc_pos: {
    xrp_shadow_short_core: "standby",
    xrp_shadow_short_bull_fade_canary: "watch",
    avax_shadow_short_canary: "standby",
    sol_shadow_short_soft_bear_laggard: "standby",
    sol_shadow_short_deep_bear_continuation: "standby",
    sol_shadow_short_soft_bull_reversal_probe: "active"
  },
  btc_pos_strong: {
    xrp_shadow_short_core: "standby",
    xrp_shadow_short_bull_fade_canary: "active",
    avax_shadow_short_canary: "standby",
    sol_shadow_short_soft_bear_laggard: "standby",
    sol_shadow_short_deep_bear_continuation: "standby",
    sol_shadow_short_soft_bull_reversal_probe: "standby"
  }
};

export function laneRegimeState(strategyKey: string, regime: BtcRegime): LanePolicyState | null {
  return REGIME_MATRIX[regime]?.[strategyKey] ?? null;
}

export function laneAllowsDetectionByRegime(strategyKey: string, regime: BtcRegime) {
  const state = laneRegimeState(strategyKey, regime);
  return state ? laneStateAllowsDetection(state) : false;
}

export function laneAllowsExecutionByRegime(strategyKey: string, regime: BtcRegime) {
  const state = laneRegimeState(strategyKey, regime);
  return state ? laneStateAllowsExecution(state) : false;
}
