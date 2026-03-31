import { redirect } from "next/navigation";
import SettingsPanel from "@/components/SettingsPanel";
import PaperSettingsPanel from "@/components/PaperSettingsPanel";
import { createServerSupabase } from "@/lib/supabase/server";
import { lanePolicyStateFromRow, type LanePolicyState } from "@/server/lanes/policy";

const EXCHANGES = [
  { key: "bybit", label: "Bybit" },
  { key: "okx", label: "OKX" },
  { key: "kraken", label: "Kraken" }
];

const STRATEGIES = [
  { key: "carry_spot_perp", label: "Carry (spot-perp)" },
  { key: "xarb_spot", label: "Cross-exchange spot" },
  { key: "spread_reversion", label: "Spread mean reversion" },
  { key: "relative_strength", label: "Relative strength" },
  { key: "xrp_shadow_short_core", label: "Lane: XRP core short" },
  { key: "xrp_shadow_short_bull_fade_canary", label: "Lane: XRP bull fade canary" },
  { key: "avax_shadow_short_canary", label: "Lane: AVAX canary short" },
  { key: "sol_shadow_short_soft_bear_laggard", label: "Lane: SOL soft-bear laggard" },
  { key: "sol_shadow_short_deep_bear_continuation", label: "Lane: SOL deep-bear continuation" },
  { key: "tri_arb", label: "Triangular arb" }
];

const LANE_KEYS = new Set([
  "xrp_shadow_short_core",
  "xrp_shadow_short_bull_fade_canary",
  "avax_shadow_short_canary",
  "sol_shadow_short_soft_bear_laggard",
  "sol_shadow_short_deep_bear_continuation"
]);

type StrategyRow = {
  strategy_key: string;
  enabled: boolean;
  config?: Record<string, unknown> | null;
};

export default async function SettingsPage() {
  const supabase = createServerSupabase();
  if (!supabase) {
    return (
      <div className="min-h-screen px-6 py-16">
        <div className="card mx-auto max-w-3xl space-y-2">
          <h1 className="text-2xl font-semibold">Settings</h1>
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

  const { data: exchangeRows } = await supabase
    .from("exchange_settings")
    .select("exchange_key, enabled");

  const { data: strategyRows } = await supabase
    .from("strategy_settings")
    .select("strategy_key, enabled, config");

  const { data: paperSettings } = await supabase
    .from("paper_accounts")
    .select("balance_usd, reserved_usd, min_notional_usd, max_notional_usd")
    .maybeSingle();

  const exchangeMap = new Map(
    (exchangeRows ?? []).map((row) => [row.exchange_key, row.enabled])
  );
  const strategyMap = new Map(
    ((strategyRows ?? []) as StrategyRow[]).map((row) => [row.strategy_key, row])
  );

  const exchanges = EXCHANGES.map((item) => ({
    ...item,
    enabled: exchangeMap.get(item.key) ?? true
  }));

  const strategies = STRATEGIES.map((item) => ({
    ...item,
    enabled: strategyMap.get(item.key)?.enabled ?? true,
    isLane: LANE_KEYS.has(item.key),
    state: LANE_KEYS.has(item.key)
      ? (lanePolicyStateFromRow(strategyMap.get(item.key)) as LanePolicyState)
      : undefined
  }));

  const paperConfig = {
    balance_usd: Number(paperSettings?.balance_usd ?? 10000),
    reserved_usd: Number(paperSettings?.reserved_usd ?? 0),
    min_notional_usd: Number(paperSettings?.min_notional_usd ?? 100),
    max_notional_usd: Number(paperSettings?.max_notional_usd ?? 500)
  };

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-sm uppercase tracking-[0.3em] text-brand-300">Settings</p>
          <h1 className="text-3xl font-semibold">Strategy & Exchange</h1>
          <p className="mt-2 text-sm text-brand-100/70">
            Kapcsold be vagy ki a forrásokat és stratégiákat.
          </p>
        </header>
        <SettingsPanel exchanges={exchanges} strategies={strategies} />
        <PaperSettingsPanel initial={paperConfig} />
      </div>
    </div>
  );
}
