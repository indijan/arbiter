import { NextResponse } from "next/server";
import { runDetectOrchestrator } from "@/server/engine/orchestrator/detect";
import { ensureCronAuthorized } from "@/server/cron/auth";
import { createAdminSupabase } from "@/lib/supabase/server-admin";

async function handleRequest(request: Request) {
  const unauthorized = ensureCronAuthorized(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await runDetectOrchestrator(body);

  const adminSupabase = createAdminSupabase();
  if (adminSupabase) {
    await adminSupabase.from("system_ticks").insert({
      ingest_errors: 0,
      ingest_errors_json: [],
      detect_summary: result.detect
    });
  }

  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
