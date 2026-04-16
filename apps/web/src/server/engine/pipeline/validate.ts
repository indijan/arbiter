import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server-admin";
import type { NormalizedSnapshot } from "@/server/engine/pipeline/model";

const LOOKBACK_MINUTES = 20;

function positive(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function runValidateStep(): Promise<{ valid: NormalizedSnapshot[]; skipped: number }> {
  const admin = createAdminSupabase();
  if (!admin) throw new Error("Missing service role key.");

  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("market_snapshots")
    .select("ts, exchange, symbol, spot_bid, spot_ask, perp_bid, perp_ask, funding_rate")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(1500);

  if (error) throw new Error(error.message);

  const latest = new Map<string, NormalizedSnapshot>();
  let skipped = 0;

  for (const row of data ?? []) {
    const spotBid = positive(row.spot_bid);
    const spotAsk = positive(row.spot_ask);
    if (spotBid === null || spotAsk === null || spotAsk <= spotBid) {
      skipped += 1;
      continue;
    }

    const perpBid = positive(row.perp_bid);
    const perpAsk = positive(row.perp_ask);
    const key = `${row.exchange}:${row.symbol}`;
    if (latest.has(key)) continue;

    latest.set(key, {
      exchange: row.exchange,
      symbol: row.symbol,
      spot: { bid: spotBid, ask: spotAsk },
      perp: perpBid !== null && perpAsk !== null && perpAsk > perpBid
        ? { bid: perpBid, ask: perpAsk, funding_rate: row.funding_rate === null ? null : Number(row.funding_rate) }
        : undefined,
      timestamp: row.ts
    });
  }

  return { valid: Array.from(latest.values()), skipped };
}
