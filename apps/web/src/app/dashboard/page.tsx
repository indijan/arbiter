import { redirect } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";
import IngestButton from "@/components/IngestButton";
import ExecuteButton from "@/components/ExecuteButton";
import DetectSummaryPanel from "@/components/DetectSummaryPanel";
import DevTickButton from "@/components/DevTickButton";
import ClosePositionButton from "@/components/ClosePositionButton";
import CloseAllButton from "@/components/CloseAllButton";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = createServerSupabase();

  if (!supabase) {
    return (
      <div className="min-h-screen px-6 py-16">
        <div className="card mx-auto max-w-3xl space-y-2">
          <h1 className="text-2xl font-semibold">Dashboard OK</h1>
          <p className="text-sm text-brand-100/70">DB status: ERROR</p>
          <p className="text-sm text-brand-100/70">
            Hiányzó környezeti változók.
          </p>
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

  const { error: opportunitiesError } = await supabase
    .from("opportunities")
    .select("id")
    .limit(5);

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("market_snapshots")
    .select("id, ts, exchange, symbol, spot_bid, spot_ask, perp_bid, perp_ask, funding_rate")
    .order("ts", { ascending: false })
    .limit(20);

  const { data: opportunities, error: opportunitiesListError } = await supabase
    .from("opportunities")
    .select("id, ts, exchange, symbol, type, net_edge_bps, expected_daily_bps, confidence, status")
    .order("ts", { ascending: false })
    .limit(20);

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("id, entry_ts, symbol, mode, status, spot_qty, perp_qty, entry_spot_price, entry_perp_price, exit_ts, realized_pnl_usd")
    .eq("user_id", user.id)
    .order("entry_ts", { ascending: false })
    .limit(20);

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
    if (snapshotMap.has(row.symbol)) {
      continue;
    }
    const spot_bid = row.spot_bid ?? null;
    const spot_ask = row.spot_ask ?? null;
    const perp_bid = row.perp_bid ?? null;
    const perp_ask = row.perp_ask ?? null;
    const spot_mid = spot_bid !== null && spot_ask !== null ? (spot_bid + spot_ask) / 2 : null;
    const perp_mid = perp_bid !== null && perp_ask !== null ? (perp_bid + perp_ask) / 2 : null;
    snapshotMap.set(row.symbol, { spot_mid, perp_mid });
  }

  const dbStatus = opportunitiesError ? "ERROR" : "OK";
  const dbMessage = opportunitiesError
    ? opportunitiesError.message
    : "Sikerült lekérni 5 sort.";

  const snapshotsErrorMessage = snapshotsError
    ? snapshotsError.message
    : null;

  const opportunitiesErrorMessage = opportunitiesListError
    ? opportunitiesListError.message
    : null;

  const positionsErrorMessage = positionsError
    ? positionsError.message
    : null;

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-brand-300">
              Dashboard
            </p>
            <h1 className="text-3xl font-semibold">Dashboard OK</h1>
            <p className="mt-2 text-sm text-brand-100/70">
              DB status: {dbStatus}
            </p>
            <p className="text-sm text-brand-100/70">{dbMessage}</p>
            <div className="mt-3 flex gap-3 text-sm">
              <a className="text-brand-300 hover:text-white" href="/settings">
                Settings
              </a>
              <a className="text-brand-300 hover:text-white" href="/simple">
                Simple dashboard
              </a>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <IngestButton
              endpoint="/api/ingest/mock"
              label="Insert mock snapshots"
              variant="primary"
            />
            <IngestButton
              endpoint="/api/ingest/binance"
              label="Ingest Binance (real)"
              variant="ghost"
            />
            <IngestButton
              endpoint="/api/ingest/kraken"
              label="Ingest Kraken (real)"
              variant="ghost"
            />
            <DevTickButton />
            <LogoutButton />
          </div>
        </header>

        <DetectSummaryPanel />

        <section className="card">
          <h2 className="text-xl font-semibold">Market snapshots</h2>
          {snapshotsErrorMessage ? (
            <p className="mt-2 text-sm text-red-200">
              {snapshotsErrorMessage}
            </p>
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
                      <td className="py-2">
                        {new Date(row.ts).toLocaleString("hu-HU")}
                      </td>
                      <td className="py-2">{row.exchange}</td>
                      <td className="py-2">{row.symbol}</td>
                      <td className="py-2">
                        {row.spot_bid ?? "-"} / {row.spot_ask ?? "-"}
                      </td>
                      <td className="py-2">
                        {row.perp_bid ?? "-"} / {row.perp_ask ?? "-"}
                      </td>
                      <td className="py-2">{row.funding_rate ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {snapshots && snapshots.length === 0 ? (
                <p className="mt-3 text-sm text-brand-100/70">
                  Nincs még market snapshot.
                </p>
              ) : null}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="text-xl font-semibold">Opportunities</h2>
          {opportunitiesErrorMessage ? (
            <p className="mt-2 text-sm text-red-200">
              {opportunitiesErrorMessage}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-brand-100/70">
                  <tr>
                    <th className="pb-2">Timestamp</th>
                    <th className="pb-2">Exchange</th>
                    <th className="pb-2">Symbol</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Net edge (bps)</th>
                    <th className="pb-2">Expected daily (bps)</th>
                    <th className="pb-2">Confidence</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="text-brand-100/90">
                  {opportunities?.map((row) => (
                    <tr key={row.id} className="border-t border-brand-300/10">
                      <td className="py-2">
                        {new Date(row.ts).toLocaleString("hu-HU")}
                      </td>
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
              {opportunities && opportunities.length === 0 ? (
                <p className="mt-3 text-sm text-brand-100/70">
                  Nincs még opportunity.
                </p>
              ) : null}
            </div>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Positions</h2>
            <CloseAllButton positionIds={openPositionIds} />
          </div>
          {positionsErrorMessage ? (
            <p className="mt-2 text-sm text-red-200">
              {positionsErrorMessage}
            </p>
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
                      <td className="py-2">
                        {new Date(row.entry_ts).toLocaleString("hu-HU")}
                      </td>
                      <td className="py-2">{row.symbol}</td>
                      <td className="py-2">{row.mode}</td>
                      <td className="py-2">{row.status}</td>
                      <td className="py-2">{row.spot_qty ?? "-"}</td>
                      <td className="py-2">{row.perp_qty ?? "-"}</td>
                      <td className="py-2">{row.entry_spot_price ?? "-"}</td>
                      <td className="py-2">{row.entry_perp_price ?? "-"}</td>
                      <td className="py-2">
                        {(() => {
                          if (row.status !== "open") {
                            return "-";
                          }
                          const prices = snapshotMap.get(row.symbol);
                          if (!prices || prices.spot_mid === null || prices.perp_mid === null) {
                            return "-";
                          }
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
                        {row.status === "open" ? (
                          <ClosePositionButton positionId={row.id} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {positions && positions.length === 0 ? (
                <p className="mt-3 text-sm text-brand-100/70">
                  Nincs még position.
                </p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
