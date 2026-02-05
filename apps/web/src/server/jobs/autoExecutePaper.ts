import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";
import { paperFill } from "@/lib/execution/paperFill";
import {
  buildFeatureBundle,
  predictScore,
  trainWeights,
  variantForOpportunity
} from "@/server/ai/opportunityScoring";
import { scoreWithOpenAI } from "@/server/ai/openaiRanker";

const DEFAULT_NOTIONAL = 100;
const DEFAULT_MIN_NOTIONAL = 100;
const DEFAULT_MAX_NOTIONAL = 500;
const DEFAULT_PAPER_BALANCE = 10000;
const SLIPPAGE_BPS = 2;
const FEE_BPS = 4;

const MAX_OPEN_POSITIONS = 10;
const MAX_OPEN_PER_SYMBOL = 2;
const MAX_NEW_PER_HOUR = 3;
const MAX_CANDIDATES = 10;
const MAX_EXECUTE_PER_TICK = 1;
const MAX_LLM_CALLS_PER_TICK = 3;
const MAX_LLM_RERANK = 3;
const MAX_LLM_CALLS_PER_DAY = 500;
const LOOKBACK_HOURS = 24;

const STRATEGY_RISK_WEIGHT: Record<string, number> = {
  spot_perp_carry: 0,
  xarb_spot: 1,
  tri_arb: 2
};

const CANONICAL_MAP: Record<
  string,
  { bybit: string; okx: string; kraken?: string }
> = {
  BTCUSD: { bybit: "BTCUSDT", okx: "BTCUSDT", kraken: "BTCUSD" },
  ETHUSD: { bybit: "ETHUSDT", okx: "ETHUSDT", kraken: "ETHUSD" },
  SOLUSD: { bybit: "SOLUSDT", okx: "SOLUSDT" },
  XRPUSD: { bybit: "XRPUSDT", okx: "XRPUSDT" },
  BNBUSD: { bybit: "BNBUSDT", okx: "BNBUSDT" },
  ADAUSD: { bybit: "ADAUSDT", okx: "ADAUSDT" },
  DOGEUSD: { bybit: "DOGEUSDT", okx: "DOGEUSDT" },
  AVAXUSD: { bybit: "AVAXUSDT", okx: "AVAXUSDT" },
  LINKUSD: { bybit: "LINKUSDT", okx: "LINKUSDT" },
  LTCUSD: { bybit: "LTCUSDT", okx: "LTCUSDT" },
  DOTUSD: { bybit: "DOTUSDT", okx: "DOTUSDT" },
  BCHUSD: { bybit: "BCHUSDT", okx: "BCHUSDT" },
  TRXUSD: { bybit: "TRXUSDT", okx: "TRXUSDT" }
};

const KRAKEN_PAIR_MAP: Record<string, string> = {
  BTCUSD: "XXBTZUSD",
  ETHUSD: "XETHZUSD"
};

type BybitTicker = {
  bid1Price: string;
  ask1Price: string;
};

type BybitResponse = {
  retCode: number;
  retMsg: string;
  result: { list: BybitTicker[] };
};

type OkxTicker = {
  bidPx: string;
  askPx: string;
};

type OkxResponse = {
  code: string;
  msg: string;
  data: OkxTicker[];
};

type KrakenTicker = {
  a: [string, string, string];
  b: [string, string, string];
};

type KrakenResponse = {
  error: string[];
  result: Record<string, KrakenTicker>;
};

type OpportunityRow = {
  id: number;
  ts: string;
  exchange: string;
  symbol: string;
  type: string;
  net_edge_bps: number | null;
  confidence: number | null;
  details: Record<string, unknown> | null;
};

type ScoredOpportunity = OpportunityRow & {
  score: number;
  features: ReturnType<typeof buildFeatureBundle>;
  variant: "A" | "B";
  aiScore: number | null;
  effectiveScore: number;
};

