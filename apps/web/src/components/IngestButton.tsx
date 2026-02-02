"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type IngestButtonProps = {
  endpoint: string;
  label: string;
  variant?: "primary" | "ghost";
};

export default function IngestButton({
  endpoint,
  label,
  variant = "primary"
}: IngestButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    const response = await fetch(endpoint, { method: "POST" });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "Nem sikerült adatot írni.");
      setLoading(false);
      return;
    }

    setLoading(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        className={`btn ${variant === "primary" ? "btn-primary" : "btn-ghost"}`}
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? "Írás..." : label}
      </button>
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
    </div>
  );
}
