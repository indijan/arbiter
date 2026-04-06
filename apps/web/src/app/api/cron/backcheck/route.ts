import { NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/server/cron/auth";
import { runBackcheck } from "@/server/jobs/runBackcheck";

async function handle(request: Request) {
  const unauthorized = ensureCronAuthorized(request);
  if (unauthorized) return unauthorized;

  const results = [];
  for (const days of [1, 7, 30] as const) {
    const res = await runBackcheck(days);
    results.push({ window_days: days, ...res });
  }

  const failed = results.some((r: any) => r.ok === false);
  return NextResponse.json({ ts: new Date().toISOString(), ok: !failed, results });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}

