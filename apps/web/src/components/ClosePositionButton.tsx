"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ClosePositionButtonProps = {
  positionId: string;
};

export default function ClosePositionButton({ positionId }: ClosePositionButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/execute/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position_id: positionId })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload.error ?? "Nem sikerult lezarni a poziciot.");
      setLoading(false);
      return;
    }

    setSuccess(`Lezarva: ${payload.realized_pnl_usd ?? "?"} USD`);
    setLoading(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button className="btn btn-ghost" onClick={handleClick} disabled={loading}>
        {loading ? "Zaras..." : "Zaras"}
      </button>
      {error ? <span className="text-xs text-red-200">{error}</span> : null}
      {success ? <span className="text-xs text-emerald-200">{success}</span> : null}
    </div>
  );
}
