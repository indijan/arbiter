"use client";

import { useState } from "react";

type ActionKind = "status" | "delete";

export default function CandidatePolicyActionButton({
  id,
  kind,
  status,
  label,
  confirmText,
  compact = false
}: {
  id: string;
  kind: ActionKind;
  status?: "candidate" | "validated" | "canary" | "rejected";
  label: string;
  confirmText: string;
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm(confirmText)) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        kind === "delete" ? "/api/candidate-policies/delete" : "/api/candidate-policies/update-status",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(kind === "delete" ? { id } : { id, status })
        }
      );
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
