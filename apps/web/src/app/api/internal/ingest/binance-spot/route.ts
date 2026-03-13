import { NextResponse } from "next/server";
import { ingestBinanceSpot } from "@/server/jobs/ingestBinanceSpot";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

function isAuthorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  const headerSecret = request.headers.get("x-cron-secret");
  const internalCaller = request.headers.get("x-arbiter-internal");
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const provided = headerSecret ?? querySecret;
  if (internalCaller === "1") {
    return true;
  }
  return Boolean(expected && provided && provided === expected);
}

async function handleRequest(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await ingestBinanceSpot();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Binance ingest error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  return handleRequest(request);
}

export async function GET(request: Request) {
  return handleRequest(request);
}
