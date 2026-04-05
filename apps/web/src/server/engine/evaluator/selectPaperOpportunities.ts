import "server-only";

import { buildFeatureBundle, predictScore, variantForOpportunity } from "@/server/ai/opportunityScoring";
import { scoreWithOpenAI } from "@/server/ai/openaiRanker";

export type OpportunityRow = {
  id: number;
  ts: string;
  exchange: string;
  symbol: string;
  type: string;
  net_edge_bps: number | null;
  confidence: number | null;
  details: Record<string, unknown> | null;
};

export type ScoredOpportunity = OpportunityRow & {
  score: number;
  features: ReturnType<typeof buildFeatureBundle>;
  variant: "A" | "B";
  aiScore: number | null;
  effectiveScore: number;
};

export type PaperOpportunitySelectorParams = {
  opportunities: OpportunityRow[];
  candidateLimit: number;
  contrarianActive: boolean;
  highThroughputPositiveMode: boolean;

  // gating inputs
  openBySymbol: Map<string, number>;
  maxOpenPerSymbol: number;
  minNetEdgeBps: number;
  minConfidence: number;
  minXarbNetEdgeBps: number;
  maxBreakEvenHours: number;
  xarbMaxSignalAgeHours: number;
  spreadReversionMaxSignalAgeHours: number;
  relativeStrengthMaxSignalAgeHours: number;
  relativeStrengthAllowlist: Set<string>;
  relativeStrengthLaneKeys: Set<string>;
  activeCanaryCandidateIds: Set<string>;
  blockedSymbolSet: Set<string>;

  // thresholds per type
  spreadReversionMinNetEdgeBps: number;
  spreadReversionMinConfidence: number;

  allowsDetect: (strategyKeyOrVariant: string) => boolean;
  allowsExecute: (strategyKeyOrVariant: string) => boolean;
  candidateCanaryIdFromVariant: (strategyVariant: string) => string | null;
  scoreOpportunity: (opp: OpportunityRow) => number;

  // learned scoring inputs
  weights: ReturnType<typeof import("@/server/ai/opportunityScoring").trainWeights>;
  symbolExpectancyBias: Record<string, number>;

  // LLM budgeting (daily + per tick)
  remainingLlmCalls: number;
  maxLlmCallsPerTick: number;
  maxLlmRerank: number;

  // diagnostics
  markPrefilter: (reason: string) => void;
};

export type PaperOpportunitySelectorResult = {
  scored: ScoredOpportunity[];
  llmCallsUsed: number;
  remainingLlmCalls: number;
};

