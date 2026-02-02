import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

const DEFAULT_BALANCE = 10000;
const DEFAULT_MIN_NOTIONAL = 100;
const DEFAULT_MAX_NOTIONAL = 500;

export async function GET() {
  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing env vars." }, { status: 500 });
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("paper_accounts")
    .select("balance_usd, reserved_usd, min_notional_usd, max_notional_usd")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    balance_usd: Number(data?.balance_usd ?? DEFAULT_BALANCE),
    reserved_usd: Number(data?.reserved_usd ?? 0),
    min_notional_usd: Number(data?.min_notional_usd ?? DEFAULT_MIN_NOTIONAL),
    max_notional_usd: Number(data?.max_notional_usd ?? DEFAULT_MAX_NOTIONAL)
  });
}

export async function POST(request: Request) {
  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing env vars." }, { status: 500 });
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const balance = Number(body?.balance_usd ?? DEFAULT_BALANCE);
  const minNotional = Number(body?.min_notional_usd ?? DEFAULT_MIN_NOTIONAL);
  const maxNotional = Number(body?.max_notional_usd ?? DEFAULT_MAX_NOTIONAL);

  if (!Number.isFinite(balance) || balance <= 0) {
    return NextResponse.json({ error: "Invalid balance." }, { status: 400 });
  }

  if (!Number.isFinite(minNotional) || minNotional <= 0) {
    return NextResponse.json({ error: "Invalid min notional." }, { status: 400 });
  }

  if (!Number.isFinite(maxNotional) || maxNotional <= 0) {
    return NextResponse.json({ error: "Invalid max notional." }, { status: 400 });
  }

  if (minNotional > maxNotional) {
    return NextResponse.json({ error: "Min notional cannot exceed max notional." }, { status: 400 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("paper_accounts")
    .select("id, reserved_usd")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const reserved = Number(existing?.reserved_usd ?? 0);
  if (balance < reserved) {
    return NextResponse.json(
      { error: `Balance cannot be below reserved amount (${reserved.toFixed(2)} USD).` },
      { status: 400 }
    );
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("paper_accounts")
      .update({
        balance_usd: balance,
        min_notional_usd: minNotional,
        max_notional_usd: maxNotional,
        updated_at: new Date().toISOString()
      })
      .eq("id", existing.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  } else {
    const { error: insertError } = await supabase
      .from("paper_accounts")
      .insert({
        user_id: user.id,
        balance_usd: balance,
        reserved_usd: 0,
        min_notional_usd: minNotional,
        max_notional_usd: maxNotional
      });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    balance_usd: balance,
    reserved_usd: reserved,
    min_notional_usd: minNotional,
    max_notional_usd: maxNotional
  });
}
