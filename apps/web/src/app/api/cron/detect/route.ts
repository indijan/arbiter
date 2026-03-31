import { NextResponse } from "next/server";
import { detectCarry } from "@/server/jobs/detectCarry";
import { detectCrossExchangeSpot } from "@/server/jobs/detectCrossExchangeSpot";
import { detectSpreadReversion } from "@/server/jobs/detectSpreadReversion";
import { detectRelativeStrength } from "@/server/jobs/detectRelativeStrength";
import { detectTriangular } from "@/server/jobs/detectTriangular";
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

  const body = await request.json().catch(() => ({}));
  const carryResult = await runJob(() => detectCarry({ holding_hours: body?.holding_hours }));
  const crossResult = await runJob(() => detectCrossExchangeSpot());
  const spreadReversionResult = await runJob(() => detectSpreadReversion());
  const relativeStrengthResult = await runJob(() => detectRelativeStrength());
  const triResult = await runJob(() => detectTriangular());

  return NextResponse.json({
    ts: new Date().toISOString(),
    partial_failures:
      !carryResult.ok ||
      !crossResult.ok ||
      !spreadReversionResult.ok ||
      !relativeStrengthResult.ok ||
      !triResult.ok,
    detect: {
      carry_spot_perp: carryResult.ok
        ? carryResult.data
        : { inserted: 0, watchlist: 0, skipped: 0, error: carryResult.error },
      xarb_spot: crossResult.ok
        ? crossResult.data
        : { inserted: 0, skipped: 0, error: crossResult.error },
      spread_reversion: spreadReversionResult.ok
        ? spreadReversionResult.data
        : { inserted: 0, skipped: 0, near_miss_samples: [], error: spreadReversionResult.error },
      relative_strength: relativeStrengthResult.ok
        ? relativeStrengthResult.data
        : { inserted: 0, skipped: 0, near_miss_samples: [], error: relativeStrengthResult.error },
      tri_arb: triResult.ok
        ? triResult.data
        : { inserted: 0, skipped: 0, error: triResult.error }
    }
  });
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}

