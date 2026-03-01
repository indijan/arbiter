import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { boundedStep, DEFAULT_POLICY_CONFIG, normalizePolicyConfig, type StrategyPolicyConfig } from "@/server/policy/config";
import { proposePolicyWithAI } from "@/server/policy/proposer";

const CONTROLLER_THROTTLE_MINUTES = 15;
const CANARY_MAX_DRAWDOWN_USD = -2.0;
const CANARY_MIN_EXPECTANCY_USD = 0;
const CANARY_MAX_COLLECT_HOURS_NO_OPENS = 6;
const POST_PROMOTION_HOLD_HOURS = 12;

function nowIso() {
  return new Date().toISOString();
}

type PolicySummary = {
  opensShort: number;
  closedShort: number;
  pnlShort: number;
  expectancyShort: number;
  opensLong: number;
  closedLong: number;
  pnlLong: number;
  expectancyLong: number;
};

type PolicySummaryScope = {
  rolloutId?: string | null;
  configId?: string | null;
};

async function readPolicySummary(
  adminSupabase: SupabaseClient,
  userId: string,
  shortHours: number,
  longDays: number,
  scope?: PolicySummaryScope
): Promise<PolicySummary> {
  const shortSince = new Date(Date.now() - shortHours * 60 * 60 * 1000).toISOString();
  const longSince = new Date(Date.now() - longDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await adminSupabase
    .from("positions")
    .select("entry_ts, exit_ts, realized_pnl_usd, meta")
    .eq("user_id", userId)
    .gte("entry_ts", longSince)
    .limit(5000);

  if (error) throw new Error(error.message);

  let opensShort = 0;
  let closedShort = 0;
  let pnlShort = 0;
  let opensLong = 0;
  let closedLong = 0;
  let pnlLong = 0;

  for (const row of data ?? []) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    if (meta.auto_execute !== true) continue;
    if (scope?.rolloutId && String(meta.policy_rollout_id ?? "") !== scope.rolloutId) continue;
    if (scope?.configId && String(meta.policy_config_id ?? "") !== scope.configId) continue;
    const entryTs = String(row.entry_ts ?? "");
    const exitTs = row.exit_ts ? String(row.exit_ts) : "";

    opensLong += 1;
    if (entryTs >= shortSince) opensShort += 1;

    if (exitTs) {
      const pnl = Number(row.realized_pnl_usd ?? 0);
      if (Number.isFinite(pnl)) {
        closedLong += 1;
        pnlLong += pnl;
        if (exitTs >= shortSince) {
          closedShort += 1;
          pnlShort += pnl;
        }
      }
    }
  }

  return {
    opensShort,
    closedShort,
    pnlShort,
    expectancyShort: closedShort > 0 ? pnlShort / closedShort : 0,
    opensLong,
    closedLong,
    pnlLong,
    expectancyLong: closedLong > 0 ? pnlLong / closedLong : 0
  };
}

function heuristicProposal(current: StrategyPolicyConfig, s: PolicySummary): StrategyPolicyConfig {
  let next = { ...current };

  if (s.opensShort < current.controller_min_openings) {
    next.live_xarb_entry_floor_bps -= 0.15;
    next.inactivity_min_live_net_edge_bps -= 0.05;
    next.controller_emergency_min_live_net_edge_bps -= 0.03;
    next.max_execute_per_tick += 1;
  }

  // If nothing opens at all, force a stronger but bounded exploration step.
  if (s.opensShort === 0 && s.closedShort === 0) {
    next.live_xarb_entry_floor_bps -= 0.25;
    next.inactivity_min_live_net_edge_bps -= 0.1;
    next.controller_emergency_min_live_net_edge_bps -= 0.08;
    next.max_attempts_per_tick += 1;
    next.max_execute_per_tick += 1;
  }

  if (s.expectancyShort <= 0 || s.pnlShort < 0) {
    next.pilot_notional_multiplier *= 0.9;
    next.recovery_notional_multiplier *= 0.9;
    next.inactivity_notional_multiplier *= 0.9;
    next.starvation_notional_multiplier *= 0.9;
    next.controller_emergency_notional_multiplier *= 0.9;
    next.pilot_min_live_net_edge_bps += 0.05;
    next.recovery_min_live_net_edge_bps += 0.05;
  }

  if (s.expectancyLong > 0 && s.opensShort < current.controller_min_openings) {
    next.max_attempts_per_tick += 1;
    next.controller_min_openings = Math.min(current.controller_min_openings + 1, 4);
  }

  return normalizePolicyConfig(next);
}

