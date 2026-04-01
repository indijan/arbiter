"use client";

import { useState } from "react";

export default function ApplyLanePolicyButton({
  disabled = false,
  strategyKey,
  compact = false
}: {
  disabled?: boolean;
  strategyKey?: string;
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(strategyKey ? "/api/lane-policy/apply-one" : "/api/lane-policy/apply-latest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(strategyKey ? { strategy_key: strategyKey } : {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Apply failed.");
        return;
      }
      setMessage(
        strategyKey
          ? "Lane frissítve."
          : `Applied ${Number(data.applied ?? 0)} lane recommendations.`
      );
    } catch {
      setError("Apply failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button className={compact ? "btn btn-ghost text-xs" : "btn btn-ghost"} onClick={handleClick} disabled={disabled || loading}>
        {loading ? "Alkalmazás..." : strategyKey ? "Ezt alkalmazom" : "Összes ajánlás alkalmazása"}
      </button>
      {message ? <p className="text-xs text-emerald-200">{message}</p> : null}
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}
