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
  { key: "sol_shadow_short_deep_bear_continuation", label: "SOL deep-bear continuation" },
  { key: "sol_shadow_short_soft_bull_reversal_probe", label: "SOL soft-bull reversal probe" }
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

type CandidatePolicySummary = {
  id?: string;
  symbol: string;
  label: string;
  regime: string;
  why: string;
  rule_hint: string;
  rule_config?: Record<string, unknown>;
  priority: "high" | "medium";
  trade_count: number;
  pnl_30d_usd: number;
  expectancy_30d_usd: number;
  status?: "candidate" | "validated" | "canary" | "rejected";
};

type ReviewPayload = {
  current_btc_regime: string;
  current_btc_momentum_6h_bps: number;
  lanes: ReviewSummaryLane[];
};

type ReviewSummary = {
  market_label: string;
  opening_expectation: string;
  operator_message: string;
  next_action: string;
  news_risk_message: string | null;
  active_now_count: number;
  watch_now_count: number;
  standby_now_count: number;
  paused_now_count: number;
  active_after_apply_count: number;
  watch_after_apply_count: number;
  standby_after_apply_count: number;
  paused_after_apply_count: number;
  candidate_policies: CandidatePolicySummary[];
};

type OpenAIResponsesApiResult = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
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
      "AVAX canary short": "standby",
      "SOL soft-bear laggard": "standby",
      "SOL deep-bear continuation": "standby",
      "SOL soft-bull reversal probe": "active"
    },
    btc_pos_strong: {
      "XRP core short": "standby",
      "XRP bull fade canary": "active",
      "AVAX canary short": "standby",
      "SOL soft-bear laggard": "standby",
      "SOL deep-bear continuation": "standby",
      "SOL soft-bull reversal probe": "standby"
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

function regimeHumanLabel(regime: string) {
  if (regime === "btc_neg_strong") return "Erősen eső piac";
  if (regime === "btc_neg") return "Enyhén eső piac";
  if (regime === "btc_pos") return "Enyhén emelkedő piac";
  if (regime === "btc_pos_strong") return "Erősen emelkedő piac";
  return "Oldalazó vagy bizonytalan piac";
}

function countStates(states: LanePolicyState[]) {
  return {
    active: states.filter((state) => state === "active").length,
    watch: states.filter((state) => state === "watch").length,
    standby: states.filter((state) => state === "standby").length,
    paused: states.filter((state) => state === "paused").length
  };
}

const CANDIDATE_POLICY_LIBRARY = {
  btc_neg_strong: [
    {
      symbol: "XRP",
      label: "XRP deep-bear continuation",
      why: "Erős eső piacon az XRP-nek külön deep-bear short policy kellhet, ha a meglévő core lane túl óvatos.",
      rule_hint: "BTC -200..-100, XRP 6h erősen negatív, XRP 2h negatív, spread közel semleges.",
      rule_config: {
        symbol: "XRPUSD",
        direction: "short",
        hold_seconds: 14400,
        min_btc_6h_bps: -200,
        max_btc_6h_bps: -100,
        max_alt_6h_bps: -80,
        max_alt_2h_bps: -20,
        min_spread_bps: -20,
        max_spread_bps: 30
      },
      priority: "high" as const,
      matches: (meta: Record<string, unknown>) => {
        const btc = asNumber(meta.btc_momentum_6h_bps);
        const alt6h = asNumber(meta.momentum_6h_bps);
        const alt2h = asNumber(meta.momentum_2h_bps);
        const spread = asNumber(meta.spread_bps);
        const symbol = String(meta.symbol ?? "");
        return symbol === "XRPUSD" && btc >= -200 && btc < -100 && alt6h <= -80 && alt2h <= -20 && spread >= -20 && spread < 30;
      }
    },
    {
      symbol: "AVAX",
      label: "AVAX deep-bear continuation",
      why: "Erős eső piacon az AVAX is kaphat külön folytató short lane-t, nem csak bull fade-et.",
      rule_hint: "BTC mélyen negatív, AVAX 6h és 2h is eső, spread nem túl pozitív.",
      rule_config: {
        symbol: "AVAXUSD",
        direction: "short",
        hold_seconds: 14400,
        max_btc_6h_bps: -120,
        max_alt_6h_bps: -70,
        max_alt_2h_bps: -20,
        min_spread_bps: -25,
        max_spread_bps: 25
      },
      priority: "medium" as const,
      matches: (meta: Record<string, unknown>) => {
        const btc = asNumber(meta.btc_momentum_6h_bps);
        const alt6h = asNumber(meta.momentum_6h_bps);
        const alt2h = asNumber(meta.momentum_2h_bps);
        const spread = asNumber(meta.spread_bps);
        const symbol = String(meta.symbol ?? "");
        return symbol === "AVAXUSD" && btc < -120 && alt6h <= -70 && alt2h <= -20 && spread >= -25 && spread < 25;
      }
    }
  ],
  btc_neg: [
    {
      symbol: "AVAX",
      label: "AVAX soft-bear laggard",
      why: "Enyhén eső piacon érdemes keresni, hogy az AVAX lemaradó shortként működik-e.",
      rule_hint: "BTC -100..0, AVAX gyengébb a kosárnál, 2h ne legyen túl pozitív.",
      rule_config: {
        symbol: "AVAXUSD",
        direction: "short",
        hold_seconds: 14400,
        min_btc_6h_bps: -100,
        max_btc_6h_bps: 0,
        max_alt_2h_bps: 25,
        max_spread_bps: 0
      },
      priority: "high" as const,
      matches: (meta: Record<string, unknown>) => {
        const btc = asNumber(meta.btc_momentum_6h_bps);
        const alt2h = asNumber(meta.momentum_2h_bps);
        const spread = asNumber(meta.spread_bps);
        const symbol = String(meta.symbol ?? "");
        return symbol === "AVAXUSD" && btc >= -100 && btc < 0 && alt2h < 25 && spread < 0;
      }
    },
    {
      symbol: "SOL",
      label: "SOL soft-bear momentum fade",
      why: "A mostani SOL laggard lane mellé érdemes egy alternatív, kevésbé szigorú soft-bear policy-t keresni.",
      rule_hint: "BTC enyhén negatív, SOL 6h negatív, spread enyhén negatív vagy semleges.",
      rule_config: {
        symbol: "SOLUSD",
        direction: "short",
        hold_seconds: 14400,
        min_btc_6h_bps: -100,
        max_btc_6h_bps: 0,
        max_alt_6h_bps: 0,
        min_spread_bps: -30,
        max_spread_bps: 15
      },
      priority: "medium" as const,
      matches: (meta: Record<string, unknown>) => {
        const btc = asNumber(meta.btc_momentum_6h_bps);
        const alt6h = asNumber(meta.momentum_6h_bps);
        const spread = asNumber(meta.spread_bps);
        const symbol = String(meta.symbol ?? "");
        return symbol === "SOLUSD" && btc >= -100 && btc < 0 && alt6h < 0 && spread >= -30 && spread < 15;
      }
    }
  ],
  btc_pos: [
    {
      symbol: "XRP",
      label: "XRP soft-bull fade",
      why: "Enyhén emelkedő piacon az XRP bull-fade lane lehet túl szigorú, ezért kellhet egy lazább változat.",
      rule_hint: "BTC 0..150, XRP 2h pozitív, spread mérsékelten negatív.",
      rule_config: {
        symbol: "XRPUSD",
        direction: "short",
        hold_seconds: 14400,
        min_btc_6h_bps: 0,
        max_btc_6h_bps: 150,
        min_alt_2h_bps: 10,
        max_spread_bps: -20
      },
      priority: "high" as const,
      matches: (meta: Record<string, unknown>) => {
        const btc = asNumber(meta.btc_momentum_6h_bps);
        const alt2h = asNumber(meta.momentum_2h_bps);
        const spread = asNumber(meta.spread_bps);
        const symbol = String(meta.symbol ?? "");
        return symbol === "XRPUSD" && btc > 0 && btc < 150 && alt2h > 10 && spread <= -20;
      }
    },
    {
      symbol: "AVAX",
      label: "AVAX soft-bull active fade",
      why: "Soft bull alatt az AVAX-hoz kellhet külön aktív lane, nem csak watch.",
      rule_hint: "BTC enyhén pozitív, AVAX relatív erős, spread közepesen pozitív.",
      rule_config: {
        symbol: "AVAXUSD",
        direction: "short",
        hold_seconds: 14400,
        min_btc_6h_bps: 0,
        max_btc_6h_bps: 150,
        min_spread_bps: 20
      },
      priority: "high" as const,
      matches: (meta: Record<string, unknown>) => {
        const btc = asNumber(meta.btc_momentum_6h_bps);
        const spread = asNumber(meta.spread_bps);
        const symbol = String(meta.symbol ?? "");
        return symbol === "AVAXUSD" && btc > 0 && btc < 150 && spread >= 20;
      }
    },
    {
      symbol: "SOL",
      label: "SOL soft-bull reversal probe",
      why: "Soft bull alatt a SOL-hoz jelenleg nincs aktív policy, ezért érdemes külön jelöltet keresni.",
      rule_hint: "BTC enyhén pozitív, SOL rövid távon kifeszített vagy gyenge visszapattanó után shortolható.",
      rule_config: {
        symbol: "SOLUSD",
        direction: "short",
        hold_seconds: 14400,
        min_btc_6h_bps: 0,
        max_btc_6h_bps: 150,
        min_alt_2h_bps: 5,
        min_spread_bps: -15,
        max_spread_bps: 25
      },
      priority: "medium" as const,
      matches: (meta: Record<string, unknown>) => {
        const btc = asNumber(meta.btc_momentum_6h_bps);
        const alt2h = asNumber(meta.momentum_2h_bps);
        const spread = asNumber(meta.spread_bps);
        const symbol = String(meta.symbol ?? "");
        return symbol === "SOLUSD" && btc > 0 && btc < 150 && alt2h > 5 && spread >= -15 && spread < 25;
      }
    }
  ],
  btc_pos_strong: [
    {
      symbol: "SOL",
      label: "SOL strong-bull fade",
      why: "Erősen emelkedő piacon a SOL-hoz is kellhet külön eufória-fade lane.",
      rule_hint: "BTC erősen pozitív, SOL 6h és 2h erős, spread magas.",
      rule_config: {
        symbol: "SOLUSD",
        direction: "short",
        hold_seconds: 14400,
        min_btc_6h_bps: 150,
        min_alt_6h_bps: 50,
        min_alt_2h_bps: 25,
        min_spread_bps: 40
      },
      priority: "high" as const,
      matches: (meta: Record<string, unknown>) => {
        const btc = asNumber(meta.btc_momentum_6h_bps);
        const alt6h = asNumber(meta.momentum_6h_bps);
        const alt2h = asNumber(meta.momentum_2h_bps);
        const spread = asNumber(meta.spread_bps);
        const symbol = String(meta.symbol ?? "");
        return symbol === "SOLUSD" && btc >= 150 && alt6h >= 50 && alt2h >= 25 && spread >= 40;
      }
    },
    {
      symbol: "XRP",
      label: "XRP strong-bull acceleration fade",
      why: "Erős bull rezsimben az XRP-hoz a mostaninál agresszívebb bull-fade policy is indokolt lehet.",
      rule_hint: "BTC >= 150, XRP 2h és spread magasabb küszöbbel.",
      rule_config: {
        symbol: "XRPUSD",
        direction: "short",
        hold_seconds: 14400,
        min_btc_6h_bps: 150,
        min_alt_2h_bps: 35,
        max_spread_bps: -35
      },
      priority: "medium" as const,
      matches: (meta: Record<string, unknown>) => {
        const btc = asNumber(meta.btc_momentum_6h_bps);
        const alt2h = asNumber(meta.momentum_2h_bps);
        const spread = asNumber(meta.spread_bps);
        const symbol = String(meta.symbol ?? "");
        return symbol === "XRPUSD" && btc >= 150 && alt2h >= 35 && spread <= -35;
      }
    }
  ]
} as const;

function symbolFromLaneKey(key: string) {
  if (key.startsWith("xrp_")) return "XRP";
  if (key.startsWith("avax_")) return "AVAX";
  if (key.startsWith("sol_")) return "SOL";
  return "OTHER";
}

function buildCandidatePolicies(args: {
  currentBtcRegime: string;
  recommendations: ReviewRecommendation[];
  positions: Array<{
    status: string;
    meta: Record<string, unknown> | null;
    realized_pnl_usd: unknown;
  }>;
}) {
  const activeSymbols = new Set(
    args.recommendations
      .filter((row) => row.recommended_state === "active")
      .map((row) => symbolFromLaneKey(row.strategy_key))
  );
  const library = CANDIDATE_POLICY_LIBRARY[args.currentBtcRegime as keyof typeof CANDIDATE_POLICY_LIBRARY] ?? [];
  return library
    .filter((item) => !activeSymbols.has(item.symbol))
    .slice(0, 3)
    .map((item) => {
      const matched = args.positions.filter((row) => {
        if (row.status !== "closed") return false;
        const meta = row.meta ?? {};
        if (meta.relative_strength_open !== true) return false;
        return item.matches(meta);
      });
      const pnl30d = matched.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
      const expectancy30d = matched.length > 0 ? pnl30d / matched.length : 0;
      return {
        symbol: item.symbol,
        label: item.label,
        regime: args.currentBtcRegime,
        why: item.why,
        rule_hint: item.rule_hint,
        rule_config: item.rule_config,
        priority: item.priority,
        trade_count: matched.length,
        pnl_30d_usd: Number(pnl30d.toFixed(4)),
        expectancy_30d_usd: Number(expectancy30d.toFixed(4))
      };
    })
    .sort((a, b) => {
      const scoreA = a.expectancy_30d_usd + a.pnl_30d_usd / 20 + a.trade_count;
      const scoreB = b.expectancy_30d_usd + b.pnl_30d_usd / 20 + b.trade_count;
      return scoreB - scoreA;
    });
}

function buildOperationalSummary(args: {
  currentBtcRegime: string;
  currentStates: LanePolicyState[];
  recommendedStates: LanePolicyState[];
  newsRiskMessage: string | null;
  candidatePolicies: ReviewSummary["candidate_policies"];
}): ReviewSummary {
  const currentCounts = countStates(args.currentStates);
  const recommendedCounts = countStates(args.recommendedStates);
  const marketLabel = regimeHumanLabel(args.currentBtcRegime);

  const openingExpectation =
    currentCounts.active > 0
      ? `Igen. Most ${currentCounts.active} lane automatikusan kereskedhet.`
      : currentCounts.watch > 0
      ? `Nem. Most nincs automatikus nyitás, ${currentCounts.watch} lane csak figyelő módban van.`
      : "Nem. Most nincs olyan lane, ami automatikusan nyitna ebben a piaci helyzetben.";

  const operatorMessage =
    currentCounts.active > 0
      ? "A rendszer most aktívan kereskedik, de csak a jelenlegi piaci helyzethez illő lane-ekkel."
      : currentCounts.watch > 0
      ? "A rendszer most inkább megfigyel: figyeli a setupokat, de még nem nyit automatikusan."
      : "A rendszer most kivár, mert ebben a piaci helyzetben nincs elég erős automatikus stratégia.";

  const nextAction =
    recommendedCounts.active > currentCounts.active
      ? "Ha alkalmazod az ajánlást, több lane kerül automatikus kereskedő módba."
      : recommendedCounts.active < currentCounts.active
      ? "Ha alkalmazod az ajánlást, a rendszer visszafog néhány jelenlegi lane-t a kockázat csökkentésére."
      : "Ha alkalmazod az ajánlást, a rendszer főleg finomhangolni fog, nem teljesen új működési módra vált.";

  return {
    market_label: marketLabel,
    opening_expectation: openingExpectation,
    operator_message: operatorMessage,
    next_action: nextAction,
    news_risk_message: args.newsRiskMessage,
    active_now_count: currentCounts.active,
    watch_now_count: currentCounts.watch,
    standby_now_count: currentCounts.standby,
    paused_now_count: currentCounts.paused,
    active_after_apply_count: recommendedCounts.active,
    watch_after_apply_count: recommendedCounts.watch,
    standby_after_apply_count: recommendedCounts.standby,
    paused_after_apply_count: recommendedCounts.paused,
    candidate_policies: args.candidatePolicies
  };
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

function lanePromotionScore(lane: ReviewSummaryLane) {
  const regimeBias = lane.regime_state === "active" ? 0.5 : lane.regime_state === "watch" ? 0.2 : 0;
  const consistencyBias = lane.closed_30d >= 3 ? 0.2 : 0;
  return lane.expectancy_30d_usd + lane.expectancy_7d_usd + regimeBias + consistencyBias + lane.pnl_30d_usd / 100;
}

function ensureMinimumActiveRecommendations(
  recommendations: ReviewRecommendation[],
  lanes: ReviewSummaryLane[]
) {
  const byKey = new Map(recommendations.map((row) => [row.strategy_key, row]));
  const activeCount = recommendations.filter((row) => row.recommended_state === "active").length;
  const targetActiveCount = Math.min(
    2,
    Math.max(
      1,
      lanes.filter((lane) => lane.closed_30d >= 2 && lane.pnl_30d_usd > 0 && lane.expectancy_30d_usd > 0).length
    )
  );

  if (activeCount >= targetActiveCount) return recommendations;

  const promotable = [...lanes]
    .filter((lane) => {
      const rec = byKey.get(lane.strategy_key);
      if (!rec) return false;
      if (rec.recommended_state === "active") return false;
      if (lane.closed_30d < 2) return false;
      if (lane.pnl_30d_usd <= 0 || lane.expectancy_30d_usd <= 0) return false;
      return true;
    })
    .sort((a, b) => lanePromotionScore(b) - lanePromotionScore(a));

  let remaining = targetActiveCount - activeCount;
  for (const lane of promotable) {
    if (remaining <= 0) break;
    const rec = byKey.get(lane.strategy_key);
    if (!rec) continue;
    rec.recommended_state = "active";
    rec.reason = "Best historical candidate for this regime; promoted to keep at least one tradable lane active.";
    rec.confidence = Math.max(rec.confidence, lane.closed_30d >= 4 ? 0.72 : 0.61);
    remaining -= 1;
  }

  return Array.from(byKey.values());
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
  const model =
    process.env.OPENAI_LANE_POLICY_MODEL ??
    process.env.OPENAI_POLICY_MODEL ??
    "gpt-5.1-chat-latest";

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

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Return only strict JSON with keys `summary` and `recommendations`. `recommendations` must be an array of objects containing strategy_key, recommended_state, reason, confidence."
        },
        {
          role: "user",
          content: JSON.stringify(payload)
        }
      ]
      ,
      max_tokens: 900
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      used: true,
      model,
      raw: `http_${response.status}${errorText ? `: ${errorText.slice(0, 1000)}` : ""}`,
      recommendations: null as ReviewRecommendation[] | null
    };
  }

  const data = (await response.json()) as OpenAIResponsesApiResult;
  const content =
    data.output_text?.trim() ||
    data.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? "")
      .join("\n")
      .trim() ||
    "";
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
  auto_applied_count: number;
  auto_apply_mode: string;
};

