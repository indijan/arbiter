import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";
import { paperFill } from "@/lib/execution/paperFill";

const DEFAULT_NOTIONAL = 100;
const DEFAULT_MIN_NOTIONAL = 100;
const DEFAULT_MAX_NOTIONAL = 500;
const DEFAULT_PAPER_BALANCE = 10000;
const SLIPPAGE_BPS = 2;
const FEE_BPS = 4;

const MAX_OPEN_POSITIONS = 10;
const MAX_NEW_PER_HOUR = 3;
const MAX_CANDIDATES = 3;
const LOOKBACK_HOURS = 24;

const STRATEGY_RISK_WEIGHT: Record<string, number> = {
  spot_perp_carry: 0,
  xarb_spot: 1,
  tri_arb: 2
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

type AutoExecuteResult = {
  attempted: number;
  created: number;
  skipped: number;
  reasons: Array<{ opportunity_id: number; reason: string }>;
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

export async function autoExecutePaper(): Promise<AutoExecuteResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  const { data: account, error: accountError } = await adminSupabase
    .from("paper_accounts")
    .select("id, user_id, balance_usd, reserved_usd, min_notional_usd, max_notional_usd")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (!account) {
    return { attempted: 0, created: 0, skipped: 0, reasons: [] };
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
    return { attempted: 0, created: 0, skipped: 0, reasons: [] };
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
    return { attempted: 0, created: 0, skipped: 0, reasons: [] };
  }

  const sinceOpps = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data: opportunities, error: oppError } = await adminSupabase
    .from("opportunities")
    .select("id, ts, exchange, symbol, type, net_edge_bps, confidence, details, status")
    .eq("status", "new")
    .gte("ts", sinceOpps)
    .order("ts", { ascending: false })
    .limit(80);

  if (oppError) {
    throw new Error(oppError.message);
  }

  const scored = (opportunities ?? [])
    .map((opp) => ({
      ...(opp as OpportunityRow),
      score: scoreOpportunity(opp as OpportunityRow)
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_CANDIDATES);

  let attempted = 0;
  let created = 0;
  let skipped = 0;
  const reasons: Array<{ opportunity_id: number; reason: string }> = [];

  let available = Math.max(0, balance - reserved);
  let reservedCurrent = reserved;

  for (const opp of scored) {
    attempted += 1;

    if (opp.type !== "spot_perp_carry") {
      skipped += 1;
      reasons.push({ opportunity_id: opp.id, reason: "execution_not_supported" });
      continue;
    }

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
  }

  return { attempted, created, skipped, reasons };
}
