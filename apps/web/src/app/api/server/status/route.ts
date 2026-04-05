import { NextRequest, NextResponse } from "next/server";
import { requireServerUiToken } from "@/server/serverCockpit/auth";
import { getRuntimeStatus, tailFile } from "@/server/serverCockpit/localRuntime";
import { createAdminSupabase } from "@/lib/supabase/server-admin";

export async function GET(req: NextRequest) {
  const auth = requireServerUiToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const runtime = await getRuntimeStatus();

  const admin = createAdminSupabase();
  let latestTick: any = null;
  if (admin) {
    const { data } = await admin
      .from("system_ticks")
      .select("ts, ingest_errors, detect_summary")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestTick = data ?? null;
  }

  const webErrTail = await tailFile(runtime.logs.webErr, 30);
  const runnerOutTail = await tailFile(runtime.logs.runnerOut, 60);

  return NextResponse.json({
    runtime,
    latest_tick: latestTick,
    tails: { web_err: webErrTail, runner_out: runnerOutTail }
  });
}

