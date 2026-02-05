import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server-admin";

type VariantStats = {
  variant: string;
  count: number;
  avg_pnl_usd: number;
  win_rate: number;
};

export async function GET() {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    return NextResponse.json({ error: "Missing service role key." }, { status: 500 });
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: decisions, error: decisionError } = await adminSupabase
    .from("opportunity_decisions")
    .select("id, variant, position_id, ts")
    .gte("ts", since)
    .not("position_id", "is", null);

  if (decisionError) {
    return NextResponse.json({ error: decisionError.message }, { status: 500 });
  }

  const positionIds = (decisions ?? [])
    .map((row) => row.position_id as string)
    .filter(Boolean);

  const { data: positions, error: posError } = await adminSupabase
    .from("positions")
    .select("id, realized_pnl_usd, status")
    .in("id", positionIds.length > 0 ? positionIds : ["00000000-0000-0000-0000-000000000000"]);

  if (posError) {
    return NextResponse.json({ error: posError.message }, { status: 500 });
  }

  const pnlMap = new Map(
    (positions ?? [])
      .filter((row) => row.status === "closed")
      .map((row) => [row.id as string, Number(row.realized_pnl_usd ?? 0)])
  );

  const byVariant = new Map<string, { pnl: number[] }>();

  for (const row of decisions ?? []) {
    const pnl = pnlMap.get(row.position_id as string);
    if (pnl === undefined) {
      continue;
    }
    const key = row.variant ?? "unknown";
    if (!byVariant.has(key)) {
      byVariant.set(key, { pnl: [] });
    }
    byVariant.get(key)!.pnl.push(pnl);
  }

  const stats: VariantStats[] = [];
  for (const [variant, entry] of byVariant.entries()) {
    const count = entry.pnl.length;
    const avg = count > 0 ? entry.pnl.reduce((a, b) => a + b, 0) / count : 0;
    const wins = entry.pnl.filter((p) => p > 0).length;
    stats.push({
      variant,
      count,
      avg_pnl_usd: Number(avg.toFixed(4)),
      win_rate: count > 0 ? Number((wins / count).toFixed(4)) : 0
    });
  }

  return NextResponse.json({
    since,
    total_trades: stats.reduce((sum, s) => sum + s.count, 0),
    variants: stats
  });
}
