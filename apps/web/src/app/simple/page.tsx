import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { rejectReasonHu } from "@/server/ops/rejectReasonsHu";

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
    .select("ts, ingest_errors, detect_summary")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastTick = latestTick?.ts
    ? new Date(latestTick.ts).toLocaleString("hu-HU")
    : "N/A";

  const ingestErrors = latestTick?.ingest_errors ?? 0;
  const autoExecute = (latestTick?.detect_summary as any)?.auto_execute ?? null;
  const reasonsTop = Array.isArray(autoExecute?.reasons_top) ? autoExecute.reasons_top : [];
  const prefilterReasons = autoExecute?.diagnostics?.prefilter_reasons ?? null;
  const liveRejectSamples = Array.isArray(autoExecute?.diagnostics?.live_reject_samples)
    ? autoExecute.diagnostics.live_reject_samples
    : [];

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
                } else if (type === "spread_reversion") {
                  title = "Spread mean reversion";
                  const buy = details.buy_exchange as string | undefined;
                  const sell = details.sell_exchange as string | undefined;
                  subtitle = `${signal.symbol} (${buy ?? "?"} → ${sell ?? "?"})`;
                } else if (type === "relative_strength") {
                  title = "Relative strength";
                  const direction = details.direction as string | undefined;
                  subtitle = `${signal.symbol} (${direction ?? "?"})`;
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Miért nem nyit?</h2>
            <p className="text-xs text-brand-100/60">
              Utolsó tick: {lastTick}
            </p>
          </div>

          {autoExecute ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-brand-300/15 bg-brand-900/40 p-3 text-sm">
                <p className="text-brand-100/60">Próbálkozás</p>
                <p className="mt-1 text-xl font-semibold">{Number(autoExecute.attempted ?? 0)}</p>
              </div>
              <div className="rounded-xl border border-brand-300/15 bg-brand-900/40 p-3 text-sm">
                <p className="text-brand-100/60">Átjutott (szűrés után)</p>
                <p className="mt-1 text-xl font-semibold">{Number(autoExecute.diagnostics?.passed_filters ?? 0)}</p>
              </div>
              <div className="rounded-xl border border-brand-300/15 bg-brand-900/40 p-3 text-sm">
                <p className="text-brand-100/60">Nyitás</p>
                <p className="mt-1 text-xl font-semibold">{Number(autoExecute.created ?? 0)}</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-brand-100/70">Nincs auto_execute diagnosztika.</p>
          )}

          {reasonsTop.length > 0 ? (
            <div className="mt-4">
              <p className="text-sm text-brand-100/70">Top okok (miért nem nyitott):</p>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {reasonsTop.slice(0, 3).map((row: any) => {
                  const reason = String(row.reason ?? "");
                  const count = Number(row.count ?? 0);
                  const hu = rejectReasonHu(reason);
                  return (
                    <div key={reason} className="rounded-xl border border-brand-300/15 bg-brand-900/50 p-3">
                      <p className="text-sm font-semibold">{hu.title}</p>
                      <p className="mt-1 text-xs text-brand-100/70">{hu.detail}</p>
                      <p className="mt-2 text-xs text-brand-100/60">Esetszám: {count}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {liveRejectSamples.length > 0 ? (
            <div className="mt-4">
              <p className="text-sm text-brand-100/70">Minták (élő ár ellenőrzés):</p>
              <div className="mt-2 space-y-2 text-xs">
                {liveRejectSamples.slice(0, 2).map((sample: any, idx: number) => {
                  const reason = String(sample.reason ?? "");
                  const hu = rejectReasonHu(reason);
                  return (
                    <div key={`${reason}-${idx}`} className="rounded-xl border border-brand-300/15 bg-brand-900/50 p-3">
                      <p className="font-semibold">{hu.title}</p>
                      <p className="mt-1 text-brand-100/70">{hu.detail}</p>
                      <p className="mt-2 text-brand-100/70">
                        {String(sample.symbol ?? "-")} | {String(sample.exchange_pair ?? "-")}
                      </p>
                      <p className="text-brand-100/60">
                        Live gross: {Number(sample.live_gross_bps ?? 0).toFixed(2)} bps | Live net:{" "}
                        {Number(sample.live_net_bps ?? 0).toFixed(2)} bps | Küszöb:{" "}
                        {Number(sample.threshold_bps ?? 0).toFixed(2)} bps
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {prefilterReasons ? (
            <details className="mt-4 rounded-xl border border-brand-300/15 bg-brand-900/30 p-3">
              <summary className="cursor-pointer text-sm text-brand-100/70">
                Mi esett ki a szűrésen? (összesítés)
              </summary>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {Object.entries(prefilterReasons as Record<string, number>)
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .slice(0, 8)
                  .map(([code, count]) => {
                    const hu = rejectReasonHu(code);
                    return (
                      <div key={code} className="rounded-lg border border-brand-300/10 bg-brand-900/40 p-2">
                        <p className="text-xs font-semibold">{hu.title}</p>
                        <p className="text-[11px] text-brand-100/60">{hu.detail}</p>
                        <p className="mt-1 text-[11px] text-brand-100/60">Esetszám: {count}</p>
                      </div>
                    );
                  })}
              </div>
            </details>
          ) : null}
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
