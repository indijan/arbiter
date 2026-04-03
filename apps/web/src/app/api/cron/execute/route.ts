import { NextResponse } from "next/server";
import { autoExecutePaper } from "@/server/jobs/autoExecutePaper";
import { ensureCronAuthorized } from "@/server/cron/auth";
import { createAdminSupabase } from "@/lib/supabase/server-admin";

type JobSuccess<T> = { ok: true; data: T };
type JobFailure = { ok: false; error: string };
type JobResult<T> = JobSuccess<T> | JobFailure;

async function runJob<T>(fn: () => Promise<T>): Promise<JobResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown job error"
    };
  }
}

async function handleRequest(request: Request) {
  const unauthorized = ensureCronAuthorized(request);
  if (unauthorized) return unauthorized;

  const autoResult = await runJob(() => autoExecutePaper());

  // Persist a lightweight tick row so the dashboard can diagnose "why nothing opened".
  // We used to insert this in `/api/cron/tick`, but cron jobs were later split.
  const adminSupabase = createAdminSupabase();
  if (adminSupabase) {
    const autoReasons = autoResult.ok ? autoResult.data.reasons : [];
    const autoReasonCounts = autoReasons.reduce((acc, item: { reason: string }) => {
      acc[item.reason] = (acc[item.reason] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const autoTopReasons = Object.entries(autoReasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    await adminSupabase.from("system_ticks").insert({
      ingest_errors: 0,
      ingest_errors_json: [],
      detect_summary: {
        auto_execute: autoResult.ok
          ? {
              attempted: autoResult.data.attempted,
              created: autoResult.data.created,
              skipped: autoResult.data.skipped,
              reasons_top: autoTopReasons,
              diagnostics: autoResult.data.diagnostics,
              llm_used: autoResult.data.llm_used,
              llm_remaining: autoResult.data.llm_remaining
            }
          : {
              attempted: 0,
              created: 0,
              skipped: 0,
              reasons_top: [],
              diagnostics: null,
              llm_used: 0,
              llm_remaining: 0,
              error: autoResult.error
            }
      }
    });
  }

  return NextResponse.json({
    ts: new Date().toISOString(),
    partial_failures: !autoResult.ok,
    auto_execute: autoResult.ok
      ? autoResult.data
      : {
          attempted: 0,
          created: 0,
          skipped: 0,
          reasons: [],
          diagnostics: null,
          llm_used: 0,
          llm_remaining: 0,
          error: autoResult.error
        }
  });
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
