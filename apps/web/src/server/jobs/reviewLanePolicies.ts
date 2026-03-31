import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";
import { lanePolicyStateFromRow, type LanePolicyState } from "@/server/lanes/policy";

const REVIEW_WINDOW_DAYS = 30;
const RECENT_WINDOW_DAYS = 7;
const BTC_SYMBOL = "BTCUSD";
const EXCHANGE = "coinbase";
const LANE_DEFS = [
  { key: "xrp_shadow_short_core", label: "XRP core short" },
  { key: "xrp_shadow_short_bull_fade_canary", label: "XRP bull fade canary" },
  { key: "avax_shadow_short_canary", label: "AVAX canary short" },
  { key: "sol_shadow_short_soft_bear_laggard", label: "SOL soft-bear laggard" },
  { key: "sol_shadow_short_deep_bear_continuation", label: "SOL deep-bear continuation" }
] as const;

type LaneKey = (typeof LANE_DEFS)[number]["key"];
type ReviewRecommendation = {
  strategy_key: LaneKey;
  label: string;
  current_state: LanePolicyState;
  recommended_state: LanePolicyState;
  reason: string;
  confidence: number;
};

type ReviewSummaryLane = {
  strategy_key: LaneKey;
  label: string;
  current_state: LanePolicyState;
  regime_state: LanePolicyState;
  closed_7d: number;
  closed_30d: number;
  open_count: number;
  pnl_7d_usd: number;
  pnl_30d_usd: number;
  expectancy_7d_usd: number;
  expectancy_30d_usd: number;
};

type ReviewPayload = {
  current_btc_regime: string;
  current_btc_momentum_6h_bps: number;
  lanes: ReviewSummaryLane[];
};

function asNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function currentRegimeStateForLane(label: string, regime: string): LanePolicyState {
  const matrix: Record<string, Record<string, LanePolicyState>> = {
    btc_neg_strong: {
      "XRP core short": "standby",
      "XRP bull fade canary": "standby",
      "AVAX canary short": "standby",
      "SOL soft-bear laggard": "standby",
      "SOL deep-bear continuation": "active"
    },
    btc_neg: {
      "XRP core short": "active",
      "XRP bull fade canary": "standby",
      "AVAX canary short": "standby",
      "SOL soft-bear laggard": "watch",
      "SOL deep-bear continuation": "standby"
    },
    btc_pos: {
      "XRP core short": "standby",
      "XRP bull fade canary": "watch",
      "AVAX canary short": "watch",
      "SOL soft-bear laggard": "standby",
      "SOL deep-bear continuation": "standby"
    },
    btc_pos_strong: {
      "XRP core short": "standby",
      "XRP bull fade canary": "active",
      "AVAX canary short": "active",
      "SOL soft-bear laggard": "standby",
      "SOL deep-bear continuation": "standby"
    }
  };

  return matrix[regime]?.[label] ?? "standby";
}

function bucketHour(ts: string) {
  return new Date(Math.floor(Date.parse(ts) / 3600000) * 3600000).toISOString();
}

function regimeFromBtcMomentum(bps: number) {
  if (bps <= -100) return "btc_neg_strong";
  if (bps < 0) return "btc_neg";
  if (bps >= 150) return "btc_pos_strong";
  if (bps > 0) return "btc_pos";
  return "flat";
}

function heuristicRecommendation(lane: ReviewSummaryLane): ReviewRecommendation {
  let recommended = lane.regime_state;
  let reason = `Regime baseline: ${lane.regime_state}`;
  let confidence = 0.62;

  if (lane.regime_state === "active" || lane.regime_state === "watch") {
    if (lane.closed_7d >= 2 && lane.pnl_7d_usd < 0 && lane.expectancy_7d_usd < 0) {
      recommended = lane.regime_state === "active" ? "watch" : "standby";
      reason = "Recent 7d underperformance vs regime baseline";
      confidence = 0.78;
    }
    if (lane.closed_30d >= 4 && lane.pnl_30d_usd < 0 && lane.expectancy_30d_usd < 0) {
      recommended = "standby";
      reason = "30d lane expectancy is negative";
      confidence = 0.84;
    }
  }

  if (lane.regime_state === "standby" && lane.closed_30d >= 4 && lane.pnl_30d_usd > 0 && lane.expectancy_30d_usd > 0.2) {
    recommended = "watch";
    reason = "Historical lane performance suggests observation-worthy candidate";
    confidence = 0.67;
  }

  return {
    strategy_key: lane.strategy_key,
    label: lane.label,
    current_state: lane.current_state,
    recommended_state: recommended,
    reason,
    confidence
  };
}

