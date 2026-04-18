import { NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/server/cron/auth";
import { createAdminSupabase } from "@/lib/supabase/server-admin";

export const maxDuration = 60;

const V2_STARTED_AT = new Date("2026-04-16T00:00:00.000Z").getTime();
const RETENTION_DAYS = 14;

type RetentionTable = "market_snapshots" | "opportunities" | "system_ticks" | "opportunity_decisions";

const RETENTION_TABLES: RetentionTable[] = [
  "market_snapshots",
  "opportunities",
  "system_ticks",
  "opportunity_decisions"
];

function retentionCutoff() {
  const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Math.max(Date.now() - retentionMs, V2_STARTED_AT)).toISOString();
}

async function handleCleanup(request: Request) {
  const unauthorized = ensureCronAuthorized(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Missing service role key." }, { status: 500 });
  }

  const cutoff = retentionCutoff();
  const results: Record<string, { deleted: number | null; error: string | null }> = {};

  for (const table of RETENTION_TABLES) {
    const { count, error } = await admin
      .from(table)
      .delete({ count: "exact" })
      .lt("ts", cutoff);

    results[table] = {
      deleted: count ?? null,
      error: error?.message ?? null
    };

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          cutoff,
          retention_days: RETENTION_DAYS,
          failed_table: table,
          results
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    cutoff,
    retention_days: RETENTION_DAYS,
    results
  });
}

export async function GET(request: Request) {
  return handleCleanup(request);
}

export async function POST(request: Request) {
  return handleCleanup(request);
}
