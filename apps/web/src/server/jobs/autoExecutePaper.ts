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
import { loadEffectivePolicy } from "@/server/policy/store";
import { runStrategyPolicyController } from "@/server/policy/controller";

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
const MAX_EXECUTE_PER_TICK = 2;
const MAX_ATTEMPTS_PER_TICK = 5;
const MAX_LLM_CALLS_PER_TICK = 3;
const MAX_LLM_RERANK = 3;
const MAX_LLM_CALLS_PER_DAY = 500;
const CONTRARIAN_UNTIL = process.env.CONTRARIAN_UNTIL ?? "";
const HIGH_THROUGHPUT_POSITIVE_MODE =
  (process.env.HIGH_THROUGHPUT_POSITIVE_MODE ?? "true").toLowerCase() === "true";
const BASE_LOOKBACK_HOURS = 6;
const WIDE_LOOKBACK_HOURS = 24;
const XARB_REGIME_RECENT_HOURS = 2;
const XARB_MAX_SIGNAL_AGE_HOURS = 3;
const XARB_MAX_SIGNAL_AGE_HOURS_LOW_ACTIVITY = 8;
const XARB_MAX_SIGNAL_AGE_HOURS_INACTIVITY = 12;
const MIN_NET_EDGE_BPS = 12;
const MIN_CONFIDENCE = 0.6;
const MAX_BREAK_EVEN_HOURS = 24;
const MIN_CARRY_FUNDING_DAILY_BPS = 4;
const MIN_XARB_NET_EDGE_BPS = 16;
const INACTIVITY_LOOKBACK_HOURS = 6;
const LOW_ACTIVITY_LOOKBACK_HOURS = 12;
const PNL_LOOKBACK_HOURS = 24;
const LIVE_CARRY_TOTAL_COSTS_BPS = 12;
const LIVE_CARRY_BUFFER_BPS = 3;
const LIVE_XARB_TOTAL_COSTS_BPS = 10;
const LIVE_XARB_BUFFER_BPS = 1;
const TRI_MIN_PROFIT_BPS = 6;
const LIVE_XARB_ENTRY_FLOOR_BPS = 1.0;
const PILOT_INACTIVITY_HOURS = 24;
const PILOT_MIN_LIVE_GROSS_EDGE_BPS = -0.5;
const PILOT_MIN_LIVE_NET_EDGE_BPS = 0.8;
const PILOT_NOTIONAL_MULTIPLIER = 0.25;
const CALIBRATION_MIN_LIVE_GROSS_EDGE_BPS = 2.0;
const CALIBRATION_MIN_LIVE_NET_EDGE_BPS = 0.8;
const CALIBRATION_NOTIONAL_MULTIPLIER = 0.08;
const RECOVERY_MIN_LIVE_GROSS_EDGE_BPS = 1.2;
const RECOVERY_MIN_LIVE_NET_EDGE_BPS = 0.8;
const RECOVERY_NOTIONAL_MULTIPLIER = 0.1;
const REENTRY_MIN_LIVE_GROSS_EDGE_BPS = 0.9;
const REENTRY_MIN_LIVE_NET_EDGE_BPS = 0.4;
const REENTRY_NOTIONAL_MULTIPLIER = 0.08;
const INACTIVITY_MIN_LIVE_GROSS_EDGE_BPS = 0.8;
const INACTIVITY_MIN_LIVE_NET_EDGE_BPS = 0.4;
const INACTIVITY_NOTIONAL_MULTIPLIER = 0.06;
const STARVATION_MIN_LIVE_GROSS_EDGE_BPS = 0.2;
const STARVATION_MIN_LIVE_NET_EDGE_BPS = 0.0;
const STARVATION_NOTIONAL_MULTIPLIER = 0.04;
const CONTROLLER_LOOKBACK_HOURS = 3;
const CONTROLLER_MIN_OPENINGS = 2;
const CONTROLLER_LONG_LOOKBACK_DAYS = 30;
const CONTROLLER_SHORT_WEIGHT = 0.65;
const CONTROLLER_LONG_WEIGHT = 0.35;
const CONTROLLER_MIN_CLOSED_SHORT = 2;
const CONTROLLER_MIN_CLOSED_LONG = 5;
const CONTROLLER_EMERGENCY_MIN_LIVE_GROSS_EDGE_BPS = 0.0;
const CONTROLLER_EMERGENCY_MIN_LIVE_NET_EDGE_BPS = 0.05;
const CONTROLLER_EMERGENCY_NOTIONAL_MULTIPLIER = 0.02;
const LOSING_MODE_TRIGGER_USD = -1;
const SEVERE_LOSS_BLOCK_USD = -10;

const STRATEGY_RISK_WEIGHT: Record<string, number> = {
  spot_perp_carry: 0,
  xarb_spot: 1,
  tri_arb: 2
};

const CORE_XARB_SYMBOLS = new Set(["BTCUSD", "ETHUSD"]);

const CANONICAL_MAP: Record<
  string,
  { bybit: string; okx: string; coinbase?: string; kraken?: string }
> = {
  BTCUSD: { bybit: "BTCUSDT", okx: "BTCUSDT", coinbase: "BTCUSD", kraken: "BTCUSD" },
  ETHUSD: { bybit: "ETHUSDT", okx: "ETHUSDT", coinbase: "ETHUSD", kraken: "ETHUSD" },
  SOLUSD: { bybit: "SOLUSDT", okx: "SOLUSDT", coinbase: "SOLUSD", kraken: "SOLUSD" },
  XRPUSD: { bybit: "XRPUSDT", okx: "XRPUSDT", coinbase: "XRPUSD", kraken: "XRPUSD" },
  BNBUSD: { bybit: "BNBUSDT", okx: "BNBUSDT", kraken: "BNBUSD" },
  ADAUSD: { bybit: "ADAUSDT", okx: "ADAUSDT", coinbase: "ADAUSD", kraken: "ADAUSD" },
  DOGEUSD: { bybit: "DOGEUSDT", okx: "DOGEUSDT" },
  AVAXUSD: { bybit: "AVAXUSDT", okx: "AVAXUSDT", coinbase: "AVAXUSD", kraken: "AVAXUSD" },
  LINKUSD: { bybit: "LINKUSDT", okx: "LINKUSDT", coinbase: "LINKUSD", kraken: "LINKUSD" },
  LTCUSD: { bybit: "LTCUSDT", okx: "LTCUSDT", coinbase: "LTCUSD", kraken: "LTCUSD" },
  DOTUSD: { bybit: "DOTUSDT", okx: "DOTUSDT", coinbase: "DOTUSD", kraken: "DOTUSD" },
  BCHUSD: { bybit: "BCHUSDT", okx: "BCHUSDT", coinbase: "BCHUSD", kraken: "BCHUSD" },
  TRXUSD: { bybit: "TRXUSDT", okx: "TRXUSDT", kraken: "TRXUSD" }
};

