import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { DEFAULT_POLICY_CONFIG, normalizePolicyConfig, type StrategyPolicyConfig } from "@/server/policy/config";

type RolloutRow = {
  id: string;
  user_id: string | null;
  config_id: string;
  status: "canary" | "active" | "rolled_back" | "failed";
  canary_ratio: number;
  start_ts: string;
  guardrails: Record<string, unknown> | null;
};

type ConfigRow = {
  id: string;
  config: Record<string, unknown> | null;
};

export type EffectivePolicy = {
  rollout_id: string | null;
  config_id: string | null;
  policy: StrategyPolicyConfig;
  is_canary: boolean;
  rollout_status: string;
};

function hashBucket(input: string) {
  const hex = createHash("sha256").update(input).digest("hex").slice(0, 12);
  const value = Number.parseInt(hex, 16);
  return (value % 10000) / 10000;
}

async function hasRecentPromotionHold(adminSupabase: SupabaseClient, userId: string, hours = 12) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await adminSupabase
    .from("strategy_policy_events")
    .select("id")
    .eq("user_id", userId)
    .eq("event_type", "rollout_promoted")
    .gte("ts", since)
    .limit(1);
  if (error) {
    return false;
  }
  return (data ?? []).length > 0;
}

export async function loadEffectivePolicy(
  adminSupabase: SupabaseClient,
  userId: string
): Promise<EffectivePolicy> {
  const recentPromotionHold = await hasRecentPromotionHold(adminSupabase, userId);
  const { data: rollouts, error } = await adminSupabase
    .from("strategy_policy_rollouts")
    .select("id, user_id, config_id, status, canary_ratio, start_ts, guardrails")
    .in("status", ["canary", "active"])
    .order("start_ts", { ascending: false })
    .limit(10);

  if (error || !rollouts || rollouts.length === 0) {
    return {
      rollout_id: null,
      config_id: null,
      policy: DEFAULT_POLICY_CONFIG,
      is_canary: false,
      rollout_status: "default"
    };
  }

  const scoped = (rollouts as RolloutRow[]).filter((r) => r.user_id === null || r.user_id === userId);
  if (scoped.length === 0) {
    return {
      rollout_id: null,
      config_id: null,
      policy: DEFAULT_POLICY_CONFIG,
      is_canary: false,
      rollout_status: "default"
    };
  }

  const canary = scoped.find((r) => r.status === "canary");
  const active = scoped.find((r) => r.status === "active");

  let selected: RolloutRow | null = active ?? null;
  let canarySelected = false;
  if (canary) {
    const forceCanaryFullTraffic = canary.guardrails?.force_canary_full_traffic === true;
    if (!active || forceCanaryFullTraffic) {
      // No active rollout yet: canary must be the effective policy.
      selected = canary;
      canarySelected = true;
    } else {
      const bucket = hashBucket(`${userId}:${canary.id}`);
      if (bucket < Number(canary.canary_ratio ?? 0)) {
        selected = canary;
        canarySelected = true;
      }
    }
  }

  if (!selected) {
    return {
      rollout_id: null,
      config_id: null,
      policy: DEFAULT_POLICY_CONFIG,
      is_canary: false,
      rollout_status: "default"
    };
  }

  const { data: cfg, error: cfgError } = await adminSupabase
    .from("strategy_policy_configs")
    .select("id, config")
    .eq("id", selected.config_id)
    .maybeSingle();

  if (cfgError || !cfg) {
    return {
      rollout_id: selected.id,
      config_id: selected.config_id,
      policy: DEFAULT_POLICY_CONFIG,
      is_canary: canarySelected,
      rollout_status: selected.status
    };
  }

  const policy = normalizePolicyConfig((cfg as ConfigRow).config ?? {});
  const boostedPolicy =
    selected.status === "active" && recentPromotionHold
      ? normalizePolicyConfig({
          ...policy,
          max_attempts_per_tick: policy.max_attempts_per_tick + 1,
          max_execute_per_tick: policy.max_execute_per_tick + 1
        })
      : policy;
  return {
    rollout_id: selected.id,
    config_id: selected.config_id,
    policy: boostedPolicy,
    is_canary: canarySelected,
    rollout_status: selected.status
  };
}