type AutoExecuteResult = {
  attempted: number;
  created: number;
  skipped: number;
  reasons: Array<{ opportunity_id: number; reason: string }>;
  llm_used: number;
  llm_remaining: number;
};

function clampNotional(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function deriveNotional(
  opportunity: { net_edge_bps: number | null; details: Record<string, unknown> | null },
  minNotional: number,
  maxNotional: number
) {
  const netEdge = Number(opportunity.net_edge_bps ?? 0);
  const details = opportunity.details ?? {};
  const breakEven = Number((details as Record<string, unknown>).break_even_hours);

  let notional = DEFAULT_NOTIONAL;
  let reason = "default";

  if (Number.isFinite(breakEven)) {
    if (breakEven <= 24) {
      notional = 500;
      reason = "break_even_fast";
    } else if (breakEven <= 48) {
      notional = 300;
      reason = "break_even_ok";
    }
  }

  if (reason === "default") {
    if (netEdge >= 20) {
      notional = 500;
      reason = "net_edge_high";
    } else if (netEdge >= 12) {
      notional = 300;
      reason = "net_edge_mid";
    }
  }

  return { notional: clampNotional(notional, minNotional, maxNotional), reason };
}

function scoreOpportunity(opp: OpportunityRow) {
  const risk = STRATEGY_RISK_WEIGHT[opp.type] ?? 3;
  const netEdge = Number(opp.net_edge_bps ?? 0);
  const confidence = Number(opp.confidence ?? 0.5);
  const details = opp.details ?? {};
  const breakEven = Number((details as Record<string, unknown>).break_even_hours);

  const breakEvenPenalty = Number.isFinite(breakEven) ? breakEven / 24 : 4;
  const edgeBonus = netEdge / 10;
  const confidenceBonus = confidence;

  return risk + breakEvenPenalty - edgeBonus - confidenceBonus;
}

function okxSpotInstId(symbol: string) {
  const base = symbol.replace("USDT", "");
  return `${base}-USDT`;
}

function toNumber(value: string | undefined | null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; ArbiterBot/1.0)"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function fetchSpotTicker(exchange: string, symbol: string) {
  if (exchange === "bybit") {
    const spot = await fetchJson<BybitResponse>(
      `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`
    );
    if (spot.retCode !== 0) {
      throw new Error(`Bybit error: ${spot.retMsg}`);
    }
    const ticker = spot.result.list[0];
    const bid = toNumber(ticker?.bid1Price ?? null);
    const ask = toNumber(ticker?.ask1Price ?? null);
    if (!bid || !ask || ask <= bid) {
      throw new Error("Bybit invalid bid/ask");
    }
    return { bid, ask };
  }

  if (exchange === "okx") {
    const instId = okxSpotInstId(symbol);
    const spot = await fetchJson<OkxResponse>(
      `https://www.okx.com/api/v5/market/ticker?instId=${instId}`
    );
    if (spot.code !== "0") {
      throw new Error(`OKX error: ${spot.msg}`);
    }
    const ticker = spot.data[0];
    const bid = toNumber(ticker?.bidPx ?? null);
    const ask = toNumber(ticker?.askPx ?? null);
    if (!bid || !ask || ask <= bid) {
      throw new Error("OKX invalid bid/ask");
    }
    return { bid, ask };
  }

  if (exchange === "kraken") {
    const pair = KRAKEN_PAIR_MAP[symbol];
    if (!pair) {
      throw new Error("Kraken pair not supported");
    }
    const data = await fetchJson<KrakenResponse>(
      `https://api.kraken.com/0/public/Ticker?pair=${pair}`
    );
    if (data.error && data.error.length > 0) {
      throw new Error(data.error.join(", "));
    }
    const ticker = data.result?.[pair];
    const ask = toNumber(ticker?.a?.[0]);
    const bid = toNumber(ticker?.b?.[0]);
    if (!bid || !ask || ask <= bid) {
      throw new Error("Kraken invalid bid/ask");
    }
    return { bid, ask };
  }

  throw new Error("unsupported exchange");
}

