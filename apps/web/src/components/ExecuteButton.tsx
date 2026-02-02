"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ExecuteButtonProps = {
  opportunityId: number;
};

export default function ExecuteButton({ opportunityId }: ExecuteButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/execute/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunity_id: opportunityId })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload.error ?? "Nem sikerült paper pozíciót nyitni.");
      setLoading(false);
      return;
    }

    setSuccess(
      payload.position_id
        ? `Created position: ${payload.position_id} (${payload.notional_usd ?? "?"} USD)`
        : "Paper position created."
    );
    setLoading(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button className="btn btn-ghost" onClick={handleClick} disabled={loading}>
        {loading ? "Executing..." : "Execute (paper)"}
      </button>
      {error ? <span className="text-xs text-red-200">{error}</span> : null}
      {success ? <span className="text-xs text-green-200">{success}</span> : null}
    </div>
  );
}
