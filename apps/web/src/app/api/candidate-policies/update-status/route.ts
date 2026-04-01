import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

const ALLOWED_STATUSES = new Set(["candidate", "validated", "canary", "rejected"]);

export async function POST(request: Request) {
  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env vars." }, { status: 500 });
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string };
  const id = String(body.id ?? "").trim();
  const status = String(body.status ?? "").trim();

  if (!id || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid candidate id or status." }, { status: 400 });
  }

  const { error } = await supabase
    .from("candidate_lane_policies")
    .update({
      status,
      status_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("user_id", userData.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, status });
}
