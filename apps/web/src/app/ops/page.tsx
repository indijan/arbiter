import { redirect } from "next/navigation";
import ExecuteButton from "@/components/ExecuteButton";
import CloseAllButton from "@/components/CloseAllButton";
import ClosePositionButton from "@/components/ClosePositionButton";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function OpsPage() {
  const supabase = createServerSupabase();

  if (!supabase) {
    return (
      <div className="min-h-screen px-6 py-16">
        <div className="card mx-auto max-w-3xl space-y-2">
          <h1 className="text-2xl font-semibold">Ops</h1>
          <p className="text-sm text-brand-100/70">Missing env vars.</p>
        </div>
      </div>
    );
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("market_snapshots")
    .select("id, ts, exchange, symbol, spot_bid, spot_ask, perp_bid, perp_ask, funding_rate")
    .order("ts", { ascending: false })
    .limit(50);

  const { data: opportunities, error: opportunitiesError } = await supabase
    .from("opportunities")
    .select("id, ts, exchange, symbol, type, net_edge_bps, expected_daily_bps, confidence, status")
    .order("ts", { ascending: false })
    .limit(50);

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("id, entry_ts, symbol, mode, status, spot_qty, perp_qty, entry_spot_price, entry_perp_price, exit_ts, realized_pnl_usd")
    .eq("user_id", user.id)
    .order("entry_ts", { ascending: false })
    .limit(50);

  const openPositionIds = (positions ?? [])
    .filter((row) => row.status === "open")
    .map((row) => row.id);
  const symbols = Array.from(new Set((positions ?? []).map((row) => row.symbol)));
  const { data: snapshotRows } = symbols.length > 0
    ? await supabase
        .from("market_snapshots")
        .select("symbol, spot_bid, spot_ask, perp_bid, perp_ask, ts")
        .in("symbol", symbols)
        .order("ts", { ascending: false })
        .limit(Math.min(symbols.length * 6, 200))
    : { data: [] };

  const snapshotMap = new Map<string, { spot_mid: number | null; perp_mid: number | null }>();
  for (const row of snapshotRows ?? []) {
    if (snapshotMap.has(row.symbol)) continue;
    const spot_mid =
      row.spot_bid !== null && row.spot_ask !== null
        ? (row.spot_bid + row.spot_ask) / 2
        : null;
    const perp_mid =
      row.perp_bid !== null && row.perp_ask !== null
        ? (row.perp_bid + row.perp_ask) / 2
        : null;
    snapshotMap.set(row.symbol, { spot_mid, perp_mid });
  }

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header>
          <p className="text-sm uppercase tracking-[0.3em] text-brand-300">Ops</p>
          <h1 className="text-3xl font-semibold">Operational view</h1>
          <p className="mt-2 text-sm text-brand-100/70">
            Raw snapshots, opportunities, and positions.
          </p>
        </header>

        <section className="card">
          <h2 className="text-xl font-semibold">Market snapshots</h2>
          {snapshotsError ? (
            <p className="mt-2 text-sm text-red-200">{snapshotsError.message}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-brand-100/70">
                  <tr>
                    <th className="pb-2">Timestamp</th>
                    <th className="pb-2">Exchange</th>
                    <th className="pb-2">Symbol</th>
                    <th className="pb-2">Spot bid/ask</th>
                    <th className="pb-2">Perp bid/ask</th>
                    <th className="pb-2">Funding</th>
                  </tr>
                </thead>
                <tbody className="text-brand-100/90">
                  {snapshots?.map((row) => (
                    <tr key={row.id} className="border-t border-brand-300/10">
                      <td className="py-2">{new Date(row.ts).toLocaleString("hu-HU")}</td>
                      <td className="py-2">{row.exchange}</td>
                      <td className="py-2">{row.symbol}</td>
                      <td className="py-2">{row.spot_bid ?? "-"} / {row.spot_ask ?? "-"}</td>
                      <td className="py-2">{row.perp_bid ?? "-"} / {row.perp_ask ?? "-"}</td>
                      <td className="py-2">{row.funding_rate ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="text-xl font-semibold">Opportunities</h2>
          {opportunitiesError ? (
            <p className="mt-2 text-sm text-red-200">{opportunitiesError.message}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-brand-100/70">
                  <tr>
                    <th className="pb-2">Timestamp</th>
                    <th className="pb-2">Exchange</th>
                    <th className="pb-2">Symbol</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Net edge</th>
                    <th className="pb-2">Expected daily</th>
                    <th className="pb-2">Confidence</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="text-brand-100/90">
                  {opportunities?.map((row) => (
                    <tr key={row.id} className="border-t border-brand-300/10">
                      <td className="py-2">{new Date(row.ts).toLocaleString("hu-HU")}</td>
                      <td className="py-2">{row.exchange}</td>
                      <td className="py-2">{row.symbol}</td>
                      <td className="py-2">{row.type}</td>
                      <td className="py-2">{row.net_edge_bps ?? "-"}</td>
                      <td className="py-2">{row.expected_daily_bps ?? "-"}</td>
                      <td className="py-2">{row.confidence ?? "-"}</td>
                      <td className="py-2">{row.status}</td>
                      <td className="py-2">
                        <ExecuteButton opportunityId={row.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Positions</h2>
            <CloseAllButton positionIds={openPositionIds} />
          </div>
          {positionsError ? (
            <p className="mt-2 text-sm text-red-200">{positionsError.message}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-brand-100/70">
                  <tr>
                    <th className="pb-2">Entry time</th>
                    <th className="pb-2">Symbol</th>
                    <th className="pb-2">Mode</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Spot qty</th>
                    <th className="pb-2">Perp qty</th>
                    <th className="pb-2">Entry spot</th>
                    <th className="pb-2">Entry perp</th>
                    <th className="pb-2">Unrealized</th>
                    <th className="pb-2">Realized</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="text-brand-100/90">
                  {positions?.map((row) => (
                    <tr key={row.id} className="border-t border-brand-300/10">
                      <td className="py-2">{new Date(row.entry_ts).toLocaleString("hu-HU")}</td>
                      <td className="py-2">{row.symbol}</td>
                      <td className="py-2">{row.mode}</td>
                      <td className="py-2">{row.status}</td>
                      <td className="py-2">{row.spot_qty ?? "-"}</td>
                      <td className="py-2">{row.perp_qty ?? "-"}</td>
                      <td className="py-2">{row.entry_spot_price ?? "-"}</td>
                      <td className="py-2">{row.entry_perp_price ?? "-"}</td>
                      <td className="py-2">
                        {(() => {
                          if (row.status !== "open") return "-";
                          const prices = snapshotMap.get(row.symbol);
                          if (!prices || prices.spot_mid === null || prices.perp_mid === null) return "-";
                          const spotQty = Number(row.spot_qty ?? 0);
                          const perpQty = Number(row.perp_qty ?? 0);
                          const entrySpot = Number(row.entry_spot_price ?? 0);
                          const entryPerp = Number(row.entry_perp_price ?? 0);
                          const pnl =
                            spotQty * (prices.spot_mid - entrySpot) +
                            perpQty * (prices.perp_mid - entryPerp);
                          return pnl.toFixed(2);
                        })()}
                      </td>
                      <td className="py-2">{row.realized_pnl_usd ?? "-"}</td>
                      <td className="py-2">
                        {row.status === "open" ? <ClosePositionButton positionId={row.id} /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
