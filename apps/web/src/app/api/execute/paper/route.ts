import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/server-admin";
import { paperFill } from "@/lib/execution/paperFill";

const DEFAULT_NOTIONAL = 100;
const DEFAULT_MIN_NOTIONAL = 100;
const DEFAULT_MAX_NOTIONAL = 500;
const DEFAULT_PAPER_BALANCE = 10000;
const SLIPPAGE_BPS = 2;
const FEE_BPS = 4;
const IDEMPOTENT_MINUTES = 5;

function clampNotional(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function deriveNotional(opportunity: {
  net_edge_bps: number | null;
  details: Record<string, unknown> | null;
}, minNotional: number, maxNotional: number) {
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

export async function POST(request: Request) {
  const authSupabase = createServerSupabase();
  if (!authSupabase) {
    return NextResponse.json(
      { error: "Missing Supabase env vars." },
      { status: 500 }
    );
  }

  const {
    data: { user }
  } = await authSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const opportunity_id = body?.opportunity_id;
  const requestedNotional = Number(body?.notional_usd);

  if (!opportunity_id) {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    return NextResponse.json(
      { error: "Missing service role key." },
      { status: 500 }
    );
  }

  const { data: opportunity, error: opportunityError } = await adminSupabase
    .from("opportunities")
    .select("id, ts, exchange, symbol, net_edge_bps, details")
    .eq("id", opportunity_id)
    .maybeSingle();

  if (opportunityError) {
    return NextResponse.json({ error: opportunityError.message }, { status: 500 });
  }

  if (!opportunity) {
    return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  }

  const since = new Date(Date.now() - IDEMPOTENT_MINUTES * 60 * 1000).toISOString();

  const { data: existingPosition, error: existingError } = await adminSupabase
    .from("positions")
    .select("id, entry_ts")
    .eq("user_id", user.id)
    .eq("opportunity_id", opportunity.id)
    .eq("status", "open")
    .gte("entry_ts", since)
    .order("entry_ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (existingPosition) {
    return NextResponse.json({
      created: false,
      position_id: existingPosition.id,
      message: "Existing position reused."
    });
  }

  const { data: accountRow, error: accountError } = await adminSupabase
    .from("paper_accounts")
    .select("id, balance_usd, reserved_usd, min_notional_usd, max_notional_usd")
    .eq("user_id", user.id)
    .maybeSingle();

  if (accountError) {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }

  let account = accountRow;
  if (!account) {
    const { data: createdAccount, error: createAccountError } = await adminSupabase
      .from("paper_accounts")
      .insert({
        user_id: user.id,
        balance_usd: DEFAULT_PAPER_BALANCE,
        reserved_usd: 0,
        min_notional_usd: DEFAULT_MIN_NOTIONAL,
        max_notional_usd: DEFAULT_MAX_NOTIONAL
      })
      .select("id, balance_usd, reserved_usd, min_notional_usd, max_notional_usd")
      .single();

    if (createAccountError || !createdAccount) {
      return NextResponse.json(
        { error: createAccountError?.message ?? "Failed to create paper account." },
        { status: 500 }
      );
    }

    account = createdAccount;
  }

  const balance = Number(account.balance_usd ?? 0);
  const reserved = Number(account.reserved_usd ?? 0);
  const available = Math.max(0, balance - reserved);
  const minNotional = Number(account.min_notional_usd ?? DEFAULT_MIN_NOTIONAL);
  const maxNotional = Number(account.max_notional_usd ?? DEFAULT_MAX_NOTIONAL);

  if (minNotional > maxNotional) {
    return NextResponse.json(
      { error: "Paper settings are invalid (min > max)." },
      { status: 400 }
    );
  }

  const derived = deriveNotional({
    net_edge_bps: opportunity.net_edge_bps ?? null,
    details: (opportunity.details ?? null) as Record<string, unknown> | null
  }, minNotional, maxNotional);

  const notional_usd = Number.isFinite(requestedNotional)
    ? clampNotional(requestedNotional, minNotional, maxNotional)
    : derived.notional;

  if (notional_usd > available) {
    return NextResponse.json(
      { error: `Nincs elég paper tőke. Elérhető: ${available.toFixed(2)} USD.` },
      { status: 400 }
    );
  }

  const { data: snapshot, error: snapshotError } = await adminSupabase
    .from("market_snapshots")
    .select("id, ts, exchange, symbol, spot_bid, spot_ask, perp_bid, perp_ask")
    .eq("exchange", opportunity.exchange)
    .eq("symbol", opportunity.symbol)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapshotError) {
    return NextResponse.json({ error: snapshotError.message }, { status: 500 });
  }

  if (!snapshot || snapshot.spot_ask === null || snapshot.perp_bid === null) {
    return NextResponse.json(
      { error: "Missing snapshot prices." },
      { status: 400 }
    );
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
      user_id: user.id,
      opportunity_id: opportunity.id,
      symbol: opportunity.symbol,
      mode: "paper",
      status: "open",
      entry_spot_price: spotFill.fill_price,
      entry_perp_price: perpFill.fill_price,
      spot_qty: spotFill.qty,
      perp_qty: -perpFill.qty,
      meta: {
        opportunity_id: opportunity.id,
        snapshot_id: snapshot.id,
        fee_bps: FEE_BPS,
        slippage_bps: SLIPPAGE_BPS,
        notional_usd,
        notional_reason: Number.isFinite(requestedNotional) ? "manual" : derived.reason
      }
    })
    .select("id")
    .single();

  if (positionError || !position) {
    return NextResponse.json(
      { error: positionError?.message ?? "Failed to create position." },
      { status: 500 }
    );
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
    return NextResponse.json({ error: executionError.message }, { status: 500 });
  }

  const { error: reserveError } = await adminSupabase
    .from("paper_accounts")
    .update({
      reserved_usd: Number((reserved + notional_usd).toFixed(2)),
      updated_at: new Date().toISOString()
    })
    .eq("id", account.id);

  if (reserveError) {
    return NextResponse.json(
      { error: reserveError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    created: true,
    position_id: position.id,
    notional_usd,
    notional_reason: Number.isFinite(requestedNotional) ? "manual" : derived.reason,
    balance_usd: balance,
    reserved_usd: Number((reserved + notional_usd).toFixed(2)),
    available_usd: Number((available - notional_usd).toFixed(2))
  });
}
