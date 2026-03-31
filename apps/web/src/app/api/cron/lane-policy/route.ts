import { NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/server/cron/auth";
import { reviewLanePolicies } from "@/server/jobs/reviewLanePolicies";

async function handleRequest(request: Request) {
  const unauthorized = ensureCronAuthorized(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await reviewLanePolicies();
    return NextResponse.json({
      ts: new Date().toISOString(),
      lane_policy_review: result
    });
  } catch (err) {
    return NextResponse.json(
      {
        ts: new Date().toISOString(),
        lane_policy_review: {
          review_id: null,
          current_btc_regime: "flat",
          current_btc_momentum_6h_bps: 0,
          recommendations_count: 0,
          used_ai: false,
          model: null,
          error: err instanceof Error ? err.message : "Unknown lane policy review error"
        }
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
