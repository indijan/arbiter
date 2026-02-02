import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { detectCarry } from "@/server/jobs/detectCarry";

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

  const body = await request.json().catch(() => ({}));

  try {
    const result = await detectCarry({
      holding_hours: body?.holding_hours
    });
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to detect opportunities.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
