import { NextResponse } from "next/server";
import { autoExecutePaper } from "@/server/jobs/autoExecutePaper";
import { ensureCronAuthorized } from "@/server/cron/auth";

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

