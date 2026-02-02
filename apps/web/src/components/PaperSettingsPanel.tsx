"use client";

import { useState } from "react";

type PaperSettings = {
  balance_usd: number;
  reserved_usd: number;
  min_notional_usd: number;
  max_notional_usd: number;
};

type PaperSettingsPanelProps = {
  initial: PaperSettings;
};

export default function PaperSettingsPanel({ initial }: PaperSettingsPanelProps) {
  const [balance, setBalance] = useState(initial.balance_usd);
  const [minNotional, setMinNotional] = useState(initial.min_notional_usd);
  const [maxNotional, setMaxNotional] = useState(initial.max_notional_usd);
  const [reserved, setReserved] = useState(initial.reserved_usd);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/settings/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        balance_usd: balance,
        min_notional_usd: minNotional,
        max_notional_usd: maxNotional
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload.error ?? "Mentés sikertelen.");
      setSaving(false);
      return;
    }

    setReserved(Number(payload.reserved_usd ?? reserved));
    setSuccess("Paper beállítások mentve.");
    setSaving(false);
  };

  return (
    <section className="card">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Paper tőke</h2>
        <span className="text-xs text-brand-100/60">Alap: 10,000 USD</span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm">
          Kezdő / aktuális tőke (USD)
          <input
            className="rounded-xl border border-brand-300/20 bg-brand-900/40 px-3 py-2 text-white"
            type="number"
            min={0}
            step="0.01"
            value={balance}
            onChange={(event) => setBalance(Number(event.target.value))}
          />
        </label>
        <div className="rounded-xl border border-brand-300/15 bg-brand-900/40 px-4 py-3">
          <p className="text-xs text-brand-100/70">Lekötött tőke</p>
          <p className="mt-1 text-lg font-semibold text-brand-100">{reserved.toFixed(2)} USD</p>
          <p className="mt-2 text-xs text-brand-100/60">
            A nyitott pozíciók által lefoglalt összeg.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm">
          Minimum notional (USD)
          <input
            className="rounded-xl border border-brand-300/20 bg-brand-900/40 px-3 py-2 text-white"
            type="number"
            min={1}
            step="1"
            value={minNotional}
            onChange={(event) => setMinNotional(Number(event.target.value))}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          Maximum notional (USD)
          <input
            className="rounded-xl border border-brand-300/20 bg-brand-900/40 px-3 py-2 text-white"
            type="number"
            min={1}
            step="1"
            value={maxNotional}
            onChange={(event) => setMaxNotional(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Mentés..." : "Mentés"}
        </button>
        {error ? <span className="text-red-200">{error}</span> : null}
        {success ? <span className="text-emerald-200">{success}</span> : null}
      </div>
    </section>
  );
}
