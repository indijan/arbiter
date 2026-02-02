"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type EvaluatedRow = {
  exchange: string;
  symbol: string;
  entry_basis_bps: number;
  expected_holding_bps: number;
  funding_daily_bps: number;
  total_costs_bps: number;
  net_edge_bps: number;
  break_even_hours: number | null;
  decision: "inserted" | "skipped" | "watchlist";
  reason?: string;
};

type DetectResponse = {
  inserted: number;
  skipped: number;
  holding_hours: number;
  evaluated: EvaluatedRow[];
};

export default function DetectSummaryPanel() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectResponse | null>(null);
  const [holdingHours, setHoldingHours] = useState(24);

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    const response = await fetch("/api/detect/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holding_hours: holdingHours })
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload) {
      setError(payload?.error ?? "Nem sikerült lehetőségeket számolni.");
      setLoading(false);
      return;
    }

    setResult(payload);
    setLoading(false);
    router.refresh();
  };

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Detect summary</h2>
          <p className="text-sm text-brand-100/70">
            Opportunity detect eredmények az utolsó futásból.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-brand-100/70">
            Holding hours
            <input
              type="number"
              min={1}
              max={168}
              step={1}
              value={holdingHours}
              onChange={(event) => setHoldingHours(Number(event.target.value))}
              className="w-20 rounded-lg border border-brand-300/30 bg-brand-900/60 px-2 py-1 text-white"
            />
          </label>
          <button className="btn btn-ghost" onClick={handleClick} disabled={loading}>
            {loading ? "Számítás..." : "Detect opportunities"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-red-200">{error}</p> : null}

      {result ? (
        <div className="mt-4">
          <p className="text-sm text-brand-100/80">
            Inserted: {result.inserted} | Skipped: {result.skipped} | Holding: {result.holding_hours}h
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-brand-100/70">
                <tr>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Net (bps)</th>
                  <th className="pb-2">Funding (bps)</th>
                  <th className="pb-2">Entry basis (bps)</th>
                  <th className="pb-2">Break-even (h)</th>
                  <th className="pb-2">Decision</th>
                  <th className="pb-2">Reason</th>
                </tr>
              </thead>
              <tbody className="text-brand-100/90">
                {result.evaluated.slice(0, 20).map((row) => (
                  <tr key={`${row.exchange}-${row.symbol}`} className="border-t border-brand-300/10">
                    <td className="py-2">{row.symbol}</td>
                    <td className="py-2">{row.net_edge_bps.toFixed(2)}</td>
                    <td className="py-2">{row.funding_daily_bps.toFixed(2)}</td>
                    <td className="py-2">{row.entry_basis_bps.toFixed(2)}</td>
                    <td className="py-2">
                      {row.break_even_hours === null
                        ? "-"
                        : row.break_even_hours.toFixed(1)}
                    </td>
                    <td className="py-2">{row.decision}</td>
                    <td className="py-2">{row.reason ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-brand-100/70">
          Nincs még detect futtatás.
        </p>
      )}
    </section>
  );
}