function starvationProposal(current: StrategyPolicyConfig): StrategyPolicyConfig {
  return normalizePolicyConfig({
    ...current,
    live_xarb_entry_floor_bps: current.live_xarb_entry_floor_bps - 0.5,
    pilot_min_live_net_edge_bps: current.pilot_min_live_net_edge_bps - 0.15,
    recovery_min_live_net_edge_bps: current.recovery_min_live_net_edge_bps - 0.15,
    reentry_min_live_net_edge_bps: current.reentry_min_live_net_edge_bps - 0.12,
    inactivity_min_live_net_edge_bps: current.inactivity_min_live_net_edge_bps - 0.12,
    starvation_min_live_net_edge_bps: current.starvation_min_live_net_edge_bps - 0.08,
    controller_emergency_min_live_net_edge_bps: current.controller_emergency_min_live_net_edge_bps - 0.05,
    max_attempts_per_tick: current.max_attempts_per_tick + 2,
    max_execute_per_tick: current.max_execute_per_tick + 1,
    controller_min_openings: 1
  });
}

function chooseCanaryRatio(summary: PolicySummary) {
  if (summary.opensShort === 0 && summary.closedShort === 0) return 1;
  if (summary.opensShort <= 1) return 0.75;
  if (summary.opensShort <= 2) return 0.5;
  return 0.25;
}

function shouldForceCanaryFullTraffic(summary: PolicySummary) {
  return summary.opensShort === 0 && summary.closedShort === 0;
}

async function readActiveRollout(adminSupabase: SupabaseClient, userId: string) {
  const { data, error } = await adminSupabase
    .from("strategy_policy_rollouts")
    .select("id, config_id, status, canary_ratio, start_ts, metrics")
    .or(`user_id.is.null,user_id.eq.${userId}`)
    .in("status", ["canary", "active"])
    .order("start_ts", { ascending: false })
    .limit(5);

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string;
    config_id: string;
    status: "canary" | "active";
    canary_ratio: number;
    start_ts: string;
    metrics: Record<string, unknown> | null;
  }>;
}

async function readConfigById(adminSupabase: SupabaseClient, id: string) {
  const { data, error } = await adminSupabase
    .from("strategy_policy_configs")
    .select("id, config")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizePolicyConfig((data.config ?? {}) as Partial<StrategyPolicyConfig>);
}

async function insertEvent(
  adminSupabase: SupabaseClient,
  event: { user_id: string; rollout_id?: string; proposal_id?: string; event_type: string; details?: Record<string, unknown> }
) {
  await adminSupabase.from("strategy_policy_events").insert({
    user_id: event.user_id,
    rollout_id: event.rollout_id ?? null,
    proposal_id: event.proposal_id ?? null,
    event_type: event.event_type,
    details: event.details ?? {}
  });
}