function extractJsonObject(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function proposeLaneReviewWithAI(input: ReviewPayload) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_LANE_POLICY_MODEL ?? process.env.OPENAI_POLICY_MODEL ?? "gpt-5.1";

  if (!apiKey) {
    return { used: false, model, raw: "missing_api_key", recommendations: null as ReviewRecommendation[] | null };
  }

  const payload = {
    objective:
      "Recommend lane policy states for a crypto trading system. Prefer conservative lane state changes. Downgrade underperforming lanes before suggesting aggressive activation.",
    allowed_states: ["active", "watch", "standby", "paused"],
    rules: [
      "Use current BTC regime as baseline.",
      "Prefer watch before active when evidence is mixed.",
      "Temporary pause only for clearly broken lanes or manual override style situations.",
      "Do not invent unknown strategy keys."
    ],
    input
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Return only strict JSON with keys `summary` and `recommendations`. `recommendations` must be an array of objects containing strategy_key, recommended_state, reason, confidence."
        },
        {
          role: "user",
          content: JSON.stringify(payload)
        }
      ],
      temperature: 0.1,
      max_tokens: 900
    })
  });

  if (!response.ok) {
    return { used: true, model, raw: `http_${response.status}`, recommendations: null as ReviewRecommendation[] | null };
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = extractJsonObject(content);
  const rows = Array.isArray(parsed?.recommendations) ? parsed?.recommendations : [];

  const recommendations = rows
    .map((row) => {
      const strategyKey = String((row as Record<string, unknown>).strategy_key ?? "") as LaneKey;
      const def = LANE_DEFS.find((item) => item.key === strategyKey);
      const nextState = String((row as Record<string, unknown>).recommended_state ?? "");
      if (!def) return null;
      if (!["active", "watch", "standby", "paused"].includes(nextState)) return null;
      const currentLane = input.lanes.find((lane) => lane.strategy_key === strategyKey);
      return {
        strategy_key: strategyKey,
        label: def.label,
        current_state: currentLane?.current_state ?? "paused",
        recommended_state: nextState as LanePolicyState,
        reason: String((row as Record<string, unknown>).reason ?? "").trim() || "AI recommendation",
        confidence: Math.max(0, Math.min(1, asNumber((row as Record<string, unknown>).confidence ?? 0.5)))
      } satisfies ReviewRecommendation;
    })
    .filter(Boolean) as ReviewRecommendation[];

  return { used: true, model, raw: content || "ok", recommendations };
}

export type ReviewLanePoliciesResult = {
  review_id: string | null;
  current_btc_regime: string;
  current_btc_momentum_6h_bps: number;
  recommendations_count: number;
  used_ai: boolean;
  model: string | null;
};

