"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DevTickButtonProps = {
  holdingHours?: number;
};

export default function DevTickButton({ holdingHours = 24 }: DevTickButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    const ingestBinanceResponse = await fetch("/api/ingest/binance", { method: "POST" });
    if (!ingestBinanceResponse.ok) {
      const payload = await ingestBinanceResponse.json().catch(() => ({}));
      setError(payload.error ?? "Nem sikerült a Bybit/OKX ingest.");
      setLoading(false);
      return;
    }

    const ingestKrakenResponse = await fetch("/api/ingest/kraken", { method: "POST" });
    if (!ingestKrakenResponse.ok) {
      const payload = await ingestKrakenResponse.json().catch(() => ({}));
      setError(payload.error ?? "Nem sikerült a Kraken ingest.");
      setLoading(false);
      return;
    }

    const detectResponse = await fetch("/api/detect/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holding_hours: holdingHours })
    });

    if (!detectResponse.ok) {
      const payload = await detectResponse.json().catch(() => ({}));
      setError(payload.error ?? "Nem sikerült detectet futtatni.");
      setLoading(false);
      return;
    }

    setLoading(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button className="btn btn-ghost" onClick={handleClick} disabled={loading}>
        {loading ? "Futtatás..." : "Manuális futtatás"}
      </button>
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
    </div>
  );
}
