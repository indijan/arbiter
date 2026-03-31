import { NextResponse } from "next/server";
import { autoClosePaper } from "@/server/jobs/autoClosePaper";
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

  const closeResult = await runJob(() => autoClosePaper());

  return NextResponse.json({
    ts: new Date().toISOString(),
    partial_failures: !closeResult.ok,
    auto_close: closeResult.ok
      ? closeResult.data
      : { attempted: 0, closed: 0, skipped: 0, reasons: [], error: closeResult.error }
  });
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}