export async function reviewLanePolicies(): Promise<ReviewLanePoliciesResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) throw new Error("Missing service role key.");

  const { data: account, error: accountError } = await adminSupabase
    .from("paper_accounts")
    .select("user_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (accountError) throw new Error(accountError.message);
  if (!account?.user_id) {
    return {
      review_id: null,
      current_btc_regime: "flat",
      current_btc_momentum_6h_bps: 0,
      recommendations_count: 0,
      used_ai: false,
      model: null
    };
  }

  const userId = account.user_id;
  const sinceSnapshots = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const { data: btcRows, error: btcError } = await adminSupabase
    .from("market_snapshots")
    .select("ts, spot_bid, spot_ask")
    .eq("exchange", EXCHANGE)
    .eq("symbol", BTC_SYMBOL)
    .gte("ts", sinceSnapshots)
    .order("ts", { ascending: true })
    .limit(1000);
  if (btcError) throw new Error(btcError.message);

  const btcHourly = new Map<string, number>();
  for (const row of btcRows ?? []) {
    const bid = asNumber(row.spot_bid);
    const ask = asNumber(row.spot_ask);
    if (!(ask > bid) || bid <= 0) continue;
    btcHourly.set(bucketHour(String(row.ts)), (bid + ask) / 2);
  }
  const btcHours = Array.from(btcHourly.keys()).sort();
  const latestHour = btcHours[btcHours.length - 1] ?? null;
  const lookbackHour = btcHours.length >= 7 ? btcHours[btcHours.length - 7] : null;
  const latestMid = latestHour ? btcHourly.get(latestHour) ?? 0 : 0;
  const lookbackMid = lookbackHour ? btcHourly.get(lookbackHour) ?? 0 : 0;
  const btcMomentum =
    latestMid > 0 && lookbackMid > 0 ? ((latestMid - lookbackMid) / lookbackMid) * 10000 : 0;
  const currentBtcRegime = regimeFromBtcMomentum(btcMomentum);

  const since30d = new Date(Date.now() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: positions, error: positionsError }, { data: settingsRows, error: settingsError }] =
    await Promise.all([
      adminSupabase
        .from("positions")
        .select("status, exit_ts, realized_pnl_usd, meta")
        .eq("user_id", userId)
        .gte("entry_ts", since30d)
        .limit(2000),
      adminSupabase
        .from("strategy_settings")
        .select("strategy_key, enabled, config")
        .eq("user_id", userId)
        .in("strategy_key", LANE_DEFS.map((lane) => lane.key))
    ]);
  if (positionsError) throw new Error(positionsError.message);
  if (settingsError) throw new Error(settingsError.message);

  const settingsMap = new Map(
    ((settingsRows ?? []) as Array<{ strategy_key: string; enabled: boolean; config?: Record<string, unknown> | null }>).map((row) => [
      row.strategy_key,
      row
    ])
  );

  const laneSummaries: ReviewSummaryLane[] = LANE_DEFS.map((lane) => {
    const laneRows = (positions ?? []).filter(
      (row) =>
        row.meta &&
        row.meta.relative_strength_open === true &&
        String(row.meta.strategy_variant ?? "") === lane.key
    );
    const closed30d = laneRows.filter((row) => row.status === "closed");
    const closed7d = closed30d.filter((row) => String(row.exit_ts ?? "") >= since7d);
    const pnl30d = closed30d.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
    const pnl7d = closed7d.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
    return {
      strategy_key: lane.key,
      label: lane.label,
      current_state: lanePolicyStateFromRow(settingsMap.get(lane.key)),
      regime_state: currentRegimeStateForLane(lane.label, currentBtcRegime),
      closed_7d: closed7d.length,
      closed_30d: closed30d.length,
      open_count: laneRows.filter((row) => row.status === "open").length,
      pnl_7d_usd: Number(pnl7d.toFixed(4)),
      pnl_30d_usd: Number(pnl30d.toFixed(4)),
      expectancy_7d_usd: Number((closed7d.length > 0 ? pnl7d / closed7d.length : 0).toFixed(4)),
      expectancy_30d_usd: Number((closed30d.length > 0 ? pnl30d / closed30d.length : 0).toFixed(4))
    };
  });

  const input: ReviewPayload = {
    current_btc_regime: currentBtcRegime,
    current_btc_momentum_6h_bps: Number(btcMomentum.toFixed(4)),
    lanes: laneSummaries
  };

  const ai = await proposeLaneReviewWithAI(input);
  const recommendations =
    ai.recommendations && ai.recommendations.length > 0
      ? ai.recommendations
      : laneSummaries.map((lane) => heuristicRecommendation(lane));

  const { data: inserted, error: insertError } = await adminSupabase
    .from("lane_policy_reviews")
    .insert({
      user_id: userId,
      current_btc_regime: currentBtcRegime,
      current_btc_momentum_6h_bps: Number(btcMomentum.toFixed(4)),
      review_window_days: REVIEW_WINDOW_DAYS,
      model: ai.model,
      used_ai: ai.used && Boolean(ai.recommendations && ai.recommendations.length > 0),
      status: "proposed",
      summary: input,
      recommendations,
      raw: ai.raw
    })
    .select("id")
    .single();

  if (insertError) throw new Error(insertError.message);

  return {
    review_id: inserted?.id ?? null,
    current_btc_regime: currentBtcRegime,
    current_btc_momentum_6h_bps: Number(btcMomentum.toFixed(4)),
    recommendations_count: recommendations.length,
    used_ai: ai.used && Boolean(ai.recommendations && ai.recommendations.length > 0),
    model: ai.model
  };
}
