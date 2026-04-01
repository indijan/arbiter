"use client";

import { useState } from "react";

export default function ApplyLanePolicyButton({ disabled = false }: { disabled?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/lane-policy/apply-latest", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Apply failed.");
        return;
      }
      setMessage(`Applied ${Number(data.applied ?? 0)} lane recommendations.`);
    } catch {
      setError("Apply failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button className="btn btn-ghost" onClick={handleClick} disabled={disabled || loading}>
        {loading ? "Alkalmazás..." : "Ajánlás alkalmazása"}
      </button>
      {message ? <p className="text-xs text-emerald-200">{message}</p> : null}
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}
