import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/server-admin";

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
  const position_id = body?.position_id;

  if (!position_id) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    return NextResponse.json(
      { error: "Missing service role key." },
      { status: 500 }
    );
  }

  const { data: position, error: positionError } = await adminSupabase
    .from("positions")
    .select("id, user_id, symbol, status, spot_qty, perp_qty, entry_spot_price, entry_perp_price, meta")
    .eq("id", position_id)
    .maybeSingle();

  if (positionError) {
    return NextResponse.json({ error: positionError.message }, { status: 500 });
  }

  if (!position || position.user_id !== user.id) {
    return NextResponse.json({ error: "Position not found." }, { status: 404 });
  }

  if (position.status !== "open") {
    return NextResponse.json({ error: "Position already closed." }, { status: 400 });
  }

  const { data: snapshot, error: snapshotError } = await adminSupabase
    .from("market_snapshots")
    .select("spot_bid, spot_ask, perp_bid, perp_ask")
    .eq("symbol", position.symbol)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapshotError) {
    return NextResponse.json({ error: snapshotError.message }, { status: 500 });
  }

  if (!snapshot || snapshot.spot_bid === null || snapshot.perp_ask === null) {
    return NextResponse.json({ error: "Missing exit prices." }, { status: 400 });
  }

  const exitSpot = Number(snapshot.spot_bid);
  const exitPerp = Number(snapshot.perp_ask);
  const entrySpot = Number(position.entry_spot_price ?? 0);
  const entryPerp = Number(position.entry_perp_price ?? 0);
  const spotQty = Number(position.spot_qty ?? 0);
  const perpQty = Number(position.perp_qty ?? 0);

  const meta = (position.meta ?? {}) as Record<string, unknown>;
  const notionalUsd = Number(meta.notional_usd ?? 0);
  const feeBps = Number(meta.fee_bps ?? 4);
  const closeFeeUsd = notionalUsd > 0 ? (notionalUsd * feeBps * 2) / 10000 : 0;

  const realizedPnl =
    spotQty * (exitSpot - entrySpot) +
    perpQty * (exitPerp - entryPerp) -
    closeFeeUsd;

  const { error: closeError } = await adminSupabase
    .from("positions")
    .update({
      status: "closed",
      exit_ts: new Date().toISOString(),
      exit_spot_price: exitSpot,
      exit_perp_price: exitPerp,
      realized_pnl_usd: Number(realizedPnl.toFixed(2))
    })
    .eq("id", position.id)
    .eq("status", "open");

  if (closeError) {
    return NextResponse.json({ error: closeError.message }, { status: 500 });
  }

  const reservedRelease = notionalUsd;

  if (reservedRelease > 0) {
    const { data: account, error: accountError } = await adminSupabase
      .from("paper_accounts")
      .select("id, reserved_usd")
      .eq("user_id", user.id)
      .maybeSingle();

    if (accountError) {
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }

    if (account) {
      const nextReserved = Math.max(0, Number(account.reserved_usd ?? 0) - reservedRelease);
      const { error: reserveError } = await adminSupabase
        .from("paper_accounts")
        .update({
          reserved_usd: Number(nextReserved.toFixed(2)),
          updated_at: new Date().toISOString()
        })
        .eq("id", account.id);

      if (reserveError) {
        return NextResponse.json({ error: reserveError.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({
    closed: true,
    position_id: position.id,
    realized_pnl_usd: Number(realizedPnl.toFixed(2))
  });
}