const LANE_STATE_SEVERITY: Record<LanePolicyState, number> = {
  active: 3,
  watch: 2,
  standby: 1,
  paused: 0
};

function isDowngrade(from: LanePolicyState, to: LanePolicyState) {
  return LANE_STATE_SEVERITY[to] < LANE_STATE_SEVERITY[from];
}

function isStrongAutoActivatableUpgrade(row: ReviewRecommendation) {
  return (
    row.recommended_state === "active" &&
    row.current_state !== "active" &&
    row.confidence >= 0.8
  );
}

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
      model: null,
      auto_applied_count: 0,
      auto_apply_mode: "disabled"
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

  const recentNewsSince = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const [
    { data: positions, error: positionsError },
    { data: settingsRows, error: settingsError },
    { data: newsRows, error: newsError }
  ] =
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
        .in("strategy_key", LANE_DEFS.map((lane) => lane.key)),
      adminSupabase
        .from("news_events")
        .select("title, action_bias, risk_gate, risk_gate_reason, published_at")
        .eq("risk_gate", true)
        .gte("published_at", recentNewsSince)
        .order("published_at", { ascending: false })
        .limit(1)
    ]);
  if (positionsError) throw new Error(positionsError.message);
  if (settingsError) throw new Error(settingsError.message);
  if (newsError) throw new Error(newsError.message);

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
  const recommendations = ensureMinimumActiveRecommendations(
    ai.recommendations && ai.recommendations.length > 0
      ? ai.recommendations
      : laneSummaries.map((lane) => heuristicRecommendation(lane)),
    laneSummaries
  );
  const latestNewsGate = (newsRows ?? [])[0] as
    | {
        title?: string | null;
        action_bias?: string | null;
        risk_gate_reason?: string | null;
      }
    | undefined;
  const newsRiskMessage = latestNewsGate
    ? `Friss hírkockázat aktív: ${latestNewsGate.risk_gate_reason || latestNewsGate.action_bias || latestNewsGate.title || "market risk"}`
    : null;
  const candidatePolicies = buildCandidatePolicies({
    currentBtcRegime,
    recommendations,
    positions: (positions ?? []).map((row) => ({
      status: String(row.status ?? ""),
      meta: (row.meta ?? {}) as Record<string, unknown>,
      realized_pnl_usd: row.realized_pnl_usd
    }))
  });
  const summary = buildOperationalSummary({
    currentBtcRegime,
    currentStates: laneSummaries.map((lane) => lane.current_state),
    recommendedStates: recommendations.map((row) => row.recommended_state),
    newsRiskMessage,
    candidatePolicies
  });

  const autoApplyDowngrades =
    (process.env.AUTO_APPLY_LANE_DOWNGRADES ?? "false").toLowerCase() === "true";
  const autoApplyStrongActivations =
    (process.env.AUTO_APPLY_STRONG_ACTIVE_RECOMMENDATIONS ?? "false").toLowerCase() === "true";
  let autoAppliedCount = 0;
  let reviewStatus = "proposed";

  if (autoApplyDowngrades || autoApplyStrongActivations) {
    const autoApplyRows = recommendations
      .filter(
        (row) =>
          (autoApplyDowngrades && isDowngrade(row.current_state, row.recommended_state)) ||
          (autoApplyStrongActivations && isStrongAutoActivatableUpgrade(row))
      )
      .map((row) => ({
        user_id: userId,
        strategy_key: row.strategy_key,
        enabled: row.recommended_state !== "paused",
        config: { state: row.recommended_state }
      }));

    if (autoApplyRows.length > 0) {
      const { error: downgradeError } = await adminSupabase
        .from("strategy_settings")
        .upsert(autoApplyRows, { onConflict: "user_id,strategy_key" });
      if (downgradeError) throw new Error(downgradeError.message);
      autoAppliedCount = autoApplyRows.length;
      reviewStatus =
        autoApplyDowngrades && autoApplyStrongActivations
          ? "auto_applied_mixed"
          : autoApplyDowngrades
            ? "auto_applied_downgrades"
            : "auto_applied_strong_activations";
    }
  }

  const { data: inserted, error: insertError } = await adminSupabase
    .from("lane_policy_reviews")
    .insert({
      user_id: userId,
      current_btc_regime: currentBtcRegime,
      current_btc_momentum_6h_bps: Number(btcMomentum.toFixed(4)),
      review_window_days: REVIEW_WINDOW_DAYS,
      model: ai.model,
      used_ai: ai.used && Boolean(ai.recommendations && ai.recommendations.length > 0),
      status: reviewStatus,
      summary,
      recommendations,
      raw: ai.raw
    })
    .select("id")
    .single();

  if (insertError) throw new Error(insertError.message);

  if ((candidatePolicies?.length ?? 0) > 0 && inserted?.id) {
    const candidateRows = candidatePolicies.map((candidate) => ({
      user_id: userId,
      symbol: candidate.symbol,
      label: candidate.label,
      regime: candidate.regime,
      why: candidate.why,
      rule_hint: candidate.rule_hint,
      rule_config: candidate.rule_config ?? {},
      priority: candidate.priority,
      trade_count: candidate.trade_count,
      pnl_30d_usd: candidate.pnl_30d_usd,
      expectancy_30d_usd: candidate.expectancy_30d_usd,
      source_review_id: inserted.id,
      last_reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    const { error: candidateUpsertError } = await adminSupabase
      .from("candidate_lane_policies")
      .upsert(candidateRows, { onConflict: "user_id,label,regime" });

    if (candidateUpsertError) throw new Error(candidateUpsertError.message);
  }

  return {
      review_id: inserted?.id ?? null,
      current_btc_regime: currentBtcRegime,
      current_btc_momentum_6h_bps: Number(btcMomentum.toFixed(4)),
      recommendations_count: recommendations.length,
      used_ai: ai.used && Boolean(ai.recommendations && ai.recommendations.length > 0),
      model: ai.model,
      auto_applied_count: autoAppliedCount,
      auto_apply_mode:
        autoApplyDowngrades && autoApplyStrongActivations
          ? "downgrades_plus_strong_activations"
          : autoApplyDowngrades
            ? "downgrades_only"
            : autoApplyStrongActivations
              ? "strong_activations_only"
              : "disabled"
    };
}