function parseOkxSymbol(symbol: string) {
  const [base, quote] = symbol.split("-");
  return { base, quote };
}

function applyFee(amount: number, feeBps: number) {
  return amount * (1 - feeBps / 10000);
}

function applySlippage(price: number, side: "buy" | "sell", slippageBps: number) {
  if (side === "buy") {
    return price * (1 + slippageBps / 10000);
  }
  return price * (1 - slippageBps / 10000);
}

async function fetchOkxTrianglePrices(steps: Array<{ symbol: string; side: "buy" | "sell" }>) {
  const results: Array<{ symbol: string; side: "buy" | "sell"; bid: number; ask: number }> = [];
  for (const step of steps) {
    const spot = await fetchJson<OkxResponse>(
      `https://www.okx.com/api/v5/market/ticker?instId=${step.symbol}`
    );
    if (spot.code !== "0") {
      throw new Error(`OKX error: ${spot.msg}`);
    }
    const ticker = spot.data[0];
    const bid = toNumber(ticker?.bidPx ?? null);
    const ask = toNumber(ticker?.askPx ?? null);
    if (!bid || !ask || ask <= bid) {
      throw new Error("OKX invalid bid/ask");
    }
    results.push({ symbol: step.symbol, side: step.side, bid, ask });
  }
  return results;
}

