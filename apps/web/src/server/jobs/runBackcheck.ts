import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

function asNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type FamilyStat = {
  type: string;
  closed: number;
  total_pnl_usd: number;
  avg_pnl_usd: number;
  winrate: number;
};

type LaneStat = {
  lane: string;
  closed: number;
  total_pnl_usd: number;
  avg_pnl_usd: number;
  winrate: number;
  worst_trade_usd: number;
};

type BackcheckSummary = {
  window_days: number;
  since_ts: string;
  latest_tick_ts: string | null;
  latest_tick_auto: any | null;
  top_reject_reasons_24h: Array<{ reason: string; count: number }>;
  families: FamilyStat[];
  lanes: LaneStat[];
};

export async function runBackcheck(windowDays: 1 | 7 | 30): Promise<{ ok: true; summary: BackcheckSummary; skipped: boolean } | { ok: false; error: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: "Missing service role key." };

  // Cheap rate limit: don't write more than once per 30 minutes for the same window.
  const { data: lastRun } = await admin
    .from("backcheck_runs")
    .select("ts")
    .eq("window_days", windowDays)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastRun?.ts) {
    const ageMin = (Date.now() - Date.parse(lastRun.ts)) / 60000;
    if (Number.isFinite(ageMin) && ageMin < 30) {
      // Still return a computed summary (read-only) but don't write.
      // Keeps UI fresh without spamming writes.
      const computed = await computeSummary(admin, windowDays);
      if (!computed.ok) return computed;
      return { ok: true, summary: computed.summary, skipped: true };
    }
  }

  const computed = await computeSummary(admin, windowDays);
  if (!computed.ok) return computed;

  const { error: insertError } = await admin.from("backcheck_runs").insert({
    window_days: windowDays,
    summary: computed.summary
  });
  if (insertError) return { ok: false, error: insertError.message };

  return { ok: true, summary: computed.summary, skipped: false };
}

async function computeSummary(admin: any, windowDays: 1 | 7 | 30): Promise<{ ok: true; summary: BackcheckSummary } | { ok: false; error: string }> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: latestTick } = await admin
    .from("system_ticks")
    .select("ts, detect_summary")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Positions in window (closed only, paper only).
  const { data: positions, error: posErr } = await admin
    .from("positions")
    .select("status, realized_pnl_usd, meta, exit_ts")
    .eq("mode", "paper")
    .gte("entry_ts", since)
    .limit(5000);
  if (posErr) return { ok: false, error: posErr.message };

  const familyPnls = new Map<string, number[]>();
  const lanePnls = new Map<string, number[]>();
  const laneWorst = new Map<string, number>();

  for (const row of positions ?? []) {
    if (row.status !== "closed") continue;
    const pnl = asNumber(row.realized_pnl_usd);
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const type = String(meta.type ?? "(unknown)");
    if (!familyPnls.has(type)) familyPnls.set(type, []);
    familyPnls.get(type)!.push(pnl);

    if (type === "relative_strength") {
      const lane = String(meta.strategy_variant ?? "(none)");
      if (!lanePnls.has(lane)) lanePnls.set(lane, []);
      lanePnls.get(lane)!.push(pnl);
      const prevWorst = laneWorst.get(lane);
      laneWorst.set(lane, prevWorst === undefined ? pnl : Math.min(prevWorst, pnl));
    }
  }

  const families: FamilyStat[] = Array.from(familyPnls.entries())
    .map(([type, pnls]) => {
      const closed = pnls.length;
      const total = pnls.reduce((s, v) => s + v, 0);
      const wins = pnls.filter((v) => v > 0).length;
      return {
        type,
        closed,
        total_pnl_usd: Number(total.toFixed(4)),
        avg_pnl_usd: Number((closed > 0 ? total / closed : 0).toFixed(4)),
        winrate: Number((closed > 0 ? wins / closed : 0).toFixed(4))
      };
    })
    .sort((a, b) => a.total_pnl_usd - b.total_pnl_usd);

  const lanes: LaneStat[] = Array.from(lanePnls.entries())
    .map(([lane, pnls]) => {
      const closed = pnls.length;
      const total = pnls.reduce((s, v) => s + v, 0);
      const wins = pnls.filter((v) => v > 0).length;
      return {
        lane,
        closed,
        total_pnl_usd: Number(total.toFixed(4)),
        avg_pnl_usd: Number((closed > 0 ? total / closed : 0).toFixed(4)),
        winrate: Number((closed > 0 ? wins / closed : 0).toFixed(4)),
        worst_trade_usd: Number((laneWorst.get(lane) ?? 0).toFixed(4))
      };
    })
    .sort((a, b) => a.total_pnl_usd - b.total_pnl_usd);

  // Aggregate reject reasons from last 24h of ticks (lightweight).
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: ticks24 } = await admin
    .from("system_ticks")
    .select("detect_summary, ts")
    .gte("ts", since24h)
    .order("ts", { ascending: false })
    .limit(500);

  const reasonCounts = new Map<string, number>();
  for (const t of ticks24 ?? []) {
    const auto = (t.detect_summary as any)?.auto_execute;
    const reasonsTop = Array.isArray(auto?.reasons_top) ? auto.reasons_top : [];
    for (const item of reasonsTop) {
      const reason = String(item.reason ?? "");
      const count = asNumber(item.count ?? 0);
      if (!reason) continue;
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + count);
    }
  }

  const topReject = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  const summary: BackcheckSummary = {
    window_days: windowDays,
    since_ts: since,
    latest_tick_ts: latestTick?.ts ?? null,
    latest_tick_auto: (latestTick?.detect_summary as any)?.auto_execute ?? null,
    top_reject_reasons_24h: topReject,
    families,
    lanes
  };

  return { ok: true, summary };
}

