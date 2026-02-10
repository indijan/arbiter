import { redirect } from "next/navigation";
import ProfitCharts, { type ProfitSeries } from "@/components/ProfitCharts";
import { createServerSupabase } from "@/lib/supabase/server";

const STRATEGY_LABELS: Record<string, string> = {
  carry_spot_perp: "Carry (spot-perp)",
  xarb_spot: "Cross-exchange spot",
  tri_arb: "Triangular arb"
};

const COLORS = ["#22c55e", "#38bdf8", "#f97316", "#e879f9", "#facc15", "#a3e635"];

export default async function ProfitPage() {
  const supabase = createServerSupabase();

  if (!supabase) {
    return (
      <div className="min-h-screen px-6 py-16">
        <div className="card mx-auto max-w-3xl space-y-2">
          <h1 className="text-2xl font-semibold">Profit</h1>
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

  const { data: pnlRows } = await supabase
    .from("daily_strategy_pnl")
    .select("day, strategy_key, exchange_key, pnl_usd")
    .order("day", { ascending: true })
    .limit(120);

  const rows = pnlRows ?? [];

  const { data: paperAccount } = await supabase
    .from("paper_accounts")
    .select("balance_usd, reserved_usd")
    .maybeSingle();

  const balanceUsd = Number(paperAccount?.balance_usd ?? 10000);
  const reservedUsd = Number(paperAccount?.reserved_usd ?? 0);
  const availableUsd = Math.max(0, balanceUsd - reservedUsd);

  const { data: closedPositions } = await supabase
    .from("positions")
    .select("id, entry_ts, exit_ts, symbol, spot_qty, perp_qty, entry_spot_price, entry_perp_price, exit_spot_price, exit_perp_price, realized_pnl_usd, status")
    .eq("user_id", user.id)
    .eq("status", "closed")
    .order("exit_ts", { ascending: false })
    .limit(500);

  const realizedRows = (closedPositions ?? []).map((row) => {
    const spotQty = Number(row.spot_qty ?? 0);
    const perpQty = Number(row.perp_qty ?? 0);
    const entrySpot = Number(row.entry_spot_price ?? 0);
    const entryPerp = Number(row.entry_perp_price ?? 0);
    const exitSpot = Number(row.exit_spot_price ?? 0);
    const exitPerp = Number(row.exit_perp_price ?? 0);
    const realized = Number(row.realized_pnl_usd ?? 0);

    const computed = exitSpot && exitPerp
      ? spotQty * (exitSpot - entrySpot) + perpQty * (exitPerp - entryPerp)
      : 0;

    return {
      ...row,
      computed_pnl: realized !== 0 ? realized : computed
    };
  });
  const recentRealizedRows = realizedRows.slice(0, 10);

  const realizedTotal = realizedRows.reduce((sum, row) => sum + Number(row.computed_pnl ?? 0), 0);

  const dailyRealizedMap = new Map<string, number>();
  for (const row of realizedRows) {
    if (!row.exit_ts) {
      continue;
    }
    const day = row.exit_ts.slice(0, 10);
    const pnl = Number(row.computed_pnl ?? 0);
    dailyRealizedMap.set(day, (dailyRealizedMap.get(day) ?? 0) + pnl);
  }

  const realizedChartData = Array.from(dailyRealizedMap.entries())
    .map(([day, pnl]) => ({
      day,
      realized_total: Number(pnl.toFixed(2))
    }))
    .sort((a, b) => String(a.day).localeCompare(String(b.day)));

  const seriesKeys = new Set<string>();
  const byDay = new Map<string, Record<string, number | string>>();

  for (const row of rows) {
    const day = row.day;
    const key = `${row.strategy_key}:${row.exchange_key}`;
    seriesKeys.add(key);

    if (!byDay.has(day)) {
      byDay.set(day, { day });
    }

    const entry = byDay.get(day);
    if (entry) {
      entry[key] = Number(row.pnl_usd ?? 0);
    }
  }

  let chartData = Array.from(byDay.values()).sort((a, b) =>
    String(a.day).localeCompare(String(b.day))
  );

  let series: ProfitSeries[] = Array.from(seriesKeys).map((key, index) => {
    const [strategyKey, exchangeKey] = key.split(":");
    const label = `${STRATEGY_LABELS[strategyKey] ?? strategyKey} · ${exchangeKey}`;
    return {
      key,
      label,
      color: COLORS[index % COLORS.length]
    };
  });

  // Fallback when daily_strategy_pnl table is missing or empty: use daily realized totals.
  if (chartData.length === 0 && realizedChartData.length > 0) {
    chartData = realizedChartData;
    series = [
      {
        key: "realized_total",
        label: "Realizalt napi PnL",
        color: "#22c55e"
      }
    ];
  }

  const latestDay = rows.length > 0 ? rows[rows.length - 1].day : null;
  const latestRows = latestDay
    ? rows.filter((row) => row.day === latestDay)
    : [];

  const topThree = latestRows
    .filter((row) => Number(row.pnl_usd ?? 0) > 0)
    .sort((a, b) => Number(b.pnl_usd ?? 0) - Number(a.pnl_usd ?? 0))
    .slice(0, 3);

  const totalLatest = latestRows.reduce((sum, row) => sum + Number(row.pnl_usd ?? 0), 0);

  const totalToneClass =
    totalLatest > 0
      ? "bg-emerald-300"
      : totalLatest < 0
        ? "bg-rose-300"
        : "bg-amber-300";

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header>
          <p className="text-sm uppercase tracking-[0.3em] text-brand-300">Profit</p>
          <h1 className="text-3xl font-semibold">Profit monitor</h1>
          <p className="mt-2 text-sm text-brand-100/70">
            Napi osszesites strategia es tozsde szerint.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="card">
            <p className="text-sm text-brand-100/70">Legutobbi nap</p>
            <p className="mt-2 text-2xl font-semibold">{latestDay ?? "N/A"}</p>
            <p className="mt-2 text-sm text-brand-100/70">Osszesitett PnL</p>
            <div className="mt-1 inline-flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${totalToneClass}`} />
              <span className="text-lg font-semibold">{totalLatest.toFixed(2)} USD</span>
            </div>
          </div>
          <div className="card">
            <p className="text-sm text-brand-100/70">Paper balance</p>
            <p className="mt-2 text-2xl font-semibold">{balanceUsd.toFixed(2)} USD</p>
            <p className="mt-2 text-sm text-brand-100/70">Lekotott</p>
            <p className="text-lg font-semibold text-brand-100/90">{reservedUsd.toFixed(2)} USD</p>
            <p className="mt-2 text-sm text-brand-100/70">Elerheto</p>
            <p className="text-lg font-semibold text-emerald-200">{availableUsd.toFixed(2)} USD</p>
          </div>
          <div className="card md:col-span-2">
            <p className="text-sm text-brand-100/70">Top 3 strategia (profito)</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {topThree.length > 0 ? (
                topThree.map((row) => (
                  <div key={`${row.strategy_key}-${row.exchange_key}`} className="rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3">
                    <p className="text-sm text-emerald-100/80">
                      {STRATEGY_LABELS[row.strategy_key] ?? row.strategy_key}
                    </p>
                    <p className="text-xs text-emerald-100/60">{row.exchange_key}</p>
                    <div className="mt-2 inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-300" />
                      <span className="text-lg font-semibold text-emerald-100">
                        {Number(row.pnl_usd ?? 0).toFixed(2)} USD
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-brand-100/70">Nincs meg profitos strategia.</p>
              )}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Napi PnL grafikon</h2>
            <span className="text-xs text-brand-100/60">USD</span>
          </div>
          <div className="mt-6">
            <ProfitCharts data={chartData} series={series} />
          </div>
        </section>

        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Napi realizalt PnL</h2>
            <span className="text-xs text-brand-100/60">USD</span>
          </div>
          <div className="mt-6">
            <ProfitCharts
              data={realizedChartData}
              series={[
                {
                  key: "realized_total",
                  label: "Realizalt napi PnL",
                  color: "#38bdf8"
                }
              ]}
            />
          </div>
        </section>

        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Realizalt PnL</h2>
            <span className="text-xs text-brand-100/60">Zart poziciok</span>
          </div>
          <p className="mt-2 text-sm text-brand-100/70">
            Osszesitett realizalt eredmeny: {realizedTotal.toFixed(2)} USD
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-brand-100/70">
                <tr>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Entry</th>
                  <th className="pb-2">Exit</th>
                  <th className="pb-2">PnL (USD)</th>
                </tr>
              </thead>
              <tbody className="text-brand-100/90">
                {recentRealizedRows.length > 0 ? (
                  recentRealizedRows.map((row) => (
                    <tr key={row.id} className="border-t border-brand-300/10">
                      <td className="py-2">{row.symbol}</td>
                      <td className="py-2">
                        {row.entry_ts ? new Date(row.entry_ts).toLocaleString("hu-HU") : "-"}
                      </td>
                      <td className="py-2">
                        {row.exit_ts ? new Date(row.exit_ts).toLocaleString("hu-HU") : "-"}
                      </td>
                      <td className="py-2">{Number(row.computed_pnl ?? 0).toFixed(2)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-3 text-sm text-brand-100/70" colSpan={4}>
                      Nincs meg zart pozicio.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2 className="text-xl font-semibold">Legutobbi napi bontas</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-brand-100/70">
                <tr>
                  <th className="pb-2">Strategia</th>
                  <th className="pb-2">Tozsde</th>
                  <th className="pb-2">PnL (USD)</th>
                </tr>
              </thead>
              <tbody className="text-brand-100/90">
                {latestRows.length > 0 ? (
                  latestRows.map((row) => (
                    <tr key={`${row.strategy_key}-${row.exchange_key}`} className="border-t border-brand-300/10">
                      <td className="py-2">
                        {STRATEGY_LABELS[row.strategy_key] ?? row.strategy_key}
                      </td>
                      <td className="py-2">{row.exchange_key}</td>
                      <td className="py-2">{Number(row.pnl_usd ?? 0).toFixed(2)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-3 text-sm text-brand-100/70" colSpan={3}>
                      Nincs meg napi osszesites.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