export async function autoExecutePaper(): Promise<AutoExecuteResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  let { data: account, error: accountError } = await adminSupabase
    .from("paper_accounts")
    .select("id, user_id, balance_usd, reserved_usd, min_notional_usd, max_notional_usd")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (!account) {
    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (profileError) {
      throw new Error(profileError.message);
    }

    if (!profile?.id) {
      return {
        attempted: 0,
        created: 0,
        skipped: 0,
        reasons: [],
        llm_used: 0,
        llm_remaining: 0
      };
    }

    const { data: createdAccount, error: createError } = await adminSupabase
      .from("paper_accounts")
      .insert({
        user_id: profile.id,
        balance_usd: DEFAULT_PAPER_BALANCE,
        reserved_usd: 0,
        min_notional_usd: DEFAULT_MIN_NOTIONAL,
        max_notional_usd: DEFAULT_MAX_NOTIONAL
      })
      .select("id, user_id, balance_usd, reserved_usd, min_notional_usd, max_notional_usd")
      .single();

    if (createError || !createdAccount) {
      throw new Error(createError?.message ?? "Failed to create paper account.");
    }

    account = createdAccount;
  }

  const userId = account.user_id;
  const balance = Number(account.balance_usd ?? DEFAULT_PAPER_BALANCE);
  const reserved = Number(account.reserved_usd ?? 0);
  const minNotional = Number(account.min_notional_usd ?? DEFAULT_MIN_NOTIONAL);
  const maxNotional = Number(account.max_notional_usd ?? DEFAULT_MAX_NOTIONAL);

  const { data: openPositions, error: openError } = await adminSupabase
    .from("positions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "open");

  if (openError) {
    throw new Error(openError.message);
  }

  if ((openPositions ?? []).length >= MAX_OPEN_POSITIONS) {
    return {
      attempted: 0,
      created: 0,
      skipped: 0,
      reasons: [],
      llm_used: 0,
      llm_remaining: 0
    };
  }

  const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentPositions, error: recentError } = await adminSupabase
    .from("positions")
    .select("id")
    .eq("user_id", userId)
    .gte("entry_ts", sinceHour);

  if (recentError) {
    throw new Error(recentError.message);
  }

  if ((recentPositions ?? []).length >= MAX_NEW_PER_HOUR) {
    return {
      attempted: 0,
      created: 0,
      skipped: 0,
      reasons: [],
      llm_used: 0,
      llm_remaining: 0
    };
  }

  const sinceOpps = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data: opportunities, error: oppError } = await adminSupabase
    .from("opportunities")
    .select("id, ts, exchange, symbol, type, net_edge_bps, confidence, details, status")
    .gte("ts", sinceOpps)
    .order("ts", { ascending: false })
    .limit(80);

  if (oppError) {
    throw new Error(oppError.message);
  }

  const openBySymbol = new Map<string, number>();
  for (const pos of openPositions ?? []) {
    const symbol = (pos as { symbol?: string | null }).symbol ?? "";
    if (!symbol) {
      continue;
    }
    openBySymbol.set(symbol, (openBySymbol.get(symbol) ?? 0) + 1);
  }

  const trainingSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: decisionRows } = await adminSupabase
    .from("opportunity_decisions")
    .select("features, position_id")
    .gte("ts", trainingSince)
    .not("position_id", "is", null)
    .limit(2000);

  const positionIds = (decisionRows ?? [])
    .map((row) => row.position_id as string)
    .filter(Boolean);

  const { data: positionsForTraining } = await adminSupabase
    .from("positions")
    .select("id, realized_pnl_usd")
    .in("id", positionIds.length > 0 ? positionIds : ["00000000-0000-0000-0000-000000000000"]);

  const pnlMap = new Map(
    (positionsForTraining ?? []).map((row) => [row.id as string, Number(row.realized_pnl_usd ?? 0)])
  );

  const trainingRows = (decisionRows ?? [])
    .map((row) => {
      const features = (row.features ?? {}) as { vector?: { names: string[]; values: number[] } };
      const vector = features.vector;
      const label = pnlMap.get(row.position_id as string);
      if (!vector || !Array.isArray(vector.values) || label === undefined) {
        return null;
      }
      return { vector, label };
    })
    .filter(Boolean) as Array<{ vector: { names: string[]; values: number[] }; label: number }>;

  const weights = trainWeights(trainingRows);

  const today = new Date().toISOString().slice(0, 10);
  const { data: usageRow } = await adminSupabase
    .from("ai_usage_daily")
    .select("day, requests")
    .eq("day", today)
    .maybeSingle();

  let remainingLlmCalls = Math.max(
    0,
    MAX_LLM_CALLS_PER_DAY - Number(usageRow?.requests ?? 0)
  );

  let scored: ScoredOpportunity[] = (opportunities ?? [])
    .filter((opp) => {
      const symbol = (opp as { symbol?: string }).symbol ?? "";
      if (!symbol) {
        return false;
      }
      return (openBySymbol.get(symbol) ?? 0) < MAX_OPEN_PER_SYMBOL;
    })
    .map((opp) => ({
      ...(opp as OpportunityRow),
      score: scoreOpportunity(opp as OpportunityRow),
      features: buildFeatureBundle({
        type: (opp as OpportunityRow).type,
        net_edge_bps: (opp as OpportunityRow).net_edge_bps,
        confidence: (opp as OpportunityRow).confidence,
        details: (opp as OpportunityRow).details
      })
    }))
    .map((opp) => {
      const variant = variantForOpportunity(opp.id);
      const aiScore = predictScore(weights, opp.features.vector);
      const effectiveScore = variant === "B" && aiScore !== null ? aiScore : opp.score;
      return { ...opp, variant, aiScore, effectiveScore };
    })
    .sort((a, b) => a.effectiveScore - b.effectiveScore)
    .slice(0, MAX_CANDIDATES);

  if (scored.length === 0) {
    scored = (opportunities ?? [])
      .map((opp) => ({
        ...(opp as OpportunityRow),
        score: scoreOpportunity(opp as OpportunityRow),
        features: buildFeatureBundle({
          type: (opp as OpportunityRow).type,
          net_edge_bps: (opp as OpportunityRow).net_edge_bps,
          confidence: (opp as OpportunityRow).confidence,
          details: (opp as OpportunityRow).details
        })
      }))
      .map((opp) => {
        const variant = variantForOpportunity(opp.id);
        const aiScore = predictScore(weights, opp.features.vector);
        const effectiveScore = variant === "B" && aiScore !== null ? aiScore : opp.score;
        return { ...opp, variant, aiScore, effectiveScore };
      })
      .sort((a, b) => a.effectiveScore - b.effectiveScore)
      .slice(0, MAX_CANDIDATES);
  }

  let llmCallsUsed = 0;
  const scoredWithLlm: ScoredOpportunity[] = [];
  const rerankCandidates = scored.slice(0, MAX_LLM_RERANK);
  for (const opp of scored) {
    if (
      opp.variant === "B" &&
      rerankCandidates.includes(opp) &&
      remainingLlmCalls > 0 &&
      llmCallsUsed < MAX_LLM_CALLS_PER_TICK
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
        const adjusted = { ...opp, aiScore: llm.score, effectiveScore: llm.score };
        scoredWithLlm.push(adjusted);
        continue;
      }
    }
    scoredWithLlm.push(opp);
  }

  if (llmCallsUsed > 0) {
    await adminSupabase
      .from("ai_usage_daily")
      .upsert(
        {
          day: today,
          requests: Number(usageRow?.requests ?? 0) + llmCallsUsed,
          updated_at: new Date().toISOString()
        },
        { onConflict: "day" }
      );
  }

  scored = scoredWithLlm.sort((a, b) => a.effectiveScore - b.effectiveScore);

  let attempted = 0;
  let created = 0;
  let skipped = 0;
  const reasons: Array<{ opportunity_id: number; reason: string }> = [];

  let available = Math.max(0, balance - reserved);
  let reservedCurrent = reserved;

  for (const opp of scored.slice(0, MAX_EXECUTE_PER_TICK)) {
    attempted += 1;

    const { data: decisionRow } = await adminSupabase
      .from("opportunity_decisions")
      .insert({
        user_id: userId,
        opportunity_id: opp.id,
        variant: opp.variant,
        score: Number.isFinite(opp.effectiveScore) ? opp.effectiveScore : null,
        chosen: false,
        features: {
          vector: opp.features.vector,
          meta: opp.features.meta,
          score_rule: opp.score,
          score_ai: opp.aiScore,
          score_effective: opp.effectiveScore
        }
      })
      .select("id")
      .single();

    const { data: existingPosition, error: existingError } = await adminSupabase
      .from("positions")
      .select("id")
      .eq("user_id", userId)
      .eq("opportunity_id", opp.id)
      .eq("status", "open")
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existingPosition) {
      skipped += 1;
      reasons.push({ opportunity_id: opp.id, reason: "already_open" });
      if (decisionRow?.id) {
        await adminSupabase
          .from("opportunity_decisions")
          .update({ chosen: false })
          .eq("id", decisionRow.id);
      }
      continue;
    }

    const derived = deriveNotional(
      { net_edge_bps: opp.net_edge_bps, details: opp.details },
      minNotional,
      maxNotional
    );
    const notional_usd = derived.notional;

    if (notional_usd > available) {
      skipped += 1;
      reasons.push({ opportunity_id: opp.id, reason: "insufficient_balance" });
      continue;
    }

    if (opp.type === "spot_perp_carry") {
      const { data: snapshot, error: snapshotError } = await adminSupabase
        .from("market_snapshots")
        .select("id, ts, exchange, symbol, spot_bid, spot_ask, perp_bid, perp_ask")
        .eq("exchange", opp.exchange)
        .eq("symbol", opp.symbol)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (snapshotError) {
        throw new Error(snapshotError.message);
      }

      if (!snapshot || snapshot.spot_ask === null || snapshot.perp_bid === null) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "missing_snapshot_prices" });
        continue;
      }

      const spotFill = paperFill({
        side: "buy",
        price: snapshot.spot_ask,
        notional_usd,
        slippage_bps: SLIPPAGE_BPS,
        fee_bps: FEE_BPS
      });

      const perpFill = paperFill({
        side: "sell",
        price: snapshot.perp_bid,
        notional_usd,
        slippage_bps: SLIPPAGE_BPS,
        fee_bps: FEE_BPS
      });

      const { data: position, error: positionError } = await adminSupabase
        .from("positions")
        .insert({
          user_id: userId,
          opportunity_id: opp.id,
          symbol: opp.symbol,
          mode: "paper",
          status: "open",
          entry_spot_price: spotFill.fill_price,
          entry_perp_price: perpFill.fill_price,
          spot_qty: spotFill.qty,
          perp_qty: -perpFill.qty,
          meta: {
            opportunity_id: opp.id,
            snapshot_id: snapshot.id,
            fee_bps: FEE_BPS,
            slippage_bps: SLIPPAGE_BPS,
            notional_usd,
            notional_reason: derived.reason,
            auto_execute: true
          }
        })
        .select("id")
        .single();

      if (positionError || !position) {
        throw new Error(positionError?.message ?? "Failed to create position.");
      }

      const executionsPayload = [
        {
          position_id: position.id,
          leg: "spot_buy",
          requested_qty: spotFill.qty,
          filled_qty: spotFill.qty,
          avg_price: spotFill.fill_price,
          fee: spotFill.fee_usd,
          raw: {
            side: "buy",
            price: snapshot.spot_ask,
            fill_price: spotFill.fill_price,
            slippage_bps: SLIPPAGE_BPS,
            fee_bps: FEE_BPS,
            notional_usd
          }
        },
        {
          position_id: position.id,
          leg: "perp_sell",
          requested_qty: perpFill.qty,
          filled_qty: perpFill.qty,
          avg_price: perpFill.fill_price,
          fee: perpFill.fee_usd,
          raw: {
            side: "sell",
            price: snapshot.perp_bid,
            fill_price: perpFill.fill_price,
            slippage_bps: SLIPPAGE_BPS,
            fee_bps: FEE_BPS,
            notional_usd
          }
        }
      ];

      const { error: executionError } = await adminSupabase
        .from("executions")
        .insert(executionsPayload);

      if (executionError) {
        throw new Error(executionError.message);
      }

      reservedCurrent = Number((reservedCurrent + notional_usd).toFixed(2));
      const { error: reserveError } = await adminSupabase
        .from("paper_accounts")
        .update({
          reserved_usd: reservedCurrent,
          updated_at: new Date().toISOString()
        })
        .eq("id", account.id);

      if (reserveError) {
        throw new Error(reserveError.message);
      }

      available = Number((available - notional_usd).toFixed(2));
      created += 1;
      if (decisionRow?.id) {
        await adminSupabase
          .from("opportunity_decisions")
          .update({ chosen: true, position_id: position.id })
          .eq("id", decisionRow.id);
      }
      continue;
    }

    if (opp.type === "xarb_spot") {
      const mapping = CANONICAL_MAP[opp.symbol];
      if (!mapping) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "symbol_not_supported" });
        continue;
      }

      const details = opp.details ?? {};
      const buyExchange = String((details as Record<string, unknown>).buy_exchange ?? "");
      const sellExchange = String((details as Record<string, unknown>).sell_exchange ?? "");

      const buySymbol =
        buyExchange === "kraken" ? mapping.kraken : buyExchange === "okx" ? mapping.okx : mapping.bybit;
      const sellSymbol =
        sellExchange === "kraken" ? mapping.kraken : sellExchange === "okx" ? mapping.okx : mapping.bybit;

      if (!buyExchange || !sellExchange || !buySymbol || !sellSymbol) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "missing_exchange_mapping" });
        continue;
      }

      let buyQuote: { bid: number; ask: number };
      let sellQuote: { bid: number; ask: number };

      try {
        [buyQuote, sellQuote] = await Promise.all([
          fetchSpotTicker(buyExchange, buySymbol),
          fetchSpotTicker(sellExchange, sellSymbol)
        ]);
      } catch (err) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "live_price_error" });
        continue;
      }

      const buyFill = paperFill({
        side: "buy",
        price: buyQuote.ask,
        notional_usd,
        slippage_bps: SLIPPAGE_BPS,
        fee_bps: FEE_BPS
      });

      const sellFill = paperFill({
        side: "sell",
        price: sellQuote.bid,
        notional_usd,
        slippage_bps: SLIPPAGE_BPS,
        fee_bps: FEE_BPS
      });

      const { data: position, error: positionError } = await adminSupabase
        .from("positions")
        .insert({
          user_id: userId,
          opportunity_id: opp.id,
          symbol: opp.symbol,
          mode: "paper",
          status: "open",
          entry_spot_price: buyFill.fill_price,
          entry_perp_price: sellFill.fill_price,
          spot_qty: buyFill.qty,
          perp_qty: -sellFill.qty,
          meta: {
            opportunity_id: opp.id,
            type: "xarb_spot",
            buy_exchange: buyExchange,
            sell_exchange: sellExchange,
            buy_symbol: buySymbol,
            sell_symbol: sellSymbol,
            buy_entry_price: buyFill.fill_price,
            sell_entry_price: sellFill.fill_price,
            buy_qty: buyFill.qty,
            sell_qty: sellFill.qty,
            fee_bps: FEE_BPS,
            slippage_bps: SLIPPAGE_BPS,
            notional_usd,
            notional_reason: derived.reason,
            auto_execute: true
          }
        })
        .select("id")
        .single();

      if (positionError || !position) {
        throw new Error(positionError?.message ?? "Failed to create position.");
      }

      const executionsPayload = [
        {
          position_id: position.id,
          leg: "spot_buy",
          requested_qty: buyFill.qty,
          filled_qty: buyFill.qty,
          avg_price: buyFill.fill_price,
          fee: buyFill.fee_usd,
          raw: {
            side: "buy",
            price: buyQuote.ask,
            fill_price: buyFill.fill_price,
            slippage_bps: SLIPPAGE_BPS,
            fee_bps: FEE_BPS,
            notional_usd
          }
        },
        {
          position_id: position.id,
          leg: "spot_sell",
          requested_qty: sellFill.qty,
          filled_qty: sellFill.qty,
          avg_price: sellFill.fill_price,
          fee: sellFill.fee_usd,
          raw: {
            side: "sell",
            price: sellQuote.bid,
            fill_price: sellFill.fill_price,
            slippage_bps: SLIPPAGE_BPS,
            fee_bps: FEE_BPS,
            notional_usd
          }
        }
      ];

      const { error: executionError } = await adminSupabase
        .from("executions")
        .insert(executionsPayload);

      if (executionError) {
        throw new Error(executionError.message);
      }

      reservedCurrent = Number((reservedCurrent + notional_usd).toFixed(2));
      const { error: reserveError } = await adminSupabase
        .from("paper_accounts")
        .update({
          reserved_usd: reservedCurrent,
          updated_at: new Date().toISOString()
        })
        .eq("id", account.id);

      if (reserveError) {
        throw new Error(reserveError.message);
      }

      available = Number((available - notional_usd).toFixed(2));
      created += 1;
      if (decisionRow?.id) {
        await adminSupabase
          .from("opportunity_decisions")
          .update({ chosen: true, position_id: position.id })
          .eq("id", decisionRow.id);
      }
      continue;
    }

    if (opp.type === "tri_arb") {
      const details = opp.details ?? {};
      const stepsRaw = (details as Record<string, unknown>).steps as Array<Record<string, unknown>> | undefined;
      const steps = (stepsRaw ?? [])
        .map((step) => {
          const side = step.side === "sell" ? "sell" : "buy";
          return {
            symbol: String(step.symbol ?? ""),
            side
          };
        })
        .filter(
          (step): step is { symbol: string; side: "buy" | "sell" } =>
            step.symbol.length > 0 && (step.side === "buy" || step.side === "sell")
        );

      if (steps.length !== 3) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "invalid_steps" });
        continue;
      }

      let prices: Array<{ symbol: string; side: "buy" | "sell"; bid: number; ask: number }>;
      try {
        prices = await fetchOkxTrianglePrices(steps);
      } catch (err) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "live_price_error" });
        continue;
      }

      let amount = notional_usd;
      const executionLegs: Array<Record<string, unknown>> = [];

      for (const step of prices) {
        const { base, quote } = parseOkxSymbol(step.symbol);
        if (!base || !quote) {
          skipped += 1;
          reasons.push({ opportunity_id: opp.id, reason: "invalid_symbol" });
          amount = 0;
          break;
        }

        if (step.side === "buy") {
          const price = applySlippage(step.ask, "buy", SLIPPAGE_BPS);
          const qty = amount / price;
          const filled = applyFee(qty, FEE_BPS);
          executionLegs.push({
            symbol: step.symbol,
            side: "buy",
            price: step.ask,
            fill_price: price,
            qty: filled,
            fee_bps: FEE_BPS,
            slippage_bps: SLIPPAGE_BPS,
            base,
            quote
          });
          amount = filled;
        } else {
          const price = applySlippage(step.bid, "sell", SLIPPAGE_BPS);
          const quoteAmount = amount * price;
          const filled = applyFee(quoteAmount, FEE_BPS);
          executionLegs.push({
            symbol: step.symbol,
            side: "sell",
            price: step.bid,
            fill_price: price,
            qty: amount,
            fee_bps: FEE_BPS,
            slippage_bps: SLIPPAGE_BPS,
            base,
            quote
          });
          amount = filled;
        }
      }

      if (amount <= 0 || !Number.isFinite(amount)) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "amount_chain_failed" });
        continue;
      }

      if (amount <= notional_usd) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "edge_evaporated" });
        continue;
      }

      const realized = Number((amount - notional_usd).toFixed(4));

      const { data: position, error: positionError } = await adminSupabase
        .from("positions")
        .insert({
          user_id: userId,
          opportunity_id: opp.id,
          symbol: opp.symbol,
          mode: "paper",
          status: "closed",
          entry_spot_price: null,
          entry_perp_price: null,
          spot_qty: 0,
          perp_qty: 0,
          exit_ts: new Date().toISOString(),
          realized_pnl_usd: realized,
          meta: {
            opportunity_id: opp.id,
            type: "tri_arb",
            notional_usd,
            notional_reason: derived.reason,
            fee_bps: FEE_BPS,
            slippage_bps: SLIPPAGE_BPS,
            legs: executionLegs,
            auto_execute: true
          }
        })
        .select("id")
        .single();

      if (positionError || !position) {
        throw new Error(positionError?.message ?? "Failed to create position.");
      }

      const execPayload = executionLegs.map((leg, idx) => ({
        position_id: position.id,
        leg: `tri_leg_${idx + 1}`,
        requested_qty: Number(leg.qty ?? 0),
        filled_qty: Number(leg.qty ?? 0),
        avg_price: Number(leg.fill_price ?? 0),
        fee: 0,
        raw: leg
      }));

      const { error: executionError } = await adminSupabase
        .from("executions")
        .insert(execPayload);

      if (executionError) {
        throw new Error(executionError.message);
      }

      created += 1;
      if (decisionRow?.id) {
        await adminSupabase
          .from("opportunity_decisions")
          .update({ chosen: true, position_id: position.id })
          .eq("id", decisionRow.id);
      }
      continue;
    }

    skipped += 1;
    reasons.push({ opportunity_id: opp.id, reason: "execution_not_supported" });
  }

  return {
    attempted,
    created,
    skipped,
    reasons,
    llm_used: llmCallsUsed,
    llm_remaining: remainingLlmCalls
  };
}