export async function selectPaperOpportunities(params: PaperOpportunitySelectorParams): Promise<PaperOpportunitySelectorResult> {
  const {
    opportunities,
    candidateLimit,
    contrarianActive,
    highThroughputPositiveMode,
    openBySymbol,
    maxOpenPerSymbol,
    minNetEdgeBps,
    minConfidence,
    minXarbNetEdgeBps,
    maxBreakEvenHours,
    xarbMaxSignalAgeHours,
    spreadReversionMaxSignalAgeHours,
    relativeStrengthMaxSignalAgeHours,
    relativeStrengthAllowlist,
    relativeStrengthLaneKeys,
    activeCanaryCandidateIds,
    blockedSymbolSet,
    spreadReversionMinNetEdgeBps,
    spreadReversionMinConfidence,
    allowsDetect,
    allowsExecute,
    candidateCanaryIdFromVariant,
    scoreOpportunity,
    weights,
    symbolExpectancyBias,
    markPrefilter,
    maxLlmCallsPerTick,
    maxLlmRerank
  } = params;

  let remainingLlmCalls = params.remainingLlmCalls;

  const scoredBase: ScoredOpportunity[] = (opportunities ?? [])
    // Keep only the newest opportunity per (type, symbol, exchange) key to avoid retrying stale snapshots.
    .filter((opp, idx, arr) => {
      const key = `${opp.type}|${opp.symbol}|${opp.exchange}`;
      const firstIdx = arr.findIndex((x) => `${x.type}|${x.symbol}|${x.exchange}` === key);
      return firstIdx === idx;
    })
    .filter((opp) => {
      const symbol = opp.symbol ?? "";
      if (!symbol) {
        markPrefilter("missing_symbol");
        return false;
      }
      if ((openBySymbol.get(symbol) ?? 0) >= maxOpenPerSymbol) {
        markPrefilter("max_open_per_symbol");
        return false;
      }

      const netEdge = Number(opp.net_edge_bps ?? 0);
      const confidence = Number(opp.confidence ?? 0);
      const details = opp.details ?? {};
      const breakEven = Number((details as Record<string, unknown>).break_even_hours ?? Number.NaN);

      if (opp.type === "tri_arb") {
        if (!allowsExecute("tri_arb")) {
          markPrefilter("tri_arb_auto_open_disabled");
          return false;
        }
      }
      if (opp.type === "spot_perp_carry") {
        if (!allowsExecute("spot_perp_carry")) {
          markPrefilter("carry_auto_open_disabled");
          return false;
        }
      }
      if (opp.type === "spread_reversion") {
        if (!allowsExecute("spread_reversion")) {
          markPrefilter("spread_reversion_auto_open_disabled");
          return false;
        }
      }
      if (opp.type === "xarb_spot") {
        if (!allowsExecute("xarb_spot")) {
          markPrefilter("xarb_auto_open_disabled");
          return false;
        }
      }
      if (opp.type === "xarb_spot" && blockedSymbolSet.has(opp.symbol)) {
        markPrefilter("blocked_symbol");
        return false;
      }

      const relaxedXarbPrefilter = false;
      const effectiveMinNetEdgeBps = relaxedXarbPrefilter ? -5 : minNetEdgeBps;
      const effectiveMinXarbNetEdgeBps = relaxedXarbPrefilter ? Math.min(-3, minXarbNetEdgeBps) : minXarbNetEdgeBps;
      const effectiveXarbMaxSignalAgeHours = relaxedXarbPrefilter ? Math.max(24, xarbMaxSignalAgeHours) : Math.min(xarbMaxSignalAgeHours, 2);

      const typeMinNetEdge = opp.type === "spread_reversion" ? spreadReversionMinNetEdgeBps : effectiveMinNetEdgeBps;
      if (netEdge < typeMinNetEdge) {
        markPrefilter("below_min_net_edge");
        return false;
      }

      const typeConfidenceMin =
        opp.type === "xarb_spot"
          ? relaxedXarbPrefilter
            ? 0.42
            : Math.max(0.54, minConfidence - 0.08)
          : opp.type === "spread_reversion"
            ? spreadReversionMinConfidence
            : opp.type === "relative_strength"
              ? 0.58
              : opp.type === "tri_arb"
                ? Math.max(0.54, minConfidence - 0.08)
                : minConfidence;

      if (confidence < typeConfidenceMin) {
        markPrefilter("below_min_confidence");
        return false;
      }
      if (Number.isFinite(breakEven) && breakEven > maxBreakEvenHours) {
        markPrefilter("break_even_too_long");
        return false;
      }

      if (opp.type === "xarb_spot") {
        const ageHours = (Date.now() - Date.parse(opp.ts)) / (60 * 60 * 1000);
        if (!Number.isFinite(ageHours) || ageHours > effectiveXarbMaxSignalAgeHours) {
          markPrefilter("stale_xarb_signal");
          return false;
        }
        if (netEdge < effectiveMinXarbNetEdgeBps) {
          markPrefilter("xarb_below_min_edge");
          return false;
        }
      }

      if (opp.type === "spread_reversion") {
        const ageHours = (Date.now() - Date.parse(opp.ts)) / (60 * 60 * 1000);
        if (!Number.isFinite(ageHours) || ageHours > spreadReversionMaxSignalAgeHours) {
          markPrefilter("stale_spread_reversion_signal");
          return false;
        }
      }

      if (opp.type === "relative_strength") {
        if (!allowsDetect("relative_strength")) {
          markPrefilter("relative_strength_disabled");
          return false;
        }
        const ageHours = (Date.now() - Date.parse(opp.ts)) / (60 * 60 * 1000);
        if (!Number.isFinite(ageHours) || ageHours > relativeStrengthMaxSignalAgeHours) {
          markPrefilter("stale_relative_strength_signal");
          return false;
        }
        if (!relativeStrengthAllowlist.has(opp.symbol)) {
          markPrefilter("relative_strength_symbol_blocked");
          return false;
        }

        const strategyVariant = String((opp.details as Record<string, unknown> | null)?.strategy_variant ?? "");
        if (strategyVariant && relativeStrengthLaneKeys.has(strategyVariant) && !allowsDetect(strategyVariant)) {
          markPrefilter("relative_strength_lane_disabled");
          return false;
        }

        const candidateCanaryId = candidateCanaryIdFromVariant(strategyVariant);
        if (candidateCanaryId && !activeCanaryCandidateIds.has(candidateCanaryId)) {
          markPrefilter("candidate_canary_disabled");
          return false;
        }
      }

      return true;
    })
    .map((opp) => ({
      ...opp,
      score: scoreOpportunity(opp),
      features: buildFeatureBundle({
        type: opp.type,
        net_edge_bps: opp.net_edge_bps,
        confidence: opp.confidence,
        details: opp.details
      }),
      variant: "A" as const,
      aiScore: null,
      effectiveScore: 0
    }))
    .map((opp) => {
      const variant = variantForOpportunity(opp.id);
      const aiScore = predictScore(weights, opp.features.vector);
      let effectiveScore = variant === "B" && aiScore !== null ? aiScore : opp.score;
      if (highThroughputPositiveMode) {
        const symbolBias = symbolExpectancyBias[opp.symbol] ?? 0;
        effectiveScore += Math.max(-0.25, Math.min(0.25, symbolBias / 4));
      }
      if (variant === "B" && contrarianActive) {
        effectiveScore = -effectiveScore;
      }
      return { ...opp, variant, aiScore, effectiveScore };
    })
    .sort((a, b) => b.effectiveScore - a.effectiveScore)
    .slice(0, candidateLimit);

  let llmCallsUsed = 0;
  const rerankCandidates = scoredBase.slice(0, maxLlmRerank);
  const scoredWithLlm: ScoredOpportunity[] = [];

  for (const opp of scoredBase) {
    if (
      opp.variant === "B" &&
      rerankCandidates.includes(opp) &&
      remainingLlmCalls > 0 &&
      llmCallsUsed < maxLlmCallsPerTick
    ) {
      const llm = await scoreWithOpenAI({
        type: opp.type,
        net_edge_bps: opp.net_edge_bps,
        confidence: opp.confidence,
        details: opp.details
      });

      llmCallsUsed += 1;
      remainingLlmCalls -= 1;

      if (llm.score !== null) {
        scoredWithLlm.push({ ...opp, aiScore: llm.score, effectiveScore: llm.score });
        continue;
      }
    }
    scoredWithLlm.push(opp);
  }

  return {
    scored: scoredWithLlm.sort((a, b) => b.effectiveScore - a.effectiveScore),
    llmCallsUsed,
    remainingLlmCalls
  };
}
