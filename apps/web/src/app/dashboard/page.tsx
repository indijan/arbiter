import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

type PositionRow = {
  id: number;
  entry_ts: string;
  exit_ts: string | null;
  symbol: string;
  status: string;
  realized_pnl_usd: number | string | null;
  spot_qty: number | string | null;
  entry_spot_price: number | string | null;
  meta: Record<string, unknown> | null;
};

type SymbolStats = {
  symbol: string;
  closedCount: number;
  openCount: number;
  pnl24h: number;
  pnl7d: number;
  pnl30d: number;
};

type ExchangeStats = {
  exchange: string;
  closedCount: number;
  openCount: number;
  pnl24h: number;
  pnl7d: number;
};


function asNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function usd(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} USD`;
}

function compactUsd(value: number) {
  return `${value.toFixed(2)} USD`;
}


function toneClass(value: number) {
  if (value > 0) return "text-emerald-200";
  if (value < 0) return "text-rose-200";
  return "text-brand-100";
}

function toneSurfaceClass(value: number) {
  if (value > 0) return "border-emerald-300/20 bg-emerald-500/10";
  if (value < 0) return "border-rose-300/20 bg-rose-500/10";
  return "border-brand-300/10 bg-brand-900/35";
}

function pnlCardClass(value: number) {
  return `rounded-2xl border p-4 ${toneSurfaceClass(value)}`;
}

function pnlValueClass(value: number, size: "md" | "lg" = "lg") {
  const base = size === "lg" ? "text-4xl font-semibold tracking-tight" : "text-xl font-semibold";
  return `${base} ${toneClass(value)}`;
}


function formatTs(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("hu-HU");
}

function formatAgeMinutes(value: string | null) {
  if (!value) return "-";
  const ms = Date.now() - new Date(value).getTime();
  const mins = ms / 60000;
  if (!Number.isFinite(mins)) return "-";
  if (mins < 1) return "<1 perc";
  if (mins < 60) return `${mins.toFixed(1)} perc`;
  return `${(mins / 60).toFixed(1)} óra`;
}


function metaBool(meta: Record<string, unknown> | null, key: string) {
  return meta?.[key] === true;
}

function formatExchange(meta: Record<string, unknown> | null) {
  if (!meta) return "-";
  const exchange = typeof meta.exchange === "string" ? meta.exchange : null;
  const buyExchange = typeof meta.buy_exchange === "string" ? meta.buy_exchange : null;
  const sellExchange = typeof meta.sell_exchange === "string" ? meta.sell_exchange : null;
  if (exchange) return exchange;
  if (buyExchange && sellExchange) return `${buyExchange} -> ${sellExchange}`;
  return buyExchange ?? sellExchange ?? "-";
}


export default async function DashboardPage() {
  async function signOutAction() {
    "use server";

    const supabase = createServerSupabase();
    await supabase?.auth.signOut();
    redirect("/login");
  }

  const supabase = createServerSupabase();

  if (!supabase) {
    return (
      <div className="min-h-screen px-4 py-10 sm:px-6 sm:py-14">
        <div className="card mx-auto max-w-3xl space-y-2">
          <h1 className="text-2xl font-semibold">Arbiter cockpit</h1>
          <p className="text-sm text-brand-100/70">Hiányzó környezeti változók.</p>
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

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    latestTickResult,
    paperAccountResult,
    positions30dResult,
    openPositionsResult,
    recentClosedResult
  ] = await Promise.all([
    supabase
      .from("system_ticks")
      .select("ts, ingest_errors, detect_summary")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("paper_accounts")
      .select("balance_usd, reserved_usd, min_notional_usd, max_notional_usd")
      .maybeSingle(),
    supabase
      .from("positions")
      .select("id, entry_ts, exit_ts, symbol, status, realized_pnl_usd, spot_qty, entry_spot_price, meta")
      .eq("user_id", user.id)
      .gte("entry_ts", since30d)
      .order("entry_ts", { ascending: false })
      .limit(1500),
    supabase
      .from("positions")
      .select("id, entry_ts, exit_ts, symbol, status, realized_pnl_usd, spot_qty, entry_spot_price, meta")
      .eq("user_id", user.id)
      .eq("status", "open")
      .order("entry_ts", { ascending: false })
      .limit(20),
    supabase
      .from("positions")
      .select("id, entry_ts, exit_ts, symbol, status, realized_pnl_usd, spot_qty, entry_spot_price, meta")
      .eq("user_id", user.id)
      .eq("status", "closed")
      .order("exit_ts", { ascending: false })
      .limit(12),
  ]);

  const latestTick = latestTickResult.data;
  const detectSummary = (latestTick?.detect_summary ?? {}) as Record<string, unknown>;
  const relativeStrength = (detectSummary.relative_strength ?? {}) as Record<string, unknown>;
  const autoExecute = (detectSummary.auto_execute ?? {}) as Record<string, unknown>;
  const autoClose = (detectSummary.auto_close ?? {}) as Record<string, unknown>;
  const prefilterReasons = ((autoExecute.diagnostics as Record<string, unknown> | null)?.prefilter_reasons ?? {}) as Record<
    string,
    number
  >;

  const balanceUsd = asNumber(paperAccountResult.data?.balance_usd ?? 10000);
  const reservedUsd = asNumber(paperAccountResult.data?.reserved_usd ?? 0);
  const availableUsd = Math.max(0, balanceUsd - reservedUsd);
  const reserveRatio = balanceUsd > 0 ? (reservedUsd / balanceUsd) * 100 : 0;
  const availableRatio = balanceUsd > 0 ? (availableUsd / balanceUsd) * 100 : 0;

  const positions30d = (positions30dResult.data ?? []) as PositionRow[];
  const openPositions = (openPositionsResult.data ?? []) as PositionRow[];
  const recentClosed = (recentClosedResult.data ?? []) as PositionRow[];
  const capitalDial = Math.round(reserveRatio * 3.6);

  const closed24h = positions30d.filter((row) => row.status === "closed" && row.exit_ts && row.exit_ts >= since24h);
  const closed7d = positions30d.filter((row) => row.status === "closed" && row.exit_ts && row.exit_ts >= since7d);
  const closed30d = positions30d.filter((row) => row.status === "closed");
  const opened24h = positions30d.filter((row) => row.entry_ts >= since24h);
  const opened7d = positions30d.filter((row) => row.entry_ts >= since7d);

  const pnl24h = closed24h.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const pnl7d = closed7d.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const pnl30d = closed30d.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);

  const shadowRows = positions30d.filter((row) => metaBool(row.meta, "relative_strength_open"));
  const shadowWithBtcMeta = shadowRows.filter((row) => row.meta?.btc_momentum_6h_bps !== null && row.meta?.btc_momentum_6h_bps !== undefined);
  const shadowClosed = shadowWithBtcMeta.filter((row) => row.status === "closed");
  const shadowOpen = shadowWithBtcMeta.filter((row) => row.status === "open");
  const shadowPnl = shadowClosed.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const shadowXrpCoreClosed = shadowClosed.filter((row) => String(row.meta?.strategy_variant ?? "") === "xrp_shadow_short_core");
  const shadowAvaxClosed = shadowClosed.filter((row) => String(row.meta?.strategy_variant ?? "") === "avax_shadow_short_canary");
  const shadowSolClosed = shadowClosed.filter((row) => String(row.meta?.strategy_variant ?? "") === "sol_shadow_short_canary");
  const shadowXrpCoreOpen = shadowOpen.filter((row) => String(row.meta?.strategy_variant ?? "") === "xrp_shadow_short_core");
  const shadowAvaxOpen = shadowOpen.filter((row) => String(row.meta?.strategy_variant ?? "") === "avax_shadow_short_canary");
  const shadowSolOpen = shadowOpen.filter((row) => String(row.meta?.strategy_variant ?? "") === "sol_shadow_short_canary");
  const shadowXrpCorePnl = shadowXrpCoreClosed.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const shadowAvaxPnl = shadowAvaxClosed.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const shadowSolPnl = shadowSolClosed.reduce((sum, row) => sum + asNumber(row.realized_pnl_usd), 0);
  const latestShadowTrade = shadowClosed[0] ?? null;
  const latestBtcMomentum = latestShadowTrade ? asNumber(latestShadowTrade.meta?.btc_momentum_6h_bps) : 0;
  const latestBtcRegime =
    latestShadowTrade && latestBtcMomentum < 0
      ? "btc_neg"
      : latestShadowTrade && latestBtcMomentum > 0
        ? "btc_pos"
        : "flat/unknown";

  const bySymbol = new Map<string, SymbolStats>();
  for (const row of positions30d) {
    const current = bySymbol.get(row.symbol) ?? {
      symbol: row.symbol,
      closedCount: 0,
      openCount: 0,
      pnl24h: 0,
      pnl7d: 0,
      pnl30d: 0
    };
    if (row.status === "open") current.openCount += 1;
    if (row.status === "closed") {
      const pnl = asNumber(row.realized_pnl_usd);
      current.closedCount += 1;
      current.pnl30d += pnl;
      if (row.exit_ts && row.exit_ts >= since7d) current.pnl7d += pnl;
      if (row.exit_ts && row.exit_ts >= since24h) current.pnl24h += pnl;
    }
    bySymbol.set(row.symbol, current);
  }
  const symbolStats = Array.from(bySymbol.values()).sort((a, b) => b.pnl7d - a.pnl7d).slice(0, 8);
  const symbolScale = Math.max(1, ...symbolStats.map((row) => Math.abs(row.pnl7d)));

  const byExchange = new Map<string, ExchangeStats>();
  for (const row of positions30d) {
    const exchange = formatExchange(row.meta);
    const current = byExchange.get(exchange) ?? {
      exchange,
      closedCount: 0,
      openCount: 0,
      pnl24h: 0,
      pnl7d: 0
    };
    if (row.status === "open") current.openCount += 1;
    if (row.status === "closed") {
      const pnl = asNumber(row.realized_pnl_usd);
      current.closedCount += 1;
      if (row.exit_ts && row.exit_ts >= since24h) current.pnl24h += pnl;
      if (row.exit_ts && row.exit_ts >= since7d) current.pnl7d += pnl;
    }
    byExchange.set(exchange, current);
  }
  const exchangeStats = Array.from(byExchange.values())
    .sort((a, b) => b.pnl7d - a.pnl7d)
    .slice(0, 6);


  const topPrefilters = Object.entries(prefilterReasons)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 4);

  const cockpitStatus = latestTick?.ingest_errors ? "Figyelni kell" : "Stabil";
  const cockpitTone = latestTick?.ingest_errors ? "text-amber-100 border-amber-300/30 bg-amber-500/10" : "text-emerald-100 border-emerald-300/30 bg-emerald-500/10";

  const latestInserted = asNumber(relativeStrength.inserted);
  const latestSkipped = asNumber(relativeStrength.skipped);
  const latestClosedCount = asNumber(autoClose.closed);
  const latestCloseAttempts = asNumber(autoClose.attempted);

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header>
          <section className="cockpit-shell overflow-hidden rounded-[28px] border border-brand-300/15 bg-brand-700/60 p-5 shadow-2xl shadow-black/20 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.38em] text-brand-300/80">Arbiter cockpit</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Sarokszámok és folyamatok</h1>
                <p className="mt-3 max-w-2xl text-sm text-brand-100/70">
                  Egy oldalra húzva a paper tőke, a shadow lane, a profit és az aktív kötéskép. A zajt kiszedtem.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <form action={signOutAction}>
                  <button className="btn btn-ghost" type="submit">
                    Kilépés
                  </button>
                </form>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className={pnlCardClass(pnl24h)}>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">24h PnL</p>
                  <p className={`mt-2 ${pnlValueClass(pnl24h)}`}>{usd(pnl24h)}</p>
                  <p className="mt-2 text-sm text-brand-100/70">{closed24h.length} zárás, {opened24h.length} nyitás</p>
                </div>
              </div>
              <div className={pnlCardClass(pnl7d)}>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">7d PnL</p>
                  <p className={`mt-2 ${pnlValueClass(pnl7d)}`}>{usd(pnl7d)}</p>
                  <p className="mt-2 text-sm text-brand-100/70">{closed7d.length} zárás, {opened7d.length} nyitás</p>
                </div>
              </div>
              <div className={pnlCardClass(pnl30d)}>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">30d PnL</p>
                  <p className={`mt-2 ${pnlValueClass(pnl30d)}`}>{usd(pnl30d)}</p>
                  <p className="mt-2 text-sm text-brand-100/70">Összes zárt trade a 30 napos ablakban</p>
                </div>
                <div className="mt-4 flex items-end justify-between text-sm text-brand-100/70">
                  <span>Nyitott: {openPositions.length}</span>
                  <span>Zárt: {closed30d.length}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[24px] border border-brand-300/10 bg-brand-900/35 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">Exchange profit panel</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {exchangeStats.length > 0 ? exchangeStats.map((row) => (
                    <div key={row.exchange} className={`rounded-2xl border px-3 py-3 ${toneSurfaceClass(row.pnl7d)}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{row.exchange}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.22em] text-brand-100/45">
                            {row.closedCount} zárt · {row.openCount} nyitott
                          </p>
                        </div>
                        <p className={`text-sm font-semibold ${toneClass(row.pnl7d)}`}>{usd(row.pnl7d)}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-brand-100/65">
                        <div>
                          <p>24h</p>
                          <p className={`mt-1 font-semibold ${toneClass(row.pnl24h)}`}>{usd(row.pnl24h)}</p>
                        </div>
                        <div>
                          <p>7d</p>
                          <p className={`mt-1 font-semibold ${toneClass(row.pnl7d)}`}>{usd(row.pnl7d)}</p>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <p className="text-sm text-brand-100/60">Nincs exchange szintű PnL minta.</p>
                  )}
                </div>
              </div>

              <div className="capital-dial-card">
                <div className="capital-dial" style={{ ["--dial-deg" as string]: `${capitalDial}deg` }}>
                  <div className="capital-dial__inner">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-brand-100/55">Lekötött</p>
                    <p className="mt-2 text-3xl font-semibold text-white">{reserveRatio.toFixed(1)}%</p>
                    <p className="mt-1 text-sm text-brand-100/65">{compactUsd(reservedUsd)}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 px-3 py-3">
                    <p className="text-brand-100/55">Szabad tőke</p>
                    <p className="mt-1 font-semibold text-emerald-200">{compactUsd(availableUsd)}</p>
                  </div>
                  <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 px-3 py-3">
                    <p className="text-brand-100/55">Futó pozik</p>
                    <p className="mt-1 font-semibold text-white">{openPositions.length}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="instrument-card">
                <p className="instrument-label">Tőke</p>
                <p className="instrument-value">{compactUsd(balanceUsd)}</p>
                <p className="instrument-note">Paper account balance</p>
              </div>
              <div className="instrument-card">
                <p className="instrument-label">Elérhető</p>
                <p className="instrument-value text-emerald-200">{compactUsd(availableUsd)}</p>
                <div className="gauge-track mt-3"><div className="gauge-fill bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300" style={{ width: `${availableRatio}%` }} /></div>
                <p className="instrument-note mt-2">{availableRatio.toFixed(1)}% szabad</p>
              </div>
              <div className="instrument-card">
                <p className="instrument-label">Lekötött</p>
                <p className="instrument-value text-amber-100">{compactUsd(reservedUsd)}</p>
                <div className="gauge-track mt-3"><div className="gauge-fill bg-gradient-to-r from-amber-300 via-orange-300 to-rose-300" style={{ width: `${reserveRatio}%` }} /></div>
                <p className="instrument-note mt-2">{reserveRatio.toFixed(1)}% futó kötésben</p>
              </div>
              <div className={`instrument-card border ${cockpitTone}`}>
                <p className="instrument-label">Rendszer</p>
                <p className="instrument-value">{cockpitStatus}</p>
                <p className="instrument-note mt-2">Utolsó tick: {formatAgeMinutes(latestTick?.ts ?? null)} ezelőtt</p>
              </div>
            </div>
          </section>
        </header>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_1.1fr_0.85fr]">
          <div className="card space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-brand-300/80">Strategy lanes</p>
                <h2 className="mt-1 text-2xl font-semibold">Core and canary lanes</h2>
              </div>
              <div className={`rounded-2xl border px-3 py-2 text-right ${shadowPnl >= 0 ? "border-emerald-300/25 bg-emerald-500/10" : "border-rose-300/25 bg-rose-500/10"}`}>
                <p className="text-xs uppercase tracking-[0.24em] text-brand-100/60">BTC-meta sample</p>
                <p className={`mt-1 text-xl font-semibold ${toneClass(shadowPnl)}`}>{usd(shadowPnl)}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className={pnlCardClass(shadowXrpCorePnl)}>
                <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">XRP core short</p>
                <p className={`mt-2 ${pnlValueClass(shadowXrpCorePnl, "md")}`}>{usd(shadowXrpCorePnl)}</p>
                <p className="mt-2 text-sm text-brand-100/70">{shadowXrpCoreClosed.length} zárt · {shadowXrpCoreOpen.length} nyitott</p>
              </div>
              <div className={pnlCardClass(shadowAvaxPnl)}>
                <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">AVAX canary short</p>
                <p className={`mt-2 ${pnlValueClass(shadowAvaxPnl, "md")}`}>{usd(shadowAvaxPnl)}</p>
                <p className="mt-2 text-sm text-brand-100/70">{shadowAvaxClosed.length} zárt · {shadowAvaxOpen.length} nyitott</p>
              </div>
              <div className={pnlCardClass(shadowSolPnl)}>
                <p className="text-xs uppercase tracking-[0.28em] text-brand-100/55">SOL canary short</p>
                <p className={`mt-2 ${pnlValueClass(shadowSolPnl, "md")}`}>{usd(shadowSolPnl)}</p>
                <p className="mt-2 text-sm text-brand-100/70">{shadowSolClosed.length} zárt · {shadowSolOpen.length} nyitott</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="instrument-card compact">
                <p className="instrument-label">RS inserted</p>
                <p className="instrument-value">{latestInserted}</p>
              </div>
              <div className="instrument-card compact">
                <p className="instrument-label">RS skipped</p>
                <p className="instrument-value">{latestSkipped}</p>
              </div>
              <div className="instrument-card compact">
                <p className="instrument-label">Auto close</p>
                <p className="instrument-value">{latestClosedCount}/{latestCloseAttempts}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-brand-100/55">Shadow flight panel</p>
                  <p className="mt-1 text-lg font-semibold text-white">BTC regime: {latestBtcRegime}</p>
                </div>
                <div className={`rounded-full border px-3 py-1 text-sm ${latestBtcMomentum < 0 ? "border-emerald-300/20 bg-emerald-500/10 text-emerald-100" : latestBtcMomentum > 0 ? "border-amber-300/20 bg-amber-500/10 text-amber-100" : "border-brand-300/15 text-brand-100/70"}`}>
                  {latestShadowTrade ? `${latestBtcMomentum.toFixed(1)} bps` : "nincs minta"}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-brand-300/10 bg-brand-900/45 px-3 py-3">
                  <p className="text-brand-100/55">Lezárt shadow trade-ek</p>
                  <p className="mt-1 text-xl font-semibold text-white">{shadowClosed.length}</p>
                </div>
                <div className="rounded-2xl border border-brand-300/10 bg-brand-900/45 px-3 py-3">
                  <p className="text-brand-100/55">Nyitott shadow trade-ek</p>
                  <p className="mt-1 text-xl font-semibold text-white">{shadowOpen.length}</p>
                </div>
                <div className="rounded-2xl border border-brand-300/10 bg-brand-900/45 px-3 py-3">
                  <p className="text-brand-100/55">Utolsó shadow zárás</p>
                  <p className={`mt-1 text-xl font-semibold ${toneClass(latestShadowTrade ? asNumber(latestShadowTrade.realized_pnl_usd) : 0)}`}>
                    {latestShadowTrade ? usd(asNumber(latestShadowTrade.realized_pnl_usd)) : "-"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-brand-300/80">Symbol PnL</p>
                <h2 className="mt-1 text-2xl font-semibold">Melyik coin mit csinál</h2>
              </div>
              <p className="text-xs text-brand-100/60">30 napos ablak, 7 nap szerint rendezve</p>
            </div>
            <div className="mt-5 space-y-3">
              {symbolStats.length > 0 ? symbolStats.map((row) => (
                <div key={row.symbol} className={`rounded-2xl border p-4 ${toneSurfaceClass(row.pnl7d)}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold text-white">{row.symbol}</p>
                      <p className="text-xs uppercase tracking-[0.22em] text-brand-100/50">
                        {row.closedCount} zárt / {row.openCount} nyitott
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-semibold ${toneClass(row.pnl7d)}`}>{usd(row.pnl7d)}</p>
                      <p className="text-xs text-brand-100/60">7 nap</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-brand-100/70 sm:grid-cols-3">
                    <div>
                      <p>24h</p>
                      <p className={`mt-1 font-semibold ${toneClass(row.pnl24h)}`}>{usd(row.pnl24h)}</p>
                    </div>
                    <div>
                      <p>7d</p>
                      <p className={`mt-1 font-semibold ${toneClass(row.pnl7d)}`}>{usd(row.pnl7d)}</p>
                    </div>
                    <div>
                      <p>30d</p>
                      <p className={`mt-1 font-semibold ${toneClass(row.pnl30d)}`}>{usd(row.pnl30d)}</p>
                    </div>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-brand-100/70">Nincs még symbol szintű minta.</p>
              )}
            </div>
          </div>

          <div className="card">
            <p className="text-xs uppercase tracking-[0.28em] text-brand-300/80">Folyamatok</p>
            <h2 className="mt-1 text-2xl font-semibold">Mi történik éppen</h2>
            <div className="mt-5 space-y-3 text-sm text-brand-100/80">
              <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-4">
                <p className="text-brand-100/55">Utolsó tick</p>
                <p className="mt-1 text-base font-semibold text-white">{formatTs(latestTick?.ts ?? null)}</p>
                <p className="mt-1 text-brand-100/60">Kor: {formatAgeMinutes(latestTick?.ts ?? null)}</p>
              </div>
              <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-4">
                <p className="text-brand-100/55">Legfontosabb szűrők</p>
                <div className="mt-3 space-y-2">
                  {topPrefilters.length > 0 ? topPrefilters.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="truncate text-brand-100/70">{key}</span>
                      <span className="rounded-full border border-brand-300/15 px-2 py-0.5 font-semibold text-white">{value}</span>
                    </div>
                  )) : (
                    <p className="text-brand-100/60">Nincs friss prefilter jel.</p>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-4">
                <p className="text-brand-100/55">Notional keret</p>
                <div className="mt-2 flex items-center justify-between">
                  <span>Min</span>
                  <span className="font-semibold text-white">{compactUsd(asNumber(paperAccountResult.data?.min_notional_usd ?? 100))}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span>Max</span>
                  <span className="font-semibold text-white">{compactUsd(asNumber(paperAccountResult.data?.max_notional_usd ?? 500))}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-brand-300/80">Nyitott pozíciók</p>
                <h2 className="mt-1 text-2xl font-semibold">Élő lekötések</h2>
              </div>
              <div className="rounded-full border border-brand-300/15 px-3 py-1 text-sm text-brand-100/70">{openPositions.length} open</div>
            </div>
            <div className="mt-5 space-y-3">
              {openPositions.length > 0 ? openPositions.map((row) => {
                const direction = String(row.meta?.direction ?? (asNumber(row.spot_qty) >= 0 ? "long" : "short"));
                const notional = asNumber(row.meta?.notional_usd ?? Math.abs(asNumber(row.spot_qty) * asNumber(row.entry_spot_price)));
                return (
                  <div key={row.id} className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-white">{row.symbol}</p>
                        <p className="text-xs uppercase tracking-[0.22em] text-brand-100/50">{direction} · {formatExchange(row.meta)}</p>
                      </div>
                      <div className="text-right text-sm text-brand-100/70">
                        <p>{compactUsd(notional)}</p>
                        <p>{formatAgeMinutes(row.entry_ts)}</p>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-5 text-sm text-brand-100/65">
                  Jelenleg nincs nyitott pozi. Ezt főleg a lekötött vs elérhető tőkéből is látod, de itt külön is tisztán megvan.
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-brand-300/80">Friss zárások</p>
                <h2 className="mt-1 text-2xl font-semibold">Legutóbbi lezárt trade-ek</h2>
              </div>
              <p className="text-xs text-brand-100/60">Legutolsó 12 zárás</p>
            </div>
            <div className="mt-5 space-y-3">
              {recentClosed.length > 0 ? recentClosed.map((row) => {
                const direction = String(row.meta?.direction ?? (asNumber(row.spot_qty) >= 0 ? "long" : "short"));
                const pnl = asNumber(row.realized_pnl_usd);
                return (
                  <div key={row.id} className={pnlCardClass(pnl)}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-semibold text-white">{row.symbol}</p>
                        <p className="text-xs uppercase tracking-[0.22em] text-brand-100/50">{direction} · {formatExchange(row.meta)}</p>
                        <p className="mt-2 text-sm text-brand-100/60">Entry: {formatTs(row.entry_ts)}</p>
                        <p className="text-sm text-brand-100/60">Exit: {formatTs(row.exit_ts)}</p>
                      </div>
                      <div className="text-right">
                        <p className={pnlValueClass(pnl, "md")}>{usd(pnl)}</p>
                        <p className="mt-2 text-xs text-brand-100/55">Spread: {asNumber(row.meta?.spread_bps).toFixed(2)} bps</p>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-2xl border border-brand-300/10 bg-brand-900/35 p-5 text-sm text-brand-100/65">
                  Még nincs friss lezárás.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
