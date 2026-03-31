import { NextResponse } from "next/server";
import { ingestBinance } from "@/server/jobs/ingestBinance";
import { ingestBinanceSpot } from "@/server/jobs/ingestBinanceSpot";
import { ingestCoinbase } from "@/server/jobs/ingestCoinbase";
import { ingestKraken } from "@/server/jobs/ingestKraken";
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

  const ingestBinanceResult = await runJob(() => ingestBinance());
  const ingestBinanceSpotResult = await runJob(() => ingestBinanceSpot());
  const ingestCoinbaseResult = await runJob(() => ingestCoinbase());
  const ingestKrakenResult = await runJob(() => ingestKraken());

  return NextResponse.json({
    ts: new Date().toISOString(),
    partial_failures:
      !ingestBinanceResult.ok ||
      !ingestBinanceSpotResult.ok ||
      !ingestCoinbaseResult.ok ||
      !ingestKrakenResult.ok,
    ingest: {
      bybit_okx: ingestBinanceResult.ok
        ? ingestBinanceResult.data
        : { ok: false, error: ingestBinanceResult.error },
      binance_spot: ingestBinanceSpotResult.ok
        ? ingestBinanceSpotResult.data
        : { ok: false, error: ingestBinanceSpotResult.error },
      coinbase: ingestCoinbaseResult.ok
        ? ingestCoinbaseResult.data
        : { ok: false, error: ingestCoinbaseResult.error },
      kraken: ingestKrakenResult.ok
        ? ingestKrakenResult.data
        : { ok: false, error: ingestKrakenResult.error }
    }
  });
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}

