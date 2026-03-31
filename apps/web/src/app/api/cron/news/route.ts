import { NextResponse } from "next/server";
import { ingestCryptoNews, recordNewsReactions } from "@/server/jobs/newsShadow";
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

  const newsIngestResult = await runJob(() => ingestCryptoNews());
  const newsReactionResult = await runJob(() => recordNewsReactions());

  return NextResponse.json({
    ts: new Date().toISOString(),
    partial_failures: !newsIngestResult.ok || !newsReactionResult.ok,
    news_shadow: {
      ingest: newsIngestResult.ok
        ? newsIngestResult.data
        : { feeds_checked: 0, fetched_items: 0, inserted: 0, classified: 0, gated: 0, skipped_existing: 0, error: newsIngestResult.error },
      reactions: newsReactionResult.ok
        ? newsReactionResult.data
        : { events_considered: 0, inserted: 0, skipped: 0, error: newsReactionResult.error }
    }
  });
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}

