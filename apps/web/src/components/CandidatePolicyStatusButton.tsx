"use client";

import { useState } from "react";

export default function CandidatePolicyStatusButton({
  id,
  nextStatus,
  label,
  compact = false
}: {
  id: string;
  nextStatus: "candidate" | "validated" | "canary" | "rejected";
  label: string;
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/candidate-policies/update-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status: nextStatus })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Mentés sikertelen.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Mentés sikertelen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className={compact ? "btn btn-ghost text-xs" : "btn btn-ghost"}
        onClick={handleClick}
        disabled={loading}
        type="button"
      >
        {loading ? "Mentés..." : label}
      </button>
      {error ? <p className="text-[11px] text-rose-200">{error}</p> : null}
    </div>
  );
}