const KRAKEN_PAIR_MAP: Record<string, string> = {
  BTCUSD: "XXBTZUSD",
  ETHUSD: "XETHZUSD",
  SOLUSD: "SOLUSD",
  XRPUSD: "XXRPZUSD",
  BNBUSD: "BNBUSD",
  ADAUSD: "ADAUSD",
  AVAXUSD: "AVAXUSD",
  LINKUSD: "LINKUSD",
  LTCUSD: "XLTCZUSD",
  DOTUSD: "DOTUSD",
  BCHUSD: "BCHUSD",
  TRXUSD: "TRXUSD"
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

type CoinbaseTicker = {
  bid?: string;
  ask?: string;
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
  diagnostics: {
    opportunities_lookback: number;
    passed_filters: number;
    min_net_edge_bps: number;
    min_confidence: number;
    min_xarb_net_edge_bps: number;
    max_seen_net_edge_bps: number;
    max_seen_xarb_net_edge_bps: number;
    live_xarb_entry_floor_bps: number;
    live_xarb_dynamic_threshold_bps: number;
    xarb_max_signal_age_hours: number;
    lookback_hours_used: number;
    regime_xarb_edge_p70_bps: number;
    calibration_expectancy_24h_usd: number;
    calibration_closed_24h: number;
    calibration_disabled_by_expectancy: boolean;
    pilot_mode_active: boolean;
    inactivity_mode: boolean;
    emergency_mode: boolean;
    auto_opens_6h: number;
    auto_pnl_6h_usd: number;
    auto_opens_30d: number;
    auto_pnl_30d_usd: number;
    controller_window_hours: number;
    controller_long_window_days: number;
    strategy_blocked_types: string[];
    strategy_type_expectancy: Record<string, number>;
    policy_rollout_id: string | null;
    policy_config_id: string | null;
    policy_rollout_status: string;
    policy_is_canary: boolean;
    policy_controller_action: string;
    low_activity_mode: boolean;
    losing_mode: boolean;
    high_throughput_positive_mode: boolean;
    symbol_expectancy_bias: Record<string, number>;
    unfavorable_symbols: string[];
    blocked_symbols: string[];
    prefilter_reasons: Record<string, number>;
  };
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

  // Higher score is better.
  return edgeBonus + confidenceBonus - risk - breakEvenPenalty;
}

function inRange(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

  if (exchange === "coinbase") {
    const productId = symbol.replace("USD", "-USD");
    const data = await fetchJson<CoinbaseTicker>(
      `https://api.exchange.coinbase.com/products/${productId}/ticker`
    );
    const ask = toNumber(data.ask);
    const bid = toNumber(data.bid);
    if (!bid || !ask || ask <= bid) {
      throw new Error("Coinbase invalid bid/ask");
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

  const defaultDiagnostics = {
    opportunities_lookback: 0,
    passed_filters: 0,
    min_net_edge_bps: MIN_NET_EDGE_BPS,
    min_confidence: MIN_CONFIDENCE,
    min_xarb_net_edge_bps: MIN_XARB_NET_EDGE_BPS,
    max_seen_net_edge_bps: 0,
    max_seen_xarb_net_edge_bps: 0,
    live_xarb_entry_floor_bps: LIVE_XARB_ENTRY_FLOOR_BPS,
    live_xarb_dynamic_threshold_bps: 0,
    xarb_max_signal_age_hours: XARB_MAX_SIGNAL_AGE_HOURS,
    lookback_hours_used: BASE_LOOKBACK_HOURS,
    regime_xarb_edge_p70_bps: 0,
    calibration_expectancy_24h_usd: 0,
    calibration_closed_24h: 0,
    calibration_disabled_by_expectancy: false,
    pilot_mode_active: false,
    inactivity_mode: false,
    emergency_mode: false,
    auto_opens_6h: 0,
    auto_pnl_6h_usd: 0,
    auto_opens_30d: 0,
    auto_pnl_30d_usd: 0,
    controller_window_hours: CONTROLLER_LOOKBACK_HOURS,
    controller_long_window_days: CONTROLLER_LONG_LOOKBACK_DAYS,
    strategy_blocked_types: [],
    strategy_type_expectancy: {},
    policy_rollout_id: null,
    policy_config_id: null,
    policy_rollout_status: "default",
    policy_is_canary: false,
    policy_controller_action: "none",
    low_activity_mode: false,
    losing_mode: false,
    high_throughput_positive_mode: HIGH_THROUGHPUT_POSITIVE_MODE,
    symbol_expectancy_bias: {},
    unfavorable_symbols: [],
    blocked_symbols: [],
    prefilter_reasons: {}
  };

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
        llm_remaining: 0,
        diagnostics: defaultDiagnostics
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

  let policyControllerAction = "none";
  try {
    const controllerResult = await runStrategyPolicyController(adminSupabase, userId);
    policyControllerAction = controllerResult.action ?? (controllerResult.skipped ? "skipped" : "none");
  } catch (err) {
    policyControllerAction = "error";
  }

  const effectivePolicy = await loadEffectivePolicy(adminSupabase, userId);
  const policy = effectivePolicy.policy;
  const hasStableActiveRollout =
    effectivePolicy.rollout_status === "active" && !effectivePolicy.is_canary;
  const activeObserveMode =
    hasStableActiveRollout &&
    (policyControllerAction === "active_observe" ||
      policyControllerAction === "skipped" ||
      policyControllerAction === "promotion_hold");

  const maxExecutePerTick = Math.max(
    1,
    Math.round(policy.max_execute_per_tick) +
      (activeObserveMode ? 1 : 0) +
      (HIGH_THROUGHPUT_POSITIVE_MODE ? 1 : 0)
  );
  const maxAttemptsPerTick = Math.max(
    1,
    Math.round(policy.max_attempts_per_tick) +
      (activeObserveMode ? 2 : 0) +
      (HIGH_THROUGHPUT_POSITIVE_MODE ? 2 : 0)
  );
  const candidateLimit = activeObserveMode
    ? Math.max(MAX_CANDIDATES + 4 + (HIGH_THROUGHPUT_POSITIVE_MODE ? 4 : 0), maxAttemptsPerTick + 2)
    : MAX_CANDIDATES + (HIGH_THROUGHPUT_POSITIVE_MODE ? 4 : 0);
  const liveXarbEntryFloorBps = policy.live_xarb_entry_floor_bps;
  const liveXarbTotalCostsBps = policy.live_xarb_total_costs_bps;
  const liveXarbBufferBps = policy.live_xarb_buffer_bps;
  const pilotMinLiveGrossEdgeBps = policy.pilot_min_live_gross_edge_bps;
  const pilotMinLiveNetEdgeBps = policy.pilot_min_live_net_edge_bps;
  const pilotNotionalMultiplier = policy.pilot_notional_multiplier;
  const calibrationMinLiveGrossEdgeBps = policy.calibration_min_live_gross_edge_bps;
  const calibrationMinLiveNetEdgeBps = policy.calibration_min_live_net_edge_bps;
  const calibrationNotionalMultiplier = policy.calibration_notional_multiplier;
  const recoveryMinLiveGrossEdgeBps = policy.recovery_min_live_gross_edge_bps;
  const recoveryMinLiveNetEdgeBps = policy.recovery_min_live_net_edge_bps;
  const recoveryNotionalMultiplier = policy.recovery_notional_multiplier;
  const reentryMinLiveGrossEdgeBps = policy.reentry_min_live_gross_edge_bps;
  const reentryMinLiveNetEdgeBps = policy.reentry_min_live_net_edge_bps;
  const reentryNotionalMultiplier = policy.reentry_notional_multiplier;
  const inactivityMinLiveGrossEdgeBps = policy.inactivity_min_live_gross_edge_bps;
  const inactivityMinLiveNetEdgeBps = policy.inactivity_min_live_net_edge_bps;
  const inactivityNotionalMultiplier = policy.inactivity_notional_multiplier;
  const starvationMinLiveGrossEdgeBps = policy.starvation_min_live_gross_edge_bps;
  const starvationMinLiveNetEdgeBps = policy.starvation_min_live_net_edge_bps;
  const starvationNotionalMultiplier = policy.starvation_notional_multiplier;
  const controllerLookbackHours = policy.controller_lookback_hours;
  const controllerMinOpenings = policy.controller_min_openings;
  const controllerLongLookbackDays = policy.controller_long_lookback_days;
  const controllerShortWeight = policy.controller_short_weight;
  const controllerLongWeight = policy.controller_long_weight;
  const controllerMinClosedShort = policy.controller_min_closed_short;
  const controllerMinClosedLong = policy.controller_min_closed_long;
  const controllerEmergencyMinLiveGrossEdgeBps = policy.controller_emergency_min_live_gross_edge_bps;
  const controllerEmergencyMinLiveNetEdgeBps = policy.controller_emergency_min_live_net_edge_bps;
  const controllerEmergencyNotionalMultiplier = policy.controller_emergency_notional_multiplier;

  const { data: openPositions, error: openError } = await adminSupabase
    .from("positions")
    .select("id, symbol")
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
      llm_remaining: 0,
      diagnostics: defaultDiagnostics
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

  const maxNewPerHour = HIGH_THROUGHPUT_POSITIVE_MODE ? MAX_NEW_PER_HOUR + 2 : MAX_NEW_PER_HOUR;
  if ((recentPositions ?? []).length >= maxNewPerHour) {
    return {
      attempted: 0,
      created: 0,
      skipped: 0,
      reasons: [],
      llm_used: 0,
      llm_remaining: 0,
      diagnostics: defaultDiagnostics
    };
  }

  const controllerSince = new Date(
    Date.now() - controllerLookbackHours * 60 * 60 * 1000
  ).toISOString();
  const controllerLongSince = new Date(
    Date.now() - controllerLongLookbackDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: recentAutoPositions, error: recentAutoError } = await adminSupabase
    .from("positions")
    .select("entry_ts, exit_ts, realized_pnl_usd, symbol, meta")
    .eq("user_id", userId)
    .gte("entry_ts", controllerSince)
    .limit(300);

  if (recentAutoError) {
    throw new Error(recentAutoError.message);
  }
  const { data: longAutoPositions, error: longAutoError } = await adminSupabase
    .from("positions")
    .select("entry_ts, exit_ts, realized_pnl_usd, symbol, meta")
    .eq("user_id", userId)
    .gte("entry_ts", controllerLongSince)
    .limit(2000);

  if (longAutoError) {
    throw new Error(longAutoError.message);
  }

  const autoRows = (recentAutoPositions ?? []).filter((row) => {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    return meta.auto_execute === true;
  });
  const autoRowsLong = (longAutoPositions ?? []).filter((row) => {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    return meta.auto_execute === true;
  });
  const autoOpens6h = autoRows.length;
  const lastMicroProbeEntryMs = autoRows.reduce((max, row) => {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    if (meta.micro_probe_open !== true) return max;
    const ts = Date.parse(String(row.entry_ts ?? ""));
    return Number.isFinite(ts) ? Math.max(max, ts) : max;
  }, Number.NEGATIVE_INFINITY);
  const microProbeCooldownMinutes = 10;
  const microProbeCooldownPassed =
    !Number.isFinite(lastMicroProbeEntryMs) ||
    Date.now() - lastMicroProbeEntryMs >= microProbeCooldownMinutes * 60 * 1000;
  const autoPnl6h = autoRows.reduce((sum, row) => {
    if (!row.exit_ts) {
      return sum;
    }
    return sum + Number(row.realized_pnl_usd ?? 0);
  }, 0);
  const forceProbeMode =
    autoOpens6h <= (HIGH_THROUGHPUT_POSITIVE_MODE ? 2 : 1) &&
    microProbeCooldownPassed &&
    autoPnl6h >= 0;
  const autoPnl30d = autoRowsLong.reduce((sum, row) => {
    if (!row.exit_ts) {
      return sum;
    }
    return sum + Number(row.realized_pnl_usd ?? 0);
  }, 0);
  const forceProbeNetFloorBps = autoPnl6h < 0 ? -0.4 : -0.6;
  const forceProbeGrossFloorBps = autoPnl6h < 0 ? 1.5 : 1.0;

  const closedAutoRows = autoRows.filter((row) => row.exit_ts);
  type OpenTypeKey =
    | "pilot"
    | "calibration"
    | "recovery"
    | "reentry"
    | "inactivity"
    | "starvation"
    | "emergency"
    | "normal";
  const typeStatsShort: Record<OpenTypeKey, { count: number; pnl: number }> = {
    pilot: { count: 0, pnl: 0 },
    calibration: { count: 0, pnl: 0 },
    recovery: { count: 0, pnl: 0 },
    reentry: { count: 0, pnl: 0 },
    inactivity: { count: 0, pnl: 0 },
    starvation: { count: 0, pnl: 0 },
    emergency: { count: 0, pnl: 0 },
    normal: { count: 0, pnl: 0 }
  };
  const typeStatsLong: Record<OpenTypeKey, { count: number; pnl: number }> = {
    pilot: { count: 0, pnl: 0 },
    calibration: { count: 0, pnl: 0 },
    recovery: { count: 0, pnl: 0 },
    reentry: { count: 0, pnl: 0 },
    inactivity: { count: 0, pnl: 0 },
    starvation: { count: 0, pnl: 0 },
    emergency: { count: 0, pnl: 0 },
    normal: { count: 0, pnl: 0 }
  };
  const rowOpenType = (meta: Record<string, unknown>): OpenTypeKey => {
    if (meta.pilot_open === true) return "pilot";
    if (meta.calibration_open === true) return "calibration";
    if (meta.recovery_open === true) return "recovery";
    if (meta.reentry_open === true) return "reentry";
    if (meta.inactivity_open === true) return "inactivity";
    if (meta.starvation_open === true) return "starvation";
    if (meta.emergency_open === true) return "emergency";
    return "normal";
  };
  for (const row of closedAutoRows) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const key = rowOpenType(meta);
    typeStatsShort[key].count += 1;
    typeStatsShort[key].pnl += Number(row.realized_pnl_usd ?? 0);
  }
  const closedAutoRowsLong = autoRowsLong.filter((row) => row.exit_ts);
  for (const row of closedAutoRowsLong) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const key = rowOpenType(meta);
    typeStatsLong[key].count += 1;
    typeStatsLong[key].pnl += Number(row.realized_pnl_usd ?? 0);
  }

  const typeExpectancy: Record<string, number> = {};
  const symbolStats = new Map<string, { count: number; pnl: number }>();
  for (const row of closedAutoRowsLong) {
    const symbol = String((row as { symbol?: string | null }).symbol ?? "");
    if (!symbol) continue;
    const cur = symbolStats.get(symbol) ?? { count: 0, pnl: 0 };
    cur.count += 1;
    cur.pnl += Number(row.realized_pnl_usd ?? 0);
    symbolStats.set(symbol, cur);
  }
  const symbolExpectancyBias: Record<string, number> = {};
  const symbolTradeCount: Record<string, number> = {};
  const symbolWinCount: Record<string, number> = {};
  for (const [symbol, stat] of symbolStats.entries()) {
    symbolTradeCount[symbol] = stat.count;
    if (stat.count < 2) continue;
    symbolExpectancyBias[symbol] = Number((stat.pnl / stat.count).toFixed(4));
  }
  for (const row of closedAutoRowsLong) {
    const symbol = String((row as { symbol?: string | null }).symbol ?? "");
    if (!symbol) continue;
    if (Number(row.realized_pnl_usd ?? 0) > 0) {
      symbolWinCount[symbol] = (symbolWinCount[symbol] ?? 0) + 1;
    }
  }
  const unfavorableSymbols = Object.entries(symbolExpectancyBias)
    .filter(([symbol, expectancy]) => {
      const count = symbolTradeCount[symbol] ?? 0;
      const wins = symbolWinCount[symbol] ?? 0;
      return count >= 8 && expectancy <= -0.08 && wins <= 1;
    })
    .map(([symbol]) => symbol);
  const blockedSymbols = Object.entries(symbolExpectancyBias)
    .filter(([symbol, expectancy]) => {
      const count = symbolTradeCount[symbol] ?? 0;
      const wins = symbolWinCount[symbol] ?? 0;
      return count >= 12 && expectancy <= -0.12 && wins === 0;
    })
    .map(([symbol]) => symbol);
  const blockedSymbolSet = new Set(blockedSymbols);
  const unfavorableSymbolSet = new Set(unfavorableSymbols);
  const isTypeEnabled = (key: OpenTypeKey) => {
    const short = typeStatsShort[key];
    const long = typeStatsLong[key];
    const shortReady = short.count >= controllerMinClosedShort;
    const longReady = long.count >= controllerMinClosedLong;
    const shortExp = shortReady ? short.pnl / short.count : null;
    const longExp = longReady ? long.pnl / long.count : null;

    if (shortExp === null && longExp === null) {
      typeExpectancy[key] = 0;
      return true;
    }

    const weighted =
      (shortExp ?? 0) * controllerShortWeight +
      (longExp ?? 0) * controllerLongWeight;
    typeExpectancy[key] = Number(weighted.toFixed(4));
    return weighted > 0;
  };
  const blockedTypes = (Object.keys(typeStatsShort) as OpenTypeKey[]).filter((k) => !isTypeEnabled(k));

  const inactivitySince = new Date(
    Date.now() - INACTIVITY_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();
  const lowActivitySince = new Date(
    Date.now() - LOW_ACTIVITY_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();
  const pilotInactivitySince = new Date(
    Date.now() - PILOT_INACTIVITY_HOURS * 60 * 60 * 1000
  ).toISOString();
  const { data: inactivityPositions, error: inactivityError } = await adminSupabase
    .from("positions")
    .select("id")
    .eq("user_id", userId)
    .gte("entry_ts", inactivitySince);

  if (inactivityError) {
    throw new Error(inactivityError.message);
  }

  const { data: lowActivityPositions, error: lowActivityError } = await adminSupabase
    .from("positions")
    .select("id")
    .eq("user_id", userId)
    .gte("entry_ts", lowActivitySince);

  if (lowActivityError) {
    throw new Error(lowActivityError.message);
  }

  const { data: pilotInactivityPositions, error: pilotInactivityError } = await adminSupabase
    .from("positions")
    .select("id")
    .eq("user_id", userId)
    .gte("entry_ts", pilotInactivitySince)
    .limit(1);

  if (pilotInactivityError) {
    throw new Error(pilotInactivityError.message);
  }

  const pnlSince = new Date(Date.now() - PNL_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data: recentClosed, error: recentClosedError } = await adminSupabase
    .from("positions")
    .select("realized_pnl_usd")
    .eq("user_id", userId)
    .eq("status", "closed")
    .gte("exit_ts", pnlSince)
    .not("realized_pnl_usd", "is", null)
    .limit(200);

  if (recentClosedError) {
    throw new Error(recentClosedError.message);
  }

  const recentPnlUsd = (recentClosed ?? []).reduce((sum, row) => {
    return sum + Number((row as { realized_pnl_usd?: number | null }).realized_pnl_usd ?? 0);
  }, 0);

  const { data: recentCalibrationClosed, error: recentCalibrationClosedError } = await adminSupabase
    .from("positions")
    .select("realized_pnl_usd, meta")
    .eq("user_id", userId)
    .eq("status", "closed")
    .gte("exit_ts", pnlSince)
    .not("realized_pnl_usd", "is", null)
    .limit(200);

  if (recentCalibrationClosedError) {
    throw new Error(recentCalibrationClosedError.message);
  }

  const calibrationPnls = (recentCalibrationClosed ?? [])
    .filter((row) => {
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      return meta.auto_execute === true && meta.calibration_open === true;
    })
    .map((row) => Number(row.realized_pnl_usd ?? 0))
    .filter((v) => Number.isFinite(v));
  const calibrationClosedCount = calibrationPnls.length;
  const calibrationPnlSum = calibrationPnls.reduce((sum, v) => sum + v, 0);
  const calibrationExpectancy = calibrationClosedCount > 0 ? calibrationPnlSum / calibrationClosedCount : 0;
  const disableCalibrationByExpectancy =
    calibrationClosedCount >= 4 && calibrationExpectancy < -0.02;

  const hasInactivity = (inactivityPositions ?? []).length === 0;
  const lowActivity =
    (lowActivityPositions ?? []).length <= 1 ||
    (recentPositions ?? []).length <= 1;
  const prolongedInactivity = (pilotInactivityPositions ?? []).length === 0;
  const losingRecently = recentPnlUsd <= LOSING_MODE_TRIGGER_USD;
  const severeLosing = recentPnlUsd <= SEVERE_LOSS_BLOCK_USD;

  let minNetEdgeBps = MIN_NET_EDGE_BPS;
  let minConfidence = MIN_CONFIDENCE;
  let minXarbNetEdgeBps = MIN_XARB_NET_EDGE_BPS;

  if (hasInactivity || lowActivity) {
    minNetEdgeBps -= 12;
    minConfidence -= 0.04;
    minXarbNetEdgeBps -= 15;
  }

  if (losingRecently) {
    minNetEdgeBps += 1;
    minConfidence += 0.02;
    minXarbNetEdgeBps += 1;
  }

  // In prolonged inactivity/pilot state, let live edge checks do the final gating.
  if (hasInactivity && prolongedInactivity && !severeLosing) {
    minXarbNetEdgeBps -= 1;
  }

  minNetEdgeBps = inRange(minNetEdgeBps, -2, 18);
  minConfidence = inRange(minConfidence, 0.56, 0.8);
  minXarbNetEdgeBps = inRange(minXarbNetEdgeBps, -2, 28);
  if (hasInactivity) {
    minXarbNetEdgeBps = Math.min(minXarbNetEdgeBps, 0.5);
  }

  const prefilterReasons: Record<string, number> = {};
  const markPrefilter = (reason: string) => {
    prefilterReasons[reason] = (prefilterReasons[reason] ?? 0) + 1;
  };

  const lookbackHours =
    lowActivity || losingRecently
      ? HIGH_THROUGHPUT_POSITIVE_MODE
        ? Math.max(WIDE_LOOKBACK_HOURS, 6)
        : WIDE_LOOKBACK_HOURS
      : HIGH_THROUGHPUT_POSITIVE_MODE
        ? Math.max(BASE_LOOKBACK_HOURS, 3)
        : BASE_LOOKBACK_HOURS;
  const sinceOpps = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const { data: opportunities, error: oppError } = await adminSupabase
    .from("opportunities")
    .select("id, ts, exchange, symbol, type, net_edge_bps, confidence, details, status")
    .gte("ts", sinceOpps)
    .order("ts", { ascending: false })
    .limit(240);

  if (oppError) {
    throw new Error(oppError.message);
  }

  const maxSeenNetEdgeBps = (opportunities ?? []).reduce((max, opp) => {
    return Math.max(max, Number((opp as OpportunityRow).net_edge_bps ?? 0));
  }, Number.NEGATIVE_INFINITY);
  const maxSeenXarbNetEdgeBps = (opportunities ?? [])
    .filter((opp) => (opp as OpportunityRow).type === "xarb_spot")
    .reduce((max, opp) => Math.max(max, Number((opp as OpportunityRow).net_edge_bps ?? 0)), Number.NEGATIVE_INFINITY);
  const xarbEdgesSorted = (opportunities ?? [])
    .filter((opp) => (opp as OpportunityRow).type === "xarb_spot")
    .map((opp) => Number((opp as OpportunityRow).net_edge_bps ?? 0))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const recentCutoffMs = Date.now() - XARB_REGIME_RECENT_HOURS * 60 * 60 * 1000;
  const recentXarbEdgesSorted = (opportunities ?? [])
    .filter((opp) => (opp as OpportunityRow).type === "xarb_spot")
    .filter((opp) => Date.parse((opp as OpportunityRow).ts) >= recentCutoffMs)
    .map((opp) => Number((opp as OpportunityRow).net_edge_bps ?? 0))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const regimeXarbEdgeP70 =
    xarbEdgesSorted.length > 0
      ? xarbEdgesSorted[Math.min(xarbEdgesSorted.length - 1, Math.floor(xarbEdgesSorted.length * 0.7))]
      : 0;
  const regimeXarbEdgeRecentP60 =
    recentXarbEdgesSorted.length > 0
      ? recentXarbEdgesSorted[
          Math.min(recentXarbEdgesSorted.length - 1, Math.floor(recentXarbEdgesSorted.length * 0.6))
        ]
      : 0;
  const regimeXarbEdgeBps = Number.isFinite(maxSeenXarbNetEdgeBps) ? maxSeenXarbNetEdgeBps : 0;
  if (regimeXarbEdgeBps > 0) {
    // Adapt base thresholds to current market regime instead of fixed hard gates.
    minNetEdgeBps = Math.min(minNetEdgeBps, Math.max(-1, regimeXarbEdgeBps * 0.4));
    minXarbNetEdgeBps = Math.min(minXarbNetEdgeBps, Math.max(0, regimeXarbEdgeBps * 0.55));
  }
  const regimeAnchor = Math.max(
    regimeXarbEdgeRecentP60,
    regimeXarbEdgeP70 * 0.7,
    regimeXarbEdgeBps * 0.2
  );
  const losingPenalty = losingRecently ? (disableCalibrationByExpectancy ? 0.25 : 0.5) : 0;
  const baseLiveThreshold = Math.max(minXarbNetEdgeBps - 1, regimeAnchor * 0.55);
  const starvationMode = hasInactivity && prolongedInactivity && !losingRecently && !severeLosing;
  const emergencyMode =
    starvationMode &&
    autoOpens6h < controllerMinOpenings &&
    autoPnl6h > -1.0 &&
    autoPnl30d > -8.0;
  const xarbMaxSignalAgeHours = hasInactivity
    ? XARB_MAX_SIGNAL_AGE_HOURS_INACTIVITY
    : lowActivity
      ? XARB_MAX_SIGNAL_AGE_HOURS_LOW_ACTIVITY
      : XARB_MAX_SIGNAL_AGE_HOURS;
  const activeObserveThresholdDiscountBps = activeObserveMode ? 0.9 : 0;
  const liveXarbThresholdBps =
    emergencyMode
      ? Math.max(-0.15, Math.min(0.4, baseLiveThreshold * 0.15))
      : starvationMode
      ? Math.max(0.0, Math.min(0.8, baseLiveThreshold * 0.25))
      : hasInactivity || lowActivity
      ? Math.max(0.35, Math.min(2.1, baseLiveThreshold + losingPenalty))
      : Math.max(0.9, Math.min(2.6, baseLiveThreshold + losingPenalty));
  const adjustedLiveXarbThresholdBps = Math.max(
    -0.25,
    liveXarbThresholdBps - activeObserveThresholdDiscountBps
  );
  const pilotModeActive = prolongedInactivity && !severeLosing;

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
    .select("id, realized_pnl_usd, status")
    .eq("status", "closed")
    .not("realized_pnl_usd", "is", null)
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

  const contrarianActive =
    CONTRARIAN_UNTIL.length > 0 &&
    Number.isFinite(Date.parse(CONTRARIAN_UNTIL)) &&
    Date.now() < Date.parse(CONTRARIAN_UNTIL);

  let scored: ScoredOpportunity[] = (opportunities ?? [])
    // Keep only the newest opportunity per (type, symbol, exchange) key to avoid retrying stale snapshots.
    .filter((opp, idx, arr) => {
      const typed = opp as OpportunityRow;
      const key = `${typed.type}|${typed.symbol}|${typed.exchange}`;
      const firstIdx = arr.findIndex((x) => {
        const row = x as OpportunityRow;
        return `${row.type}|${row.symbol}|${row.exchange}` === key;
      });
      return firstIdx === idx;
    })
    .filter((opp) => {
      const symbol = (opp as { symbol?: string }).symbol ?? "";
      if (!symbol) {
        markPrefilter("missing_symbol");
        return false;
      }
      if ((openBySymbol.get(symbol) ?? 0) >= MAX_OPEN_PER_SYMBOL) {
        markPrefilter("max_open_per_symbol");
        return false;
      }

      const typed = opp as OpportunityRow;
      const netEdge = Number(typed.net_edge_bps ?? 0);
      const confidence = Number(typed.confidence ?? 0);
      const details = typed.details ?? {};
      const breakEven = Number((details as Record<string, unknown>).break_even_hours ?? NaN);
      if (typed.type === "tri_arb") {
        markPrefilter("tri_arb_disabled");
        return false;
      }
      if (typed.type === "xarb_spot" && blockedSymbolSet.has(typed.symbol)) {
        markPrefilter("blocked_symbol");
        return false;
      }
      const relaxedXarbPrefilter = false;
      const effectiveMinNetEdgeBps = relaxedXarbPrefilter ? -5 : minNetEdgeBps;
      const effectiveMinXarbNetEdgeBps = relaxedXarbPrefilter
        ? Math.min(-3, minXarbNetEdgeBps)
        : minXarbNetEdgeBps;
      const effectiveXarbMaxSignalAgeHours = relaxedXarbPrefilter
        ? Math.max(24, xarbMaxSignalAgeHours)
        : Math.min(xarbMaxSignalAgeHours, 2);

      if (netEdge < effectiveMinNetEdgeBps) {
        markPrefilter("below_min_net_edge");
        return false;
      }
      const typeConfidenceMin =
        typed.type === "xarb_spot"
          ? relaxedXarbPrefilter
            ? 0.42
            : Math.max(0.54, minConfidence - 0.08)
          : typed.type === "tri_arb"
            ? Math.max(0.54, minConfidence - 0.08)
            : minConfidence;
      if (confidence < typeConfidenceMin) {
        markPrefilter("below_min_confidence");
        return false;
      }
      if (Number.isFinite(breakEven) && breakEven > MAX_BREAK_EVEN_HOURS) {
        markPrefilter("break_even_too_long");
        return false;
      }
      if (typed.type === "spot_perp_carry") {
        const fundingDailyBps = Number(
          (details as Record<string, unknown>).funding_daily_bps ?? NaN
        );
        if (Number.isFinite(fundingDailyBps) && fundingDailyBps < MIN_CARRY_FUNDING_DAILY_BPS) {
          markPrefilter("carry_funding_too_low");
          return false;
        }
      }
      if (typed.type === "xarb_spot" && netEdge < effectiveMinXarbNetEdgeBps) {
        markPrefilter("xarb_below_min_edge");
        return false;
      }
      if (typed.type === "xarb_spot") {
        const ageHours = (Date.now() - Date.parse(typed.ts)) / (60 * 60 * 1000);
        if (!Number.isFinite(ageHours) || ageHours > effectiveXarbMaxSignalAgeHours) {
          markPrefilter("stale_xarb_signal");
          return false;
        }
      }
      return true;
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
      let effectiveScore = variant === "B" && aiScore !== null ? aiScore : opp.score;
      if (HIGH_THROUGHPUT_POSITIVE_MODE) {
        const symbolBias = symbolExpectancyBias[opp.symbol] ?? 0;
        // favor symbols with better realized expectancy and demote chronic losers
        effectiveScore += Math.max(-0.25, Math.min(0.25, symbolBias / 4));
      }
      if (variant === "B" && contrarianActive) {
        effectiveScore = -effectiveScore;
      }
      return { ...opp, variant, aiScore, effectiveScore };
    })
    .sort((a, b) => b.effectiveScore - a.effectiveScore)
    .slice(0, candidateLimit);

  const diagnostics = {
    opportunities_lookback: (opportunities ?? []).length,
    passed_filters: scored.length,
    min_net_edge_bps: Number(minNetEdgeBps.toFixed(2)),
    min_confidence: Number(minConfidence.toFixed(3)),
    min_xarb_net_edge_bps: Number(minXarbNetEdgeBps.toFixed(2)),
    max_seen_net_edge_bps: Number.isFinite(maxSeenNetEdgeBps) ? Number(maxSeenNetEdgeBps.toFixed(4)) : 0,
    max_seen_xarb_net_edge_bps: Number.isFinite(maxSeenXarbNetEdgeBps) ? Number(maxSeenXarbNetEdgeBps.toFixed(4)) : 0,
    live_xarb_entry_floor_bps: liveXarbEntryFloorBps,
    live_xarb_dynamic_threshold_bps: Number(adjustedLiveXarbThresholdBps.toFixed(4)),
    active_observe_threshold_discount_bps: Number(activeObserveThresholdDiscountBps.toFixed(4)),
    xarb_max_signal_age_hours: xarbMaxSignalAgeHours,
    lookback_hours_used: lookbackHours,
    regime_xarb_edge_p70_bps: Number(regimeXarbEdgeP70.toFixed(4)),
    calibration_expectancy_24h_usd: Number(calibrationExpectancy.toFixed(4)),
    calibration_closed_24h: calibrationClosedCount,
    calibration_disabled_by_expectancy: disableCalibrationByExpectancy,
    pilot_mode_active: pilotModeActive,
    inactivity_mode: hasInactivity,
    emergency_mode: emergencyMode,
    auto_opens_6h: autoOpens6h,
    auto_pnl_6h_usd: Number(autoPnl6h.toFixed(4)),
    auto_opens_30d: autoRowsLong.length,
    auto_pnl_30d_usd: Number(autoPnl30d.toFixed(4)),
    controller_window_hours: controllerLookbackHours,
    controller_long_window_days: controllerLongLookbackDays,
    strategy_blocked_types: blockedTypes,
    strategy_type_expectancy: typeExpectancy,
    policy_rollout_id: effectivePolicy.rollout_id,
    policy_config_id: effectivePolicy.config_id,
    policy_rollout_status: effectivePolicy.rollout_status,
    policy_is_canary: effectivePolicy.is_canary,
    policy_controller_action: policyControllerAction,
    active_observe_mode: activeObserveMode,
    active_observe_probe_band_bps: activeObserveMode ? 0.9 : 0,
    active_observe_micro_probe_net_floor_bps: activeObserveMode ? -0.25 : 0,
    force_probe_mode: forceProbeMode,
    force_probe_net_floor_bps: forceProbeNetFloorBps,
    force_probe_gross_floor_bps: forceProbeGrossFloorBps,
    micro_probe_cooldown_minutes: microProbeCooldownMinutes,
    low_activity_mode: lowActivity,
    losing_mode: losingRecently,
    high_throughput_positive_mode: HIGH_THROUGHPUT_POSITIVE_MODE,
    symbol_expectancy_bias: symbolExpectancyBias,
    unfavorable_symbols: unfavorableSymbols,
    blocked_symbols: blockedSymbols,
    prefilter_reasons: prefilterReasons
  };

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

  scored = scoredWithLlm.sort((a, b) => b.effectiveScore - a.effectiveScore);

  let attempted = 0;
  let created = 0;
  let skipped = 0;
  const reasons: Array<{ opportunity_id: number; reason: string }> = [];
  let forceProbeOpenedThisTick = false;

  let available = Math.max(0, balance - reserved);
  let reservedCurrent = reserved;

  for (const opp of scored.slice(0, maxAttemptsPerTick)) {
    if (created >= maxExecutePerTick) {
      break;
    }
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
    let notional_usd = derived.notional;

    if (notional_usd > available && opp.type !== "xarb_spot") {
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

      const details = opp.details ?? {};
      const fundingDailyBps = Number(
        (details as Record<string, unknown>).funding_daily_bps ?? 0
      );
      const expectedHoldingBps = fundingDailyBps * (lookbackHours / 24);
      const liveBasisBps = ((snapshot.perp_bid - snapshot.spot_ask) / snapshot.spot_ask) * 10000;
      const liveNetEdgeBps =
        liveBasisBps + expectedHoldingBps - LIVE_CARRY_TOTAL_COSTS_BPS - LIVE_CARRY_BUFFER_BPS;

      if (liveNetEdgeBps < minNetEdgeBps) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "live_edge_below_threshold" });
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
            auto_execute: true,
            policy_rollout_id: effectivePolicy.rollout_id,
            policy_config_id: effectivePolicy.config_id,
            policy_is_canary: effectivePolicy.is_canary
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
        buyExchange === "kraken"
          ? mapping.kraken
          : buyExchange === "coinbase"
            ? mapping.coinbase
            : buyExchange === "okx"
              ? mapping.okx
              : mapping.bybit;
      const sellSymbol =
        sellExchange === "kraken"
          ? mapping.kraken
          : sellExchange === "coinbase"
            ? mapping.coinbase
            : sellExchange === "okx"
              ? mapping.okx
              : mapping.bybit;

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

      const liveGrossEdgeBps = ((sellQuote.bid - buyQuote.ask) / buyQuote.ask) * 10000;
      const liveNetEdgeBps =
        liveGrossEdgeBps - liveXarbTotalCostsBps - liveXarbBufferBps;
      const symbolBias = symbolExpectancyBias[opp.symbol] ?? 0;
      const symbolClosedCount = symbolTradeCount[opp.symbol] ?? 0;
      const unfavorableSymbol = unfavorableSymbolSet.has(opp.symbol);
      const favorableSymbol = symbolClosedCount >= 2 && symbolBias > 0.02;
      const isCoreXarbSymbol = CORE_XARB_SYMBOLS.has(opp.symbol);
      const xarbQualityNetFloor =
        opp.type === "xarb_spot"
          ? favorableSymbol
            ? Math.max(adjustedLiveXarbThresholdBps, 4.5)
            : unfavorableSymbol
              ? Math.max(adjustedLiveXarbThresholdBps, isCoreXarbSymbol ? 8 : 6)
              : Math.max(adjustedLiveXarbThresholdBps, isCoreXarbSymbol ? 5 : 3)
          : adjustedLiveXarbThresholdBps;
      const xarbQualityGrossFloor =
        opp.type === "xarb_spot"
          ? favorableSymbol
            ? 14
            : unfavorableSymbol
              ? (isCoreXarbSymbol ? 18 : 15)
              : (isCoreXarbSymbol ? 14 : 10)
          : 0;
      const meetsXarbQualityFloor =
        opp.type !== "xarb_spot" ||
        (liveNetEdgeBps >= xarbQualityNetFloor && liveGrossEdgeBps >= xarbQualityGrossFloor);
      const positiveExplorationMode =
        !losingRecently &&
        (activeObserveMode || autoPnl30d > 0) &&
        autoOpens6h < Math.max(2, controllerMinOpenings + 1);
      const positiveEdgeRelaxBps = positiveExplorationMode ? (activeObserveMode ? 0.25 : 0.12) : 0;
      const nearThresholdBufferBps = positiveExplorationMode ? (activeObserveMode ? 0.45 : 0.25) : 0;
      const xarbPolicyHardBlocked =
        blockedTypes.includes("normal") &&
        blockedTypes.includes("pilot") &&
        blockedTypes.includes("calibration");
      const canRiskClampXarbOpen =
        xarbPolicyHardBlocked &&
        opp.type === "xarb_spot" &&
        !losingRecently &&
        !severeLosing &&
        liveGrossEdgeBps >= (isCoreXarbSymbol ? 10 : 7) &&
        liveNetEdgeBps >= (isCoreXarbSymbol ? 2.5 : 1.25);
      const canPilotOpen =
        isTypeEnabled("pilot") &&
        pilotModeActive &&
        liveGrossEdgeBps >= pilotMinLiveGrossEdgeBps &&
        liveNetEdgeBps >= pilotMinLiveNetEdgeBps - positiveEdgeRelaxBps;
      const canCalibrationOpen =
        isTypeEnabled("calibration") &&
        (hasInactivity || lowActivity) &&
        !losingRecently &&
        !disableCalibrationByExpectancy &&
        liveGrossEdgeBps >= calibrationMinLiveGrossEdgeBps &&
        liveNetEdgeBps >= calibrationMinLiveNetEdgeBps;
      const canRecoveryOpen =
        isTypeEnabled("recovery") &&
        hasInactivity &&
        losingRecently &&
        !severeLosing &&
        liveGrossEdgeBps >= recoveryMinLiveGrossEdgeBps &&
        liveNetEdgeBps >= recoveryMinLiveNetEdgeBps;
      const canReentryOpen =
        isTypeEnabled("reentry") &&
        (hasInactivity || lowActivity) &&
        !losingRecently &&
        disableCalibrationByExpectancy &&
        liveGrossEdgeBps >= reentryMinLiveGrossEdgeBps &&
        liveNetEdgeBps >= reentryMinLiveNetEdgeBps - positiveEdgeRelaxBps;
      const canInactivityOpen =
        isTypeEnabled("inactivity") &&
        hasInactivity &&
        !losingRecently &&
        !severeLosing &&
        liveGrossEdgeBps >= inactivityMinLiveGrossEdgeBps &&
        liveNetEdgeBps >= inactivityMinLiveNetEdgeBps - positiveEdgeRelaxBps;
      const canStarvationOpen =
        isTypeEnabled("starvation") &&
        starvationMode &&
        liveGrossEdgeBps >= starvationMinLiveGrossEdgeBps &&
        liveNetEdgeBps >= starvationMinLiveNetEdgeBps - positiveEdgeRelaxBps;
      const canEmergencyOpen =
        isTypeEnabled("emergency") &&
        emergencyMode &&
        liveGrossEdgeBps >= controllerEmergencyMinLiveGrossEdgeBps &&
        liveNetEdgeBps >= controllerEmergencyMinLiveNetEdgeBps - positiveEdgeRelaxBps;
      const canNearThresholdExplore =
        positiveExplorationMode &&
        liveGrossEdgeBps >= Math.max(0, liveXarbEntryFloorBps - (activeObserveMode ? 0.4 : 0.25)) &&
        liveNetEdgeBps >= adjustedLiveXarbThresholdBps - nearThresholdBufferBps;
      const canMicroProbeOpen = false;
      const canHardForceProbeOpen = false;
      const allowFallbackOpen =
        canRiskClampXarbOpen ||
        canPilotOpen ||
        canCalibrationOpen ||
        canRecoveryOpen ||
        canReentryOpen ||
        canInactivityOpen ||
        canStarvationOpen ||
        canEmergencyOpen ||
        canNearThresholdExplore ||
        canMicroProbeOpen ||
        canHardForceProbeOpen;

      const effectiveLiveThresholdBps = canRiskClampXarbOpen
        ? Math.min(adjustedLiveXarbThresholdBps, isCoreXarbSymbol ? 2.5 : 1.25)
        : adjustedLiveXarbThresholdBps - nearThresholdBufferBps;

      if (liveNetEdgeBps < effectiveLiveThresholdBps) {
        if (!allowFallbackOpen) {
          skipped += 1;
          reasons.push({ opportunity_id: opp.id, reason: "live_edge_below_threshold" });
          continue;
        }
      }

      if (!meetsXarbQualityFloor && !allowFallbackOpen) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "quality_floor_not_met" });
        continue;
      }

      if (allowFallbackOpen) {
        const fallbackMultiplier = canRiskClampXarbOpen
          ? 0.05
          : canPilotOpen
            ? pilotNotionalMultiplier
            : canRecoveryOpen
              ? recoveryNotionalMultiplier
              : canReentryOpen
                ? reentryNotionalMultiplier
                : canInactivityOpen
                  ? inactivityNotionalMultiplier
                  : canStarvationOpen
                    ? starvationNotionalMultiplier
                    : canEmergencyOpen
                      ? controllerEmergencyNotionalMultiplier
                        : canNearThresholdExplore
                          ? Math.min(controllerEmergencyNotionalMultiplier, 0.015)
                          : canMicroProbeOpen
                            ? 0.01
                            : canHardForceProbeOpen
                              ? 0.003
                              : calibrationNotionalMultiplier;
        const pilotNotional = clampNotional(
          Math.max(minNotional, notional_usd * fallbackMultiplier),
          minNotional,
          maxNotional
        );
        if (pilotNotional <= available) {
          notional_usd = pilotNotional;
        } else if (notional_usd > available) {
          skipped += 1;
          reasons.push({ opportunity_id: opp.id, reason: "insufficient_balance" });
          continue;
        }
      } else if (notional_usd > available) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "insufficient_balance" });
        continue;
      }

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
            auto_execute: true,
            policy_rollout_id: effectivePolicy.rollout_id,
            policy_config_id: effectivePolicy.config_id,
            policy_is_canary: effectivePolicy.is_canary,
            near_threshold_open: canNearThresholdExplore,
            micro_probe_open: canMicroProbeOpen,
            hard_force_probe_open: canHardForceProbeOpen,
            pilot_open: canPilotOpen,
            recovery_open: !canPilotOpen && canRecoveryOpen,
            reentry_open: !canPilotOpen && !canRecoveryOpen && canReentryOpen,
            inactivity_open:
              !canPilotOpen && !canRecoveryOpen && !canReentryOpen && canInactivityOpen,
            starvation_open:
              !canPilotOpen &&
              !canRecoveryOpen &&
              !canReentryOpen &&
              !canInactivityOpen &&
              canStarvationOpen,
            emergency_open:
              !canPilotOpen &&
              !canRecoveryOpen &&
              !canReentryOpen &&
              !canInactivityOpen &&
              !canStarvationOpen &&
              canEmergencyOpen,
            calibration_open: !canPilotOpen && canCalibrationOpen,
            live_edge: {
              gross_bps: Number(liveGrossEdgeBps.toFixed(4)),
              net_bps: Number(liveNetEdgeBps.toFixed(4)),
              threshold_bps: Number(adjustedLiveXarbThresholdBps.toFixed(4))
            }
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
      if (forceProbeMode && (canMicroProbeOpen || canHardForceProbeOpen)) {
        forceProbeOpenedThisTick = true;
      }
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

      const realizedBps = (realized / notional_usd) * 10000;
      if (!Number.isFinite(realizedBps) || realizedBps < TRI_MIN_PROFIT_BPS) {
        skipped += 1;
        reasons.push({ opportunity_id: opp.id, reason: "edge_too_small" });
        continue;
      }

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
            auto_execute: true,
            policy_rollout_id: effectivePolicy.rollout_id,
            policy_config_id: effectivePolicy.config_id,
            policy_is_canary: effectivePolicy.is_canary
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
    llm_remaining: remainingLlmCalls,
    diagnostics
  };
}
