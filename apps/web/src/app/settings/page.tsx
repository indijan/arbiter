import { redirect } from "next/navigation";
import SettingsPanel from "@/components/SettingsPanel";
import PaperSettingsPanel from "@/components/PaperSettingsPanel";
import { createServerSupabase } from "@/lib/supabase/server";

const EXCHANGES = [
  { key: "bybit", label: "Bybit" },
  { key: "okx", label: "OKX" },
  { key: "kraken", label: "Kraken" }
];

const STRATEGIES = [
  { key: "carry_spot_perp", label: "Carry (spot-perp)" },
  { key: "xarb_spot", label: "Cross-exchange spot" },
  { key: "tri_arb", label: "Triangular arb" }
];

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
    .select("strategy_key, enabled");

  const { data: paperSettings } = await supabase
    .from("paper_accounts")
    .select("balance_usd, reserved_usd, min_notional_usd, max_notional_usd")
    .maybeSingle();

  const exchangeMap = new Map(
    (exchangeRows ?? []).map((row) => [row.exchange_key, row.enabled])
  );
  const strategyMap = new Map(
    (strategyRows ?? []).map((row) => [row.strategy_key, row.enabled])
  );

  const exchanges = EXCHANGES.map((item) => ({
    ...item,
    enabled: exchangeMap.get(item.key) ?? true
  }));

  const strategies = STRATEGIES.map((item) => ({
    ...item,
    enabled: strategyMap.get(item.key) ?? true
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
