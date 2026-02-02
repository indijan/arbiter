"use client";

import { useState } from "react";

type SettingItem = {
  key: string;
  label: string;
  enabled: boolean;
};

type SettingsPanelProps = {
  exchanges: SettingItem[];
  strategies: SettingItem[];
};

function Toggle({
  checked,
  onChange
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
        checked
          ? "border-emerald-300/40 bg-emerald-400/70"
          : "border-rose-300/40 bg-rose-400/40"
      }`}
      aria-pressed={checked}
    >
      <span
        className={`h-6 w-6 rounded-full bg-white shadow transition ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function SettingsPanel({ exchanges, strategies }: SettingsPanelProps) {
  const [exchangeState, setExchangeState] = useState(exchanges);
  const [strategyState, setStrategyState] = useState(strategies);
  const [error, setError] = useState<string | null>(null);

  const updateSetting = async (
    type: "exchange" | "strategy",
    key: string,
    enabled: boolean
  ) => {
    setError(null);
    const endpoint = type === "exchange" ? "/api/settings/exchanges" : "/api/settings/strategies";
    const payload = type === "exchange"
      ? { exchange_key: key, enabled }
      : { strategy_key: key, enabled };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Mentés sikertelen.");
    }
  };

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Exchanges</h2>
            <span className="text-xs text-brand-100/60">Zöld = aktív</span>
          </div>
          <div className="mt-4 space-y-3">
            {exchangeState.map((item, index) => (
              <div key={item.key} className="flex min-h-12 items-center justify-between rounded-xl border border-brand-300/15 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.enabled ? "bg-emerald-300" : "bg-rose-300"}`} />
                  <span className="text-sm">{item.label}</span>
                </div>
                <Toggle
                  checked={item.enabled}
                  onChange={(next) => {
                    const updated = [...exchangeState];
                    updated[index] = { ...item, enabled: next };
                    setExchangeState(updated);
                    void updateSetting("exchange", item.key, next);
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Stratégiák</h2>
            <span className="text-xs text-brand-100/60">Zöld = aktív</span>
          </div>
          <div className="mt-4 space-y-3">
            {strategyState.map((item, index) => (
              <div key={item.key} className="flex min-h-12 items-center justify-between rounded-xl border border-brand-300/15 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.enabled ? "bg-emerald-300" : "bg-rose-300"}`} />
                  <span className="text-sm">{item.label}</span>
                </div>
                <Toggle
                  checked={item.enabled}
                  onChange={(next) => {
                    const updated = [...strategyState];
                    updated[index] = { ...item, enabled: next };
                    setStrategyState(updated);
                    void updateSetting("strategy", item.key, next);
                  }}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
