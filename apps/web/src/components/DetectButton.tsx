"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type EvaluatedRow = {
  exchange: string;
  symbol: string;
  net_edge_bps: number;
  gross_edge_bps: number;
  basis_bps: number;
  funding_daily_bps: number;
  costs_bps: number;
  decision: "inserted" | "skipped";
  reason?: string;
};

type DetectResponse = {
  inserted: number;
  skipped: number;
  evaluated: EvaluatedRow[];
};

export default function DetectButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectResponse | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    const response = await fetch("/api/detect/opportunities", { method: "POST" });

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
    <div className="flex flex-col items-start gap-2">
      <button className="btn btn-ghost" onClick={handleClick} disabled={loading}>
        {loading ? "Számítás..." : "Detect opportunities"}
      </button>
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
      {result ? (
        <div className="rounded-xl border border-brand-300/20 bg-brand-900/40 px-3 py-2 text-xs text-brand-100/80">
          <p>Inserted: {result.inserted} | Skipped: {result.skipped}</p>
          <ul className="mt-2 space-y-1">
            {result.evaluated.map((row) => (
              <li key={`${row.exchange}-${row.symbol}`}>
                {row.symbol} · {row.net_edge_bps.toFixed(2)} bps · {row.decision}
                {row.reason ? ` (${row.reason})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
