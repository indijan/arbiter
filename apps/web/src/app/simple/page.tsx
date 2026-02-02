import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function SimpleDashboardPage() {
  const supabase = createServerSupabase();
  if (!supabase) {
    return (
      <div className="min-h-screen px-6 py-16">
        <div className="card mx-auto max-w-3xl space-y-2">
          <h1 className="text-2xl font-semibold">Simple dashboard</h1>
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

  const { data: latestTick } = await supabase
    .from("system_ticks")
    .select("ts, ingest_errors")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastTick = latestTick?.ts
    ? new Date(latestTick.ts).toLocaleString("hu-HU")
    : "N/A";

  const ingestErrors = latestTick?.ingest_errors ?? 0;

  const { data: signals } = await supabase
    .from("opportunities")
    .select("id, ts, type, symbol, net_edge_bps, details")
    .order("net_edge_bps", { ascending: false })
    .limit(3);

  const { data: positions } = await supabase
    .from("positions")
    .select("id, entry_ts, symbol, status")
    .eq("user_id", user.id)
    .order("entry_ts", { ascending: false })
    .limit(5);

  const statusLabel = ingestErrors === 0 ? "Stabil" : "Figyelmeztetés";
  const statusBadgeClass = ingestErrors === 0
    ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-200"
    : "border-rose-300/40 bg-rose-500/10 text-rose-200";
  const statusDotClass = ingestErrors === 0 ? "bg-emerald-300" : "bg-rose-300";

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header>
          <p className="text-sm uppercase tracking-[0.3em] text-brand-300">Simple</p>
          <h1 className="text-3xl font-semibold">Simple dashboard</h1>
        </header>

        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">System status</h2>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${statusBadgeClass}`}>
              <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />
              {statusLabel}
            </span>
          </div>
          <p className="mt-2 text-sm text-brand-100/70">Last tick: {lastTick}</p>
          <p className="text-sm text-brand-100/70">Ingest errors: {ingestErrors}</p>
        </section>

        <section className="card">
          <h2 className="text-xl font-semibold">Top signals</h2>
          <div className="mt-4 space-y-3">
            {signals && signals.length > 0 ? (
              signals.map((signal) => {
                const type = signal.type;
                const net = signal.net_edge_bps ?? 0;
                const details = (signal.details ?? {}) as Record<string, unknown>;

                let title = "Arbitrage jel";
                let subtitle = signal.symbol;

                if (type === "spot_perp_carry") {
                  title = "Funding carry jel";
                  subtitle = signal.symbol;
                } else if (type === "xarb_spot") {
                  title = "Tőzsdék közti árkülönbség";
                  const buy = details.buy_exchange as string | undefined;
                  const sell = details.sell_exchange as string | undefined;
                  subtitle = `${signal.symbol} (${buy ?? "?"} → ${sell ?? "?"})`;
                } else if (type === "tri_arb") {
                  title = "Háromszög arbitrázs jel";
                  const path = (details.path as string) ?? signal.symbol;
                  subtitle = path;
                }

                return (
                  <div key={signal.id} className="rounded-xl border border-brand-300/20 bg-brand-900/50 p-4">
                    <p className="text-sm text-brand-100/70">{title}</p>
                    <p className="text-lg font-semibold">{subtitle}</p>
                    <p className="text-sm text-brand-100/70">Net edge: {net.toFixed(2)} bps</p>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-brand-100/70">Nincs még jelzés.</p>
            )}
          </div>
        </section>

        <section className="card">
          <h2 className="text-xl font-semibold">Positions</h2>
          <div className="mt-4 space-y-2 text-sm">
            {positions && positions.length > 0 ? (
              positions.map((position) => (
                <div key={position.id} className="flex items-center justify-between border-b border-brand-300/10 pb-2">
                  <span>{position.symbol}</span>
                  <span className="text-brand-100/70">{position.status}</span>
                  <span className="text-brand-100/70">
                    {new Date(position.entry_ts).toLocaleString("hu-HU")}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-brand-100/70">Nincs még position.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
