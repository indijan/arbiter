import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { ingestKraken } from "@/server/jobs/ingestKraken";

export async function POST() {
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

  try {
    const result = await ingestKraken();
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? `Kraken API error: ${err.message}` : "Kraken API error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
