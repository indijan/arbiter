import { NextRequest, NextResponse } from "next/server";
import { requireServerUiToken } from "@/server/serverCockpit/auth";
import { createAdminSupabase } from "@/lib/supabase/server-admin";

export async function GET(req: NextRequest) {
  const auth = requireServerUiToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ rows: [] });

  const { data } = await admin
    .from("backcheck_runs")
    .select("ts, window_days, summary")
    .order("ts", { ascending: false })
    .limit(30);

  // Pick latest per window.
  const latestByWindow = new Map<number, any>();
  for (const row of data ?? []) {
    if (!latestByWindow.has(row.window_days)) {
      latestByWindow.set(row.window_days, row);
    }
  }

  return NextResponse.json({
    rows: [1, 7, 30].map((d) => latestByWindow.get(d)).filter(Boolean)
  });
}