async function shouldThrottle(adminSupabase: SupabaseClient, userId: string) {
  const since = new Date(Date.now() - CONTROLLER_THROTTLE_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await adminSupabase
    .from("strategy_policy_events")
    .select("id")
    .eq("user_id", userId)
    .eq("event_type", "controller_cycle")
    .gte("ts", since)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

async function hasRecentPromotionHold(adminSupabase: SupabaseClient, userId: string) {
  const since = new Date(Date.now() - POST_PROMOTION_HOLD_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await adminSupabase
    .from("strategy_policy_events")
    .select("id, ts")
    .eq("user_id", userId)
    .eq("event_type", "rollout_promoted")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function runStrategyPolicyController(adminSupabase: SupabaseClient, userId: string) {
  if (await shouldThrottle(adminSupabase, userId)) {
    return { ok: true, skipped: true, reason: "throttled" };
  }

  const liveRollouts = await readActiveRollout(adminSupabase, userId);
  const active = liveRollouts.find((r) => r.status === "active") ?? null;
  const canary = liveRollouts.find((r) => r.status === "canary") ?? null;
  const recentPromotionHold = await hasRecentPromotionHold(adminSupabase, userId);

  const currentConfig = active
    ? (await readConfigById(adminSupabase, active.config_id)) ?? DEFAULT_POLICY_CONFIG
    : DEFAULT_POLICY_CONFIG;

  const summary = await readPolicySummary(
    adminSupabase,
    userId,
    currentConfig.controller_lookback_hours,
    currentConfig.controller_long_lookback_days,
    active
      ? {
          rolloutId: active.id,
          configId: active.config_id
        }
      : undefined
  );

  await insertEvent(adminSupabase, {
    user_id: userId,
    rollout_id: canary?.id ?? active?.id,
    event_type: "controller_cycle",
    details: {
      summary,
      summary_scope: active
        ? {
            rollout_id: active.id,
            config_id: active.config_id
          }
        : {
            rollout_id: null,
            config_id: null
          },
      recent_promotion_hold: recentPromotionHold,
      active_rollout_id: active?.id ?? null,
      canary_rollout_id: canary?.id ?? null
    }
  });

  if (canary) {
    const canaryConfig = (await readConfigById(adminSupabase, canary.config_id)) ?? currentConfig;
    const canaryEvalHours = Math.max(canaryConfig.controller_lookback_hours, 24);
    const canaryMinClosed = Math.max(1, canaryConfig.controller_min_closed_short);
    const canarySummary = await readPolicySummary(
      adminSupabase,
      userId,
      canaryEvalHours,
      canaryConfig.controller_long_lookback_days,
      {
        rolloutId: canary.id,
        configId: canary.config_id
      }
    );

    const acceleratedPromote =
      canarySummary.closedShort >= 1 &&
      canarySummary.expectancyShort > 0 &&
      canarySummary.pnlShort > 0;

    if (canarySummary.closedShort >= canaryMinClosed || acceleratedPromote) {
      const promote =
        canarySummary.expectancyShort >= CANARY_MIN_EXPECTANCY_USD &&
        canarySummary.pnlShort >= CANARY_MAX_DRAWDOWN_USD;

      if (promote) {
        if (active) {
          await adminSupabase
            .from("strategy_policy_rollouts")
            .update({ status: "rolled_back", end_ts: nowIso() })
            .eq("id", active.id);
        }
        await adminSupabase
          .from("strategy_policy_rollouts")
          .update({ status: "active", canary_ratio: 1, metrics: { summary: canarySummary } })
          .eq("id", canary.id);
        await insertEvent(adminSupabase, {
          user_id: userId,
          rollout_id: canary.id,
          event_type: "rollout_promoted",
          details: {
            summary: canarySummary,
            summary_scope: { rollout_id: canary.id, config_id: canary.config_id },
            accelerated: acceleratedPromote
          }
        });
      } else {
        await adminSupabase
          .from("strategy_policy_rollouts")
          .update({
            status: "failed",
            end_ts: nowIso(),
            metrics: { summary: canarySummary, reason: "canary_guardrail_failed" }
          })
          .eq("id", canary.id);
        await insertEvent(adminSupabase, {
          user_id: userId,
          rollout_id: canary.id,
          event_type: "rollout_failed",
          details: {
            summary: canarySummary,
            summary_scope: { rollout_id: canary.id, config_id: canary.config_id }
          }
        });
      }
      return { ok: true, skipped: false, action: "evaluated_canary", summary };
    }

    const canaryAgeMs = Date.now() - new Date(canary.start_ts).getTime();
    const shouldEscalateCanaryTraffic =
      Number(canary.canary_ratio ?? 0) < 1 &&
      Number.isFinite(canaryAgeMs) &&
      canaryAgeMs >= 90 * 60 * 1000 &&
      canarySummary.opensShort === 0 &&
      canarySummary.closedShort === 0;

    if (shouldEscalateCanaryTraffic) {
      const escalatedRatio = Math.min(1, Math.max(0.75, Number(canary.canary_ratio ?? 0) * 2));
      await adminSupabase
        .from("strategy_policy_rollouts")
        .update({
          canary_ratio: escalatedRatio,
          guardrails: {
            force_canary_full_traffic: escalatedRatio >= 1
          },
          metrics: { summary: canarySummary, action: "canary_ratio_escalated" }
        })
        .eq("id", canary.id);
      await insertEvent(adminSupabase, {
        user_id: userId,
        rollout_id: canary.id,
        event_type: "canary_ratio_escalated",
        details: {
          summary: canarySummary,
          summary_scope: { rollout_id: canary.id, config_id: canary.config_id },
          canary_ratio: escalatedRatio,
          force_canary_full_traffic: escalatedRatio >= 1
        }
      });
      return {
        ok: true,
        skipped: false,
        action: "canary_ratio_escalated",
        summary
      };
    }

    const staleNoOpen =
      Number.isFinite(canaryAgeMs) &&
      canaryAgeMs >= CANARY_MAX_COLLECT_HOURS_NO_OPENS * 60 * 60 * 1000 &&
      canarySummary.opensShort === 0 &&
      canarySummary.closedShort === 0;

    if (staleNoOpen) {
      await adminSupabase
        .from("strategy_policy_rollouts")
        .update({
          status: "failed",
          end_ts: nowIso(),
          metrics: { summary: canarySummary, reason: "canary_stale_no_opens" }
        })
        .eq("id", canary.id);
      await insertEvent(adminSupabase, {
        user_id: userId,
        rollout_id: canary.id,
        event_type: "rollout_failed",
        details: {
          summary: canarySummary,
          summary_scope: { rollout_id: canary.id, config_id: canary.config_id },
          reason: "canary_stale_no_opens"
        }
      });
      // Continue below and propose a new candidate in the same controller cycle.
    } else {
      return { ok: true, skipped: false, action: "canary_collecting", summary };
    }
  }

  if (recentPromotionHold && active) {
    return { ok: true, skipped: false, action: "promotion_hold", summary };
  }

  const starvation = summary.opensShort === 0 && summary.closedShort === 0;
  const heuristic = starvation ? starvationProposal(currentConfig) : heuristicProposal(currentConfig, summary);
  const ai = await proposePolicyWithAI({
    current: currentConfig,
    summary,
    typeExpectancy: {}
  });
  const candidate = ai.proposal ?? heuristic;
  const stepped = boundedStep(currentConfig, candidate, starvation ? 0.6 : 0.2);
  const canaryRatio = chooseCanaryRatio(summary);
  const forceCanaryFullTraffic = shouldForceCanaryFullTraffic(summary);

  const { data: proposal, error: proposalError } = await adminSupabase
    .from("strategy_policy_proposals")
    .insert({
      user_id: userId,
      model: ai.used ? ai.model : "heuristic",
      input_summary: {
        summary,
        ai_raw: ai.raw,
        ai_used: ai.used
      },
      proposed_config: stepped,
      decision: "approved",
      decision_reason: ai.proposal ? "ai_guardrails_passed" : "heuristic_guardrails_passed",
      decided_at: nowIso()
    })
    .select("id")
    .single();

  if (proposalError || !proposal) {
    throw new Error(proposalError?.message ?? "Failed to insert proposal");
  }

  const { data: cfg, error: cfgError } = await adminSupabase
    .from("strategy_policy_configs")
    .insert({
      user_id: userId,
      source: "controller",
      reason: "auto_proposed",
      config: stepped,
      status: "approved",
      approved_at: nowIso()
    })
    .select("id")
    .single();

  if (cfgError || !cfg) {
    throw new Error(cfgError?.message ?? "Failed to insert config");
  }

  const { data: rollout, error: rolloutError } = await adminSupabase
    .from("strategy_policy_rollouts")
    .insert({
      user_id: userId,
      config_id: cfg.id,
      status: "canary",
      canary_ratio: canaryRatio,
      guardrails: {
        force_canary_full_traffic: forceCanaryFullTraffic,
        min_closed_short: Math.max(1, stepped.controller_min_closed_short),
        min_expectancy_usd: CANARY_MIN_EXPECTANCY_USD,
        max_drawdown_usd: CANARY_MAX_DRAWDOWN_USD
      },
      rollback_config_id: active?.config_id ?? null
    })
    .select("id")
    .single();

  if (rolloutError || !rollout) {
    throw new Error(rolloutError?.message ?? "Failed to insert rollout");
  }

  await insertEvent(adminSupabase, {
    user_id: userId,
    rollout_id: rollout.id,
    proposal_id: proposal.id,
    event_type: "rollout_started",
    details: {
      summary,
      config_id: cfg.id,
      canary_ratio: canaryRatio,
      starvation,
      force_canary_full_traffic: forceCanaryFullTraffic
    }
  });

  return { ok: true, skipped: false, action: "started_canary", summary, rollout_id: rollout.id };
}
