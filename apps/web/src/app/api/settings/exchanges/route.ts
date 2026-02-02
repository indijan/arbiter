import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env vars." }, { status: 500 });
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("exchange_settings")
    .select("exchange_key, enabled, config");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env vars." }, { status: 500 });
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const exchange_key = body?.exchange_key;
  const enabled = Boolean(body?.enabled);

  if (!exchange_key) {
    return NextResponse.json({ error: "Missing exchange_key" }, { status: 400 });
  }

  const { error } = await supabase
    .from("exchange_settings")
    .upsert({
      user_id: userData.user.id,
      exchange_key,
      enabled,
      config: body?.config ?? {}
    }, { onConflict: "user_id,exchange_key" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
